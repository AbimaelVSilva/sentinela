import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db/client';
import { AnalysisPatchSchema, mergeAnalysisOverrides } from '../../domain/analysis-settings';
import { type Camera, cameras, snapshots, stores } from '../../db/schema';
import { bus } from '../../lib/bus';
import { generateStreamKey } from '../../lib/stream-key';
import { removeCameraDir } from '../../storage';
import { kickPublisher } from '../mediamtx/client';
import { refreshInventory } from '../../pipeline/analysis';
import { getServices } from '../../services';
import { calibrate, isCalibrating } from './calibration';
import { rtmpInfo, serializeCamera } from './serializer';

const IdParams = z.object({ id: z.uuid() });

const PointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const RoiSchema = z
  .array(PointSchema)
  .min(3, 'A ROI precisa de pelo menos 3 pontos')
  .max(64);

const CreateCameraBody = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(120),
  model: z.string().trim().max(60).nullish(),
  serial: z.string().trim().max(120).nullish(),
  qrRaw: z.string().max(4000).nullish(),
});

const PatchCameraBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().max(60).nullish(),
  roi: RoiSchema.nullable().optional(),
  monitoringEnabled: z.boolean().optional(),
  /** Ajustes da análise: valor novo ou null para voltar ao padrão. */
  analysisSettings: AnalysisPatchSchema.optional(),
});

export async function loadCameraDto(id: string) {
  const cam = await db.query.cameras.findFirst({ where: eq(cameras.id, id) });
  if (!cam) return null;
  return dtoFor(cam);
}

async function dtoFor(cam: Camera) {
  const baseline = cam.baselineSnapshotId
    ? await db.query.snapshots.findFirst({ where: eq(snapshots.id, cam.baselineSnapshotId) })
    : null;
  return serializeCamera(cam, baseline);
}

export const cameraRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/stores/:id/cameras',
    { schema: { params: IdParams, body: CreateCameraBody } },
    async (req, reply) => {
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, req.params.id),
        columns: { id: true },
      });
      if (!store) throw app.httpErrors.notFound('Loja não encontrada');

      const [cam] = await db
        .insert(cameras)
        .values({
          storeId: store.id,
          name: req.body.name,
          model: req.body.model || null,
          serial: req.body.serial || null,
          qrRaw: req.body.qrRaw || null,
          streamKey: generateStreamKey(),
        })
        .returning();
      const dto = await dtoFor(cam!);
      return reply.code(201).send({ camera: dto, rtmp: rtmpInfo(cam!.streamKey) });
    },
  );

  app.get('/cameras/:id', { schema: { params: IdParams } }, async (req) => {
    const dto = await loadCameraDto(req.params.id);
    if (!dto) throw app.httpErrors.notFound('Câmera não encontrada');
    return dto;
  });

  app.patch(
    '/cameras/:id',
    { schema: { params: IdParams, body: PatchCameraBody } },
    async (req) => {
      const { name, model, roi, monitoringEnabled, analysisSettings } = req.body;
      const patch: Partial<typeof cameras.$inferInsert> = {};
      if (analysisSettings !== undefined) {
        const cur = await db.query.cameras.findFirst({
          where: eq(cameras.id, req.params.id),
          columns: { analysisSettings: true },
        });
        if (!cur) throw app.httpErrors.notFound('Câmera não encontrada');
        patch.analysisSettings = mergeAnalysisOverrides(cur.analysisSettings, analysisSettings);
      }
      if (name !== undefined) patch.name = name;
      if (model !== undefined) patch.model = model || null;
      if (roi !== undefined) patch.roi = roi;
      if (monitoringEnabled !== undefined) patch.monitoringEnabled = monitoringEnabled;

      if (Object.keys(patch).length > 0) {
        const res = await db
          .update(cameras)
          .set(patch)
          .where(eq(cameras.id, req.params.id))
          .returning({ id: cameras.id });
        if (res.length === 0) throw app.httpErrors.notFound('Câmera não encontrada');
        bus.emit('camera.updated', { cameraId: req.params.id });
      }
      const dto = await loadCameraDto(req.params.id);
      if (!dto) throw app.httpErrors.notFound('Câmera não encontrada');
      return dto;
    },
  );

  app.delete('/cameras/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const [cam] = await db
      .delete(cameras)
      .where(eq(cameras.id, req.params.id))
      .returning({ id: cameras.id, streamKey: cameras.streamKey });
    if (!cam) throw app.httpErrors.notFound('Câmera não encontrada');
    bus.emit('camera.deleted', { cameraId: cam.id, streamKey: cam.streamKey });
    void kickPublisher(cam.streamKey);
    await removeCameraDir(cam.id);
    return reply.code(204).send();
  });

  app.post('/cameras/:id/regenerate-key', { schema: { params: IdParams } }, async (req) => {
    const old = await db.query.cameras.findFirst({
      where: eq(cameras.id, req.params.id),
      columns: { streamKey: true },
    });
    if (!old) throw app.httpErrors.notFound('Câmera não encontrada');
    const [cam] = await db
      .update(cameras)
      .set({ streamKey: generateStreamKey() })
      .where(eq(cameras.id, req.params.id))
      .returning();
    // A sessão publicando na key antiga é derrubada; o worker é recriado com a nova key.
    void kickPublisher(old.streamKey);
    bus.emit('camera.updated', { cameraId: cam!.id });
    return { camera: await dtoFor(cam!), rtmp: rtmpInfo(cam!.streamKey) };
  });

  app.get(
    '/cameras/:id/snapshot',
    { schema: { params: IdParams }, logLevel: 'warn' },
    async (req, reply) => {
      const cam = await db.query.cameras.findFirst({
        where: eq(cameras.id, req.params.id),
        columns: { id: true, status: true },
      });
      if (!cam) throw app.httpErrors.notFound('Câmera não encontrada');
      const worker = getServices().workers.get(cam.id);
      const jpeg = worker ? await worker.currentFrame(4000) : null;
      if (!jpeg) throw app.httpErrors.notFound('Sem frame disponível (câmera offline?)');
      return reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'no-store')
        .send(jpeg);
    },
  );

  app.post(
    '/cameras/:id/calibrate',
    {
      schema: {
        params: IdParams,
        body: z
          .object({ force: z.boolean().optional().default(false) })
          .optional()
          .default({ force: false }),
      },
    },
    async (req, reply) => {
      const cam = await db.query.cameras.findFirst({
        where: eq(cameras.id, req.params.id),
        columns: { id: true, status: true },
      });
      if (!cam) throw app.httpErrors.notFound('Câmera não encontrada');
      if (cam.status !== 'online')
        throw app.httpErrors.conflict('A câmera precisa estar online para calibrar');
      if (isCalibrating(cam.id)) throw app.httpErrors.conflict('Calibração já em andamento');
      void calibrate(cam.id, req.body.force, req.log);
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post('/cameras/:id/inventory/refresh', { schema: { params: IdParams } }, async (req) => {
    try {
      const inventory = await refreshInventory(req.params.id, getServices().vision, req.log);
      if (!inventory) throw app.httpErrors.notFound('Câmera não encontrada');
      return { inventory };
    } catch (err) {
      if (err instanceof Error && 'statusCode' in err) throw err;
      throw app.httpErrors.badRequest(err instanceof Error ? err.message : String(err));
    }
  });
};
