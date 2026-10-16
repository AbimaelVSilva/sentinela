import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env';
import { db } from '../db/client';
import {
  type Camera,
  cameras,
  type EventDetails,
  type EventType,
  events,
  type Snapshot,
  snapshots,
} from '../db/schema';
import { classifyComparison, severityOf } from '../domain/classification';
import { regionFromCrop, regionToCrop, roiBoundingBox } from '../domain/geometry';
import { applyChanges } from '../domain/inventory';
import type { Comparison, Inventory } from '../domain/types';
import { bus } from '../lib/bus';
import { serializeEvent } from '../modules/events/serializer';
import { readFile, saveFile } from '../storage';
import { VisionError, type VisionProvider } from '../vision/provider';
import { cropJpeg, imageInfo } from './image';
import { sceneDiff } from './scene-diff';

const ROI_MARGIN = 0.05;
const MAX_SIDE = 1568;

/** Salva um JPEG como snapshot da câmera. */
export async function saveSnapshot(
  cameraId: string,
  kind: Snapshot['kind'],
  jpeg: Buffer,
  capturedAt = new Date(),
): Promise<Snapshot> {
  const { width, height } = await imageInfo(jpeg);
  const name = `${kind}-${capturedAt.getTime()}.jpg`;
  const filePath = await saveFile(cameraId, name, jpeg);
  const [row] = await db
    .insert(snapshots)
    .values({ cameraId, kind, filePath, width, height, capturedAt })
    .returning();
  return row!;
}

export async function loadBaseline(
  camera: Camera,
): Promise<{ snapshot: Snapshot; jpeg: Buffer } | null> {
  if (!camera.baselineSnapshotId) return null;
  const snapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.id, camera.baselineSnapshotId),
  });
  if (!snapshot) return null;
  try {
    return { snapshot, jpeg: await readFile(snapshot.filePath) };
  } catch {
    return null;
  }
}

/** Inventário com regiões do recorte convertidas para o frame inteiro. */
export async function inventoryForImage(
  vision: VisionProvider,
  jpeg: Buffer,
  roi: Camera['roi'],
): Promise<{ inventory: Inventory; usage: unknown }> {
  const crop = roiBoundingBox(roi, ROI_MARGIN);
  const cropped = await cropJpeg(jpeg, crop, { maxSide: MAX_SIDE });
  const res = await vision.inventory(cropped);
  return {
    inventory: {
      items: res.data.items.map((i) => ({ ...i, region: regionFromCrop(i.region, crop) })),
      updatedAt: new Date().toISOString(),
    },
    usage: res.usage,
  };
}

/** Refaz o INVENTORY sobre o baseline atual (a cada N eventos ou sob demanda). */
export async function refreshInventory(
  cameraId: string,
  vision: VisionProvider,
  log: FastifyBaseLogger,
) {
  const camera = await db.query.cameras.findFirst({ where: eq(cameras.id, cameraId) });
  if (!camera) return null;
  const baseline = await loadBaseline(camera);
  if (!baseline) throw new Error('Câmera sem baseline: memorize a prateleira primeiro.');
  const { inventory } = await inventoryForImage(vision, baseline.jpeg, camera.roi);
  await db
    .update(cameras)
    .set({ inventory, eventsSinceInventory: 0 })
    .where(eq(cameras.id, cameraId));
  log.info({ cameraId, items: inventory.items.length }, 'Inventário atualizado');
  return inventory;
}

export interface ComparisonInput {
  cameraId: string;
  after: Buffer;
  personEnteredAt: Date;
  personLeftAt: Date;
  vision: VisionProvider;
  log: FastifyBaseLogger;
}

/**
 * Comparação antes/depois (seção 8.5): pré-filtro → IA → classificação →
 * persistência → after vira baseline → SSE. Retorna o tipo do evento gerado.
 */
export async function runComparison(input: ComparisonInput): Promise<EventType | null> {
  const { cameraId, after, vision, log } = input;
  const camera = await db.query.cameras.findFirst({ where: eq(cameras.id, cameraId) });
  if (!camera) return null;
  const baseline = await loadBaseline(camera);
  const afterSnap = await saveSnapshot(cameraId, 'after', after, input.personLeftAt);

  if (!baseline) {
    // Sem baseline não há o que comparar; o after passa a ser a referência.
    await db
      .update(cameras)
      .set({ baselineSnapshotId: afterSnap.id })
      .where(eq(cameras.id, cameraId));
    log.warn({ cameraId }, 'Análise sem baseline; after virou baseline');
    return null;
  }

  const roi = camera.roi;
  let type: EventType;
  let summary: string;
  let details: EventDetails;
  let score: number | null = null;
  let comparison: Comparison | null = null;

  try {
    score = await sceneDiff(baseline.jpeg, after, roi);
  } catch (err) {
    log.warn({ err }, 'Falha no pré-filtro; seguindo para a IA');
  }

  if (score !== null && score < env.SCENE_DIFF_MIN) {
    type = 'no_change';
    summary = 'Pessoa passou pela prateleira sem alterar os produtos.';
    details = { reason: 'below_diff_threshold', roi };
    log.info({ cameraId, score }, 'Pré-filtro: sem alteração relevante (IA não chamada)');
  } else {
    const crop = roiBoundingBox(roi, ROI_MARGIN);
    try {
      const [beforeCrop, afterCrop] = await Promise.all([
        cropJpeg(baseline.jpeg, crop, { maxSide: MAX_SIDE }),
        cropJpeg(after, crop, { maxSide: MAX_SIDE }),
      ]);
      const invInCrop: Inventory | null = camera.inventory
        ? {
            items: camera.inventory.items.map((i) => ({
              ...i,
              region: regionToCrop(i.region, crop),
            })),
          }
        : null;
      const res = await vision.compare(beforeCrop, afterCrop, invInCrop);
      comparison = {
        ...res.data,
        changes: res.data.changes.map((c) => ({
          ...c,
          beforeRegion: c.beforeRegion ? regionFromCrop(c.beforeRegion, crop) : null,
          afterRegion: c.afterRegion ? regionFromCrop(c.afterRegion, crop) : null,
        })),
      };
      type = classifyComparison(comparison);
      summary =
        comparison.summary ||
        (type === 'no_change'
          ? 'Nenhuma alteração nos produtos.'
          : 'Alteração detectada na prateleira.');
      details = { reason: 'vision', comparison, usage: res.usage, crop, roi };
    } catch (err) {
      const usage = err instanceof VisionError ? err.usage : null;
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ cameraId, err: message }, 'Falha na comparação por IA');
      type = 'analysis_failed';
      summary = `Não foi possível analisar a passagem: ${message}`;
      details = { reason: 'vision_error', error: message, usage: usage ?? undefined, crop, roi };
    }
  }

  const createdAt = new Date();
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(events)
      .values({
        cameraId,
        type,
        severity: severityOf(type),
        personEnteredAt: input.personEnteredAt,
        personLeftAt: input.personLeftAt,
        beforeSnapshotId: baseline.snapshot.id,
        afterSnapshotId: afterSnap.id,
        summary,
        details,
        sceneDiffScore: score,
        createdAt,
      })
      .returning();
    await tx
      .update(cameras)
      .set({
        // O after vira o novo baseline (seção 8.4, ANALYZING).
        baselineSnapshotId: afterSnap.id,
        ...(comparison ? { inventory: applyChanges(camera.inventory, comparison.changes) } : {}),
        eventsSinceInventory: sql`${cameras.eventsSinceInventory} + 1`,
      })
      .where(eq(cameras.id, cameraId));
    return inserted;
  });

  const dto = serializeEvent(row!, baseline.snapshot, afterSnap);
  bus.emit('event.created', { cameraId, event: dto });
  log.info({ cameraId, type, score, summary }, 'Evento gerado');

  if (
    camera.eventsSinceInventory + 1 >= env.INVENTORY_REFRESH_EVERY &&
    type !== 'analysis_failed'
  ) {
    void refreshInventory(cameraId, vision, log).catch((err: unknown) =>
      log.warn({ err }, 'Falha ao atualizar inventário periódico'),
    );
  }
  return type;
}

/** Evento de oclusão prolongada (pessoa parada na frente da prateleira). */
export async function recordOcclusionTimeout(
  cameraId: string,
  personEnteredAt: Date,
  log: FastifyBaseLogger,
) {
  const camera = await db.query.cameras.findFirst({ where: eq(cameras.id, cameraId) });
  if (!camera) return;
  const minutes = Math.round(env.MAX_OCCLUSION_SECONDS / 60);
  const [row] = await db
    .insert(events)
    .values({
      cameraId,
      type: 'no_change',
      severity: severityOf('no_change'),
      personEnteredAt,
      beforeSnapshotId: camera.baselineSnapshotId,
      summary: `Prateleira encoberta por mais de ${minutes} min; a análise continua quando a pessoa sair.`,
      details: { reason: 'occlusion_timeout' },
      createdAt: new Date(),
    })
    .returning();
  const before = camera.baselineSnapshotId
    ? await db.query.snapshots.findFirst({ where: eq(snapshots.id, camera.baselineSnapshotId) })
    : null;
  bus.emit('event.created', { cameraId, event: serializeEvent(row!, before) });
  log.info({ cameraId }, 'Oclusão prolongada registrada');
}
