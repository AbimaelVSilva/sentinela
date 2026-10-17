import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env';
import { db } from '../db/client';
import { ANALYSIS_LIMITS } from '../domain/analysis-settings';
import { cameras } from '../db/schema';
import { bus } from '../lib/bus';
import type { VisionProvider } from '../vision/provider';
import { CameraWorker } from './camera-worker';
import { YoloPersonDetector } from './person-detector';

/**
 * Sobe/derruba os workers de análise conforme o status das câmeras.
 * Um erro em uma câmera nunca afeta as outras nem a API.
 */
export class WorkerManager {
  private readonly workers = new Map<string, CameraWorker>();
  private readonly unsubs: (() => void)[] = [];
  readonly detector: YoloPersonDetector;

  constructor(
    private readonly vision: VisionProvider,
    private readonly log: FastifyBaseLogger,
  ) {
    // Piso baixo: cada câmera filtra pela própria confiança mínima (configurações da análise).
    this.detector = new YoloPersonDetector(
      env.YOLO_MODEL_PATH,
      ANALYSIS_LIMITS.personConfidence[0],
      log.child({ module: 'yolo' }),
    );
    if (!this.detector.available) {
      log.warn(
        { path: env.YOLO_MODEL_PATH },
        'Modelo YOLO não encontrado — rode `npm run model:download`',
      );
    }
  }

  async start() {
    this.unsubs.push(
      bus.on('camera.status', ({ cameraId, status }) => {
        if (status === 'online') void this.ensure(cameraId);
        else this.remove(cameraId);
      }),
      bus.on('camera.updated', ({ cameraId }) => {
        const w = this.workers.get(cameraId);
        if (w)
          void w
            .reload()
            .catch((err: unknown) =>
              this.log.warn({ err, cameraId }, 'Falha ao recarregar worker'),
            );
      }),
      bus.on('camera.deleted', ({ cameraId }) => this.remove(cameraId)),
    );
    const online = await db
      .select({ id: cameras.id })
      .from(cameras)
      .where(eq(cameras.status, 'online'));
    await Promise.all(online.map((c) => this.ensure(c.id)));
  }

  stop() {
    this.unsubs.splice(0).forEach((u) => u());
    for (const id of [...this.workers.keys()]) this.remove(id);
  }

  get(cameraId: string): CameraWorker | undefined {
    return this.workers.get(cameraId);
  }

  private async ensure(cameraId: string) {
    if (this.workers.has(cameraId)) return;
    const cam = await db.query.cameras.findFirst({
      where: eq(cameras.id, cameraId),
      columns: { streamKey: true },
    });
    if (!cam || this.workers.has(cameraId)) return;
    const worker = new CameraWorker(cameraId, cam.streamKey, {
      detector: this.detector,
      vision: this.vision,
      log: this.log,
    });
    this.workers.set(cameraId, worker);
    try {
      await worker.start();
      this.log.info({ cameraId }, 'Worker de análise iniciado');
    } catch (err) {
      this.log.error({ err, cameraId }, 'Falha ao iniciar worker');
      this.workers.delete(cameraId);
      worker.stop();
    }
  }

  private remove(cameraId: string) {
    const w = this.workers.get(cameraId);
    if (!w) return;
    this.workers.delete(cameraId);
    w.stop();
    this.log.info({ cameraId }, 'Worker de análise parado');
  }
}
