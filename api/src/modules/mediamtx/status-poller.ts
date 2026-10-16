import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../../db/client';
import { type CameraStatus, cameras } from '../../db/schema';
import { bus, type StreamInfo } from '../../lib/bus';
import { streamKeyFromPath } from '../../lib/stream-key';
import { runtime } from '../cameras/runtime';
import { listPaths, streamInfoFromPath } from './client';

const POLL_MS = 3_000;

/**
 * Consulta o MediaMTX a cada 3 s e sincroniza o status das câmeras.
 * Mudanças são persistidas e emitidas no bus (SSE + WorkerManager).
 */
export class StatusPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private mtxReachable = true;

  constructor(private readonly log: FastifyBaseLogger) {}

  start() {
    if (this.timer) return;
    const tick = () => {
      void this.poll().finally(() => {
        if (this.timer !== null) this.timer = setTimeout(tick, POLL_MS);
      });
    };
    this.timer = setTimeout(tick, 0);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Executa uma rodada (exposto para forçar sync após cadastro). */
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let paths;
      try {
        paths = await listPaths();
        if (!this.mtxReachable) this.log.info('MediaMTX acessível novamente');
        this.mtxReachable = true;
      } catch (err) {
        if (this.mtxReachable) this.log.warn({ err }, 'MediaMTX inacessível; status congelado');
        this.mtxReachable = false;
        return;
      }

      const byKey = new Map<string, StreamInfo>();
      for (const p of paths) {
        const key = streamKeyFromPath(p.name);
        if (key) byKey.set(key, streamInfoFromPath(p));
      }

      const all = await db
        .select({
          id: cameras.id,
          streamKey: cameras.streamKey,
          status: cameras.status,
          lastSeenAt: cameras.lastSeenAt,
        })
        .from(cameras);

      const now = new Date();
      for (const cam of all) {
        const info = byKey.get(cam.streamKey) ?? null;
        const online = info?.ready === true;
        const next: CameraStatus = online ? 'online' : cam.lastSeenAt ? 'offline' : 'pending';

        const prevStream = runtime.getStream(cam.id);
        runtime.setStream(cam.id, online ? info : null);
        const streamChanged =
          JSON.stringify(prevStream?.codecs ?? null) !==
          JSON.stringify(online ? info?.codecs : null);

        if (online) {
          await db
            .update(cameras)
            .set({ status: next, lastSeenAt: now })
            .where(eq(cameras.id, cam.id));
        } else if (next !== cam.status) {
          await db.update(cameras).set({ status: next }).where(eq(cameras.id, cam.id));
        }

        if (next !== cam.status || streamChanged) {
          this.log.info({ cameraId: cam.id, from: cam.status, to: next }, 'Status da câmera');
          bus.emit('camera.status', {
            cameraId: cam.id,
            status: next,
            lastSeenAt: online ? now.toISOString() : (cam.lastSeenAt?.toISOString() ?? null),
            stream: online ? info : null,
          });
        }
      }
    } catch (err) {
      this.log.error({ err }, 'Falha no polling de status');
    } finally {
      this.running = false;
    }
  }
}
