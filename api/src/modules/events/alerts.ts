import { and, desc, eq, gte, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db/client';
import { cameras, events, stores } from '../../db/schema';
import { decodeCursor, encodeCursor } from './cursor';
import { withSnapshots } from './routes';

const ALERT_SEVERITIES = ['alert', 'attention'] as const;

/**
 * GET /alerts — alertas (vermelhos e laranjas) de todas as câmeras, com loja e câmera.
 * Usado pelo sino (só `limit`) e pela tela de alertas (filtros + paginação por cursor).
 * Sem cursor, devolve também a contagem por severidade com os mesmos filtros.
 */
export const alertRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/alerts',
    {
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(30),
          cursor: z.string().optional(),
          severity: z.enum(ALERT_SEVERITIES).optional(),
          storeId: z.uuid().optional(),
          /** Intervalo [from, to). */
          from: z.iso.datetime({ offset: true }).optional(),
          to: z.iso.datetime({ offset: true }).optional(),
        }),
      },
    },
    async (req) => {
      const { limit, cursor, severity, storeId, from, to } = req.query;
      const c = cursor ? decodeCursor(cursor) : null;
      if (cursor && !c) throw app.httpErrors.badRequest('Cursor inválido');

      // Filtros comuns à lista e à contagem (a severidade só filtra a lista).
      const base: (SQL | undefined)[] = [
        inArray(events.severity, [...ALERT_SEVERITIES]),
        // Aguardando a conferência de compras: só aparece depois dela.
        sql`coalesce(${events.purchase}->>'status', '') <> 'pending'`,
        storeId ? eq(cameras.storeId, storeId) : undefined,
        from ? gte(events.createdAt, new Date(from)) : undefined,
        to ? lt(events.createdAt, new Date(to)) : undefined,
      ];

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
            ...base,
            severity ? eq(events.severity, severity) : undefined,
            c
              ? or(
                  lt(events.createdAt, c.createdAt),
                  and(eq(events.createdAt, c.createdAt), lt(events.id, c.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(events.createdAt), desc(events.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const dtos = await withSnapshots(page.map((r) => r.event));

      const counts = cursor
        ? undefined
        : Object.fromEntries(
            (
              await db
                .select({ severity: events.severity, n: sql<number>`count(*)::int` })
                .from(events)
                .innerJoin(cameras, eq(cameras.id, events.cameraId))
                .where(and(...base))
                .groupBy(events.severity)
            ).map((r) => [r.severity, r.n]),
          );

      return {
        items: page.map((r, i) => ({
          cameraId: r.event.cameraId,
          cameraName: r.cameraName,
          storeId: r.storeId,
          storeName: r.storeName,
          event: dtos[i]!,
        })),
        nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!.event) : null,
        ...(counts
          ? { counts: { alert: counts.alert ?? 0, attention: counts.attention ?? 0 } }
          : {}),
      };
    },
  );
};
