import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env';
import fs from 'node:fs';
import { db } from '../../db/client';
import { visionModel } from '../../vision';
import { getVisionSettings } from '../settings/service';

const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number(),
  db: z.boolean(),
  mediamtx: z.boolean(),
  detector: z.boolean(),
  vision: z.object({ provider: z.string(), model: z.string() }),
  time: z.string(),
});

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health', { schema: { response: { 200: HealthResponse } } }, async () => {
    const [dbOk, mtxOk] = await Promise.all([
      check(() => db.execute(sql`select 1`)),
      check(async () => {
        const res = await fetch(`${env.MEDIAMTX_API_URL}/v3/paths/list`, {
          signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) throw new Error(String(res.status));
      }),
    ]);
    return {
      status: dbOk && mtxOk ? ('ok' as const) : ('degraded' as const),
      uptimeSeconds: Math.round(process.uptime()),
      db: dbOk,
      mediamtx: mtxOk,
      detector: fs.existsSync(env.YOLO_MODEL_PATH),
      vision: { provider: getVisionSettings().provider, model: visionModel() },
      time: new Date().toISOString(),
    };
  });
};
