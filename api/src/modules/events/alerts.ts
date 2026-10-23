import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db/client';
import { cameras, events, stores } from '../../db/schema';
import { serializeEvent } from './serializer';

/**
 * GET /alerts — alertas recentes (produto retirado ou movido) de todas as câmeras,
 * com loja e câmera, para o sino de notificações.
 */
export const alertRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/alerts',
    {
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
      },
    },
    async (req) => {
      const rows = await db
        .select({
          event: events,
          cameraName: cameras.name,
          storeId: stores.id,
          storeName: stores.name,
        })
        .from(events)
        .innerJoin(cameras, eq(cameras.id, events.cameraId))
        .innerJoin(stores, eq(stores.id, cameras.storeId))
        .where(
          and(
            inArray(events.severity, ['alert', 'attention']),
            // Aguardando a conferência de compras: só entra no sino depois dela.
            sql`coalesce(${events.purchase}->>'status', '') <> 'pending'`,
          ),
        )
        .orderBy(desc(events.createdAt))
        .limit(req.query.limit);
      return {
        items: rows.map((r) => ({
          cameraId: r.event.cameraId,
          cameraName: r.cameraName,
          storeId: r.storeId,
          storeName: r.storeName,
          event: serializeEvent(r.event),
        })),
      };
    },
  );
};
