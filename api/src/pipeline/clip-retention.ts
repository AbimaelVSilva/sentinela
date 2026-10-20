import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import fs from 'node:fs/promises';
import { env } from '../config/env';
import { db } from '../db/client';
import { events } from '../db/schema';
import { absPath } from '../storage';

export interface ExpiredClip {
  id: string;
  clipPath: string;
}

/** Acesso a banco e disco (injetável para testes). */
export interface RetentionDeps {
  findExpired(cutoff: Date, limit: number): Promise<ExpiredClip[]>;
  /** Apaga o arquivo e devolve os bytes liberados (0 se já não existia). */
  removeFile(relPath: string): Promise<number>;
  markDeleted(ids: string[], at: Date): Promise<void>;
}

const BATCH = 200;

export const dbRetentionDeps: RetentionDeps = {
  findExpired: (cutoff, limit) =>
    db
      .select({ id: events.id, clipPath: events.clipPath })
      .from(events)
      .where(
        and(eq(events.type, 'no_change'), isNotNull(events.clipPath), lt(events.createdAt, cutoff)),
      )
      .limit(limit) as Promise<ExpiredClip[]>,
  async removeFile(relPath) {
    const abs = absPath(relPath);
    try {
      const { size } = await fs.stat(abs);
      await fs.rm(abs, { force: true });
      return size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }
  },
  async markDeleted(ids, at) {
    if (ids.length === 0) return;
    await db
      .update(events)
      .set({ clipPath: null, clipDeletedAt: at })
      .where(inArray(events.id, ids));
  },
};

/**
 * Retenção dos vídeos: apaga os clipes de eventos "sem alteração" criados há mais de
 * `olderThanHours`. Retirado, movido e falha não são tocados. Idempotente.
 */
export async function cleanupNoChangeClips(opts: {
  olderThanHours?: number;
  now?: Date;
  log: FastifyBaseLogger;
  deps?: RetentionDeps;
}): Promise<{ deleted: number; bytes: number }> {
  const { log, deps = dbRetentionDeps } = opts;
  const now = opts.now ?? new Date();
  const hours = opts.olderThanHours ?? env.CLIP_RETENTION_NO_CHANGE_HOURS;
  const cutoff = new Date(now.getTime() - hours * 3600 * 1000);

  let deleted = 0;
  let bytes = 0;
  for (;;) {
    const batch = await deps.findExpired(cutoff, BATCH);
    if (batch.length === 0) break;
    const done: string[] = [];
    for (const clip of batch) {
      try {
        bytes += await deps.removeFile(clip.clipPath);
        done.push(clip.id);
      } catch (err) {
        log.warn({ eventId: clip.id, err }, 'Falha ao apagar vídeo expirado');
      }
    }
    await deps.markDeleted(done, now);
    deleted += done.length;
    // Se nada pôde ser apagado neste lote, para (evita laço infinito em erro de disco).
    if (done.length === 0 || batch.length < BATCH) break;
  }

  if (deleted > 0) {
    log.info(
      { deleted, freedMb: Math.round(bytes / 1024 / 1024), olderThanHours: hours },
      'Retenção: vídeos "sem alteração" apagados',
    );
  }
  return { deleted, bytes };
}

/**
 * Agenda a retenção: roda 1 min após subir a API e depois a cada
 * CLIP_CLEANUP_INTERVAL_MINUTES (padrão 60). Devolve a função para parar.
 */
export function startClipRetentionJob(log: FastifyBaseLogger): () => void {
  const intervalMs = env.CLIP_CLEANUP_INTERVAL_MINUTES * 60 * 1000;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupNoChangeClips({ log });
    } catch (err) {
      log.error({ err }, 'Falha no job de retenção de vídeos');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), 60_000);
  const timer = setInterval(() => void run(), intervalMs);
  log.info(
    {
      everyMinutes: env.CLIP_CLEANUP_INTERVAL_MINUTES,
      noChangeHours: env.CLIP_RETENTION_NO_CHANGE_HOURS,
    },
    'Job de retenção de vídeos agendado',
  );
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
