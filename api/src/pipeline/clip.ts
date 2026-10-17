import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env';
import { db } from '../db/client';
import { events, snapshots } from '../db/schema';
import { bus } from '../lib/bus';
import { serializeEvent } from '../modules/events/serializer';
import { saveFile } from '../storage';

/** Margem para o MediaMTX gravar o fim do trecho antes do recorte. */
const FLUSH_MS = 2500;

export interface ClipWindow {
  start: Date;
  durationSeconds: number;
}

/**
 * Janela do vídeo: alguns segundos antes da pessoa entrar até um pouco depois de sair.
 * Se ficar longa demais, mantém o final (onde está a ação que gerou o evento).
 */
export function clipWindow(
  enteredAt: Date,
  leftAt: Date,
  opts = { pre: env.CLIP_PRE_SECONDS, post: env.CLIP_POST_SECONDS, max: env.CLIP_MAX_SECONDS },
): ClipWindow {
  const end = leftAt.getTime() + opts.post * 1000;
  let start = Math.min(enteredAt.getTime(), leftAt.getTime()) - opts.pre * 1000;
  if (end - start > opts.max * 1000) start = end - opts.max * 1000;
  return { start: new Date(start), durationSeconds: Math.max(1, (end - start) / 1000) };
}

/** Recorta um MP4 das gravações do MediaMTX (servidor de playback). */
export async function fetchClip(streamKey: string, w: ClipWindow): Promise<Buffer | null> {
  const url = new URL('/get', env.MEDIAMTX_PLAYBACK_URL);
  url.searchParams.set('path', `live/${streamKey}`);
  url.searchParams.set('start', w.start.toISOString());
  url.searchParams.set('duration', w.durationSeconds.toFixed(1));
  url.searchParams.set('format', 'mp4');
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`playback respondeu ${res.status}: ${body.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 1000 ? buf : null;
}

/**
 * Gera o vídeo curto de um evento em segundo plano: espera o fim do trecho ser
 * gravado, recorta, salva no storage, atualiza o evento e avisa a UI (event.updated).
 * Falhas só são logadas — o evento continua válido sem vídeo.
 */
export async function captureEventClip(args: {
  eventId: string;
  cameraId: string;
  streamKey: string;
  enteredAt: Date;
  leftAt: Date;
  log: FastifyBaseLogger;
}): Promise<void> {
  if (!env.CLIP_ENABLED) return;
  const { eventId, cameraId, streamKey, log } = args;
  const w = clipWindow(args.enteredAt, args.leftAt);
  const readyAt = w.start.getTime() + w.durationSeconds * 1000 + FLUSH_MS;
  const wait = readyAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  try {
    const mp4 = await fetchClip(streamKey, w);
    if (!mp4) {
      log.warn({ eventId }, 'Vídeo do evento vazio (sem gravação no período?)');
      return;
    }
    const filePath = await saveFile(cameraId, `clip-${eventId}.mp4`, mp4);
    const [row] = await db
      .update(events)
      .set({ clipPath: filePath, clipDuration: w.durationSeconds })
      .where(eq(events.id, eventId))
      .returning();
    if (!row) return; // evento/câmera removidos nesse meio-tempo
    const [before, after] = await Promise.all(
      [row.beforeSnapshotId, row.afterSnapshotId].map((id) =>
        id ? db.query.snapshots.findFirst({ where: eq(snapshots.id, id) }) : null,
      ),
    );
    bus.emit('event.updated', { cameraId, event: serializeEvent(row, before, after) });
    log.info(
      { eventId, seconds: w.durationSeconds, kb: Math.round(mp4.length / 1024) },
      'Vídeo do evento salvo',
    );
  } catch (err) {
    log.warn(
      { eventId, err: err instanceof Error ? err.message : String(err) },
      'Falha ao gerar o vídeo do evento',
    );
  }
}
