import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db/client';
import { cameras, events, type Store, stores } from '../../db/schema';
import { bus } from '../../lib/bus';
import { removeCameraDir } from '../../storage';
import { serializeCamera } from '../cameras/serializer';
import { serializeEvent } from '../events/serializer';

const IdParams = z.object({ id: z.uuid() });
const StoreBody = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(120),
  address: z.string().trim().max(300).nullish(),
  /** Filiais da Klavi (ids de 24 caracteres hex); [] remove a integração. */
  klaviBranchIds: z
    .array(z.string().regex(/^[a-f0-9]{24}$/, 'Filial da Klavi inválida'))
    .max(10)
    .nullish(),
});

const serializeStore = (s: Store) => ({
  id: s.id,
  name: s.name,
  address: s.address,
  klaviBranchIds: s.klaviBranchIds ?? [],
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

/** Carrega lojas com a câmera (0..1), alertas das últimas 24 h e último evento. */
async function loadStores(ids?: string[]) {
  const rows = await db
    .select()
    .from(stores)
    .where(ids ? inArray(stores.id, ids) : undefined)
    .orderBy(desc(stores.createdAt));
  if (rows.length === 0) return [];

  const storeIds = rows.map((r) => r.id);
  const cams = await db.query.cameras.findMany({ where: inArray(cameras.storeId, storeIds) });
  const camIds = cams.map((c) => c.id);

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const alertCounts = camIds.length
    ? await db
        .select({ cameraId: events.cameraId, count: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            inArray(events.cameraId, camIds),
            eq(events.severity, 'alert'),
            gte(events.createdAt, since),
          ),
        )
        .groupBy(events.cameraId)
    : [];

  const lastEvents = camIds.length
    ? await db
        .selectDistinctOn([events.cameraId])
        .from(events)
        .where(inArray(events.cameraId, camIds))
        .orderBy(events.cameraId, desc(events.createdAt))
    : [];

  return rows.map((s) => {
    const cams_ = cams.filter((c) => c.storeId === s.id);
    return {
      ...serializeStore(s),
      cameras: cams_.map((c) => ({
        ...serializeCamera(c),
        lastEvent: (() => {
          const e = lastEvents.find((le) => le.cameraId === c.id);
          return e ? serializeEvent(e) : null;
        })(),
      })),
      alerts24h: alertCounts
        .filter((a) => cams_.some((c) => c.id === a.cameraId))
        .reduce((acc, a) => acc + a.count, 0),
    };
  });
}

export const storeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/stores', async () => loadStores());

  app.post('/stores', { schema: { body: StoreBody } }, async (req, reply) => {
    const [row] = await db
      .insert(stores)
      .values({
        name: req.body.name,
        address: req.body.address || null,
        klaviBranchIds: req.body.klaviBranchIds?.length ? req.body.klaviBranchIds : null,
      })
      .returning();
    const [full] = await loadStores([row!.id]);
    return reply.code(201).send(full);
  });

  app.get('/stores/:id', { schema: { params: IdParams } }, async (req) => {
    const [full] = await loadStores([req.params.id]);
    if (!full) throw app.httpErrors.notFound('Loja não encontrada');
    return full;
  });

  app.patch(
    '/stores/:id',
    { schema: { params: IdParams, body: StoreBody.partial() } },
    async (req) => {
      const patch: Partial<typeof stores.$inferInsert> = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.address !== undefined) patch.address = req.body.address || null;
      if (req.body.klaviBranchIds !== undefined)
        patch.klaviBranchIds = req.body.klaviBranchIds?.length ? req.body.klaviBranchIds : null;
      if (Object.keys(patch).length > 0) {
        const res = await db
          .update(stores)
          .set(patch)
          .where(eq(stores.id, req.params.id))
          .returning({ id: stores.id });
        if (res.length === 0) throw app.httpErrors.notFound('Loja não encontrada');
      }
      const [full] = await loadStores([req.params.id]);
      if (!full) throw app.httpErrors.notFound('Loja não encontrada');
      return full;
    },
  );

  app.delete('/stores/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const cams = await db.query.cameras.findMany({
      where: eq(cameras.storeId, req.params.id),
      columns: { id: true, streamKey: true },
    });
    const res = await db
      .delete(stores)
      .where(eq(stores.id, req.params.id))
      .returning({ id: stores.id });
    if (res.length === 0) throw app.httpErrors.notFound('Loja não encontrada');
    for (const c of cams) {
      bus.emit('camera.deleted', { cameraId: c.id, streamKey: c.streamKey });
      await removeCameraDir(c.id);
    }
    return reply.code(204).send();
  });
};
