import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../../db/client';
import { cameras } from '../../db/schema';
import type { SceneValidationResult } from '../../domain/types';
import { bus, type CalibrationStage } from '../../lib/bus';
import { inventoryForImage, saveSnapshot } from '../../pipeline/analysis';
import { limitJpeg } from '../../pipeline/image';
import { getServices } from '../../services';
import { currentModel, getVisionSettings } from '../settings/service';

const running = new Set<string>();

export const isCalibrating = (cameraId: string) => running.has(cameraId);

function emit(cameraId: string, stage: CalibrationStage, extra: Record<string, unknown> = {}) {
  bus.emit('camera.calibration', { cameraId, stage, ...extra });
}

/**
 * Calibração ("Memorizar prateleira"), em background:
 * capturing → validating (VALIDATE_SCENE) → inventorying (INVENTORY) → done | failed.
 * Se a cena não for de prateleira e `force` for falso, salva a validação, não habilita
 * o monitoramento e termina em `failed` com os issues.
 */
export async function calibrate(cameraId: string, force: boolean, log: FastifyBaseLogger) {
  if (running.has(cameraId)) return;
  running.add(cameraId);
  const { workers, vision } = getServices();
  try {
    emit(cameraId, 'capturing', { message: 'Capturando imagem da prateleira…' });
    const worker = workers.get(cameraId);
    const frame = worker ? await worker.fullFrame() : null;
    if (!frame) throw new Error('Sem imagem da câmera. Verifique se ela está online.');

    emit(cameraId, 'validating', { message: 'Validando o enquadramento…' });
    const validation = await vision.validateScene(await limitJpeg(frame));
    const sceneValidation: SceneValidationResult = {
      ...validation.data,
      validatedAt: new Date().toISOString(),
      provider: getVisionSettings().provider,
      model: currentModel(),
      forced: force && !validation.data.isShelfScene ? true : undefined,
    };

    if (!validation.data.isShelfScene && !force) {
      await db
        .update(cameras)
        .set({ sceneValidation, monitoringEnabled: false })
        .where(eq(cameras.id, cameraId));
      bus.emit('camera.updated', { cameraId });
      emit(cameraId, 'failed', {
        message: 'A imagem não parece uma prateleira com produtos.',
        sceneValidation,
      });
      return;
    }

    emit(cameraId, 'inventorying', { message: 'Listando os produtos…', sceneValidation });
    const camera = await db.query.cameras.findFirst({ where: eq(cameras.id, cameraId) });
    if (!camera) throw new Error('Câmera removida durante a calibração.');
    const { inventory } = await inventoryForImage(vision, frame, camera.roi);
    const snapshot = await saveSnapshot(cameraId, 'baseline', frame);

    await db
      .update(cameras)
      .set({
        sceneValidation,
        inventory,
        baselineSnapshotId: snapshot.id,
        monitoringEnabled: true,
        eventsSinceInventory: 0,
      })
      .where(eq(cameras.id, cameraId));
    bus.emit('camera.updated', { cameraId });
    emit(cameraId, 'done', { message: 'Prateleira memorizada.', sceneValidation, inventory });
    log.info({ cameraId, items: inventory.items.length }, 'Calibração concluída');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ cameraId, err: message }, 'Falha na calibração');
    emit(cameraId, 'failed', { message: 'Falha na calibração.', error: message });
  } finally {
    running.delete(cameraId);
  }
}
