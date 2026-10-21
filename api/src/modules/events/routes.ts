import { and, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db/client';
import { cameras, type EventRow, eventTypeEnum, events, snapshots } from '../../db/schema';
import { serializeEvent } from './serializer';

/** Cursor opaco: `<createdAt ISO>|<id>` em base64url (ordem estável por created_at desc, id desc). */
const encodeCursor = (e: EventRow) =>
  Buffer.from(`${e.createdAt.toISOString()}|${e.id}`).toString('base64url');

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const createdAt = new Date(ts ?? '');
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

async function withSnapshots(rows: EventRow[]) {
  const ids = rows.flatMap((r) => [r.beforeSnapshotId, r.afterSnapshotId]).filter(Boolean);
  const snaps = ids.length
    ? await db
        .select()
        .from(snapshots)
        .where(inArray(snapshots.id, ids as string[]))
    : [];
  const byId = new Map(snaps.map((s) => [s.id, s]));
  return rows.map((r) =>
    serializeEvent(
      r,
      r.beforeSnapshotId ? byId.get(r.beforeSnapshotId) : null,
      r.afterSnapshotId ? byId.get(r.afterSnapshotId) : null,
    ),
  );
}

export const eventRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/cameras/:id/events',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        querystring: z.object({
          cursor: z.string().optional(),
          /** Intervalo [from, to) — o front manda o início/fim do dia no fuso do usuário. */
          from: z.iso.datetime({ offset: true }).optional(),
          to: z.iso.datetime({ offset: true }).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          type: z
            .union([z.enum(eventTypeEnum.enumValues), z.array(z.enum(eventTypeEnum.enumValues))])
            .optional(),
        }),
      },
    },
    async (req) => {
      const { id } = req.params;
      const { limit, cursor, type, from, to } = req.query;
      const cam = await db.query.cameras.findFirst({
        where: eq(cameras.id, id),
        columns: { id: true },
      });
      if (!cam) throw app.httpErrors.notFound('Câmera não encontrada');

      const c = cursor ? decodeCursor(cursor) : null;
      if (cursor && !c) throw app.httpErrors.badRequest('Cursor inválido');
      const types = type ? (Array.isArray(type) ? type : [type]) : null;

      const rows = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.cameraId, id),
            types ? inArray(events.type, types) : undefined,
            from ? gte(events.createdAt, new Date(from)) : undefined,
            to ? lt(events.createdAt, new Date(to)) : undefined,
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
      return {
        items: await withSnapshots(page),
        nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
      };
    },
  );

  app.get('/events/:id', { schema: { params: z.object({ id: z.uuid() }) } }, async (req) => {
    const row = await db.query.events.findFirst({ where: eq(events.id, req.params.id) });
    if (!row) throw app.httpErrors.notFound('Evento não encontrado');
    const [dto] = await withSnapshots([row]);
    return dto;
  });
};
