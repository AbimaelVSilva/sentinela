import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db/client';
import { snapshots } from '../../db/schema';
import { klaviConfigured, listBranches } from '../../integrations/klavi';
import { serializeEvent } from '../events/serializer';
import { runPurchaseCheck } from './checker';

export const purchaseRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Situação da integração e filiais da Klavi (para vincular às lojas). */
  app.get('/integrations/klavi', async () => {
    if (!klaviConfigured()) return { configured: false, branches: [] };
    try {
      return { configured: true, branches: await listBranches() };
    } catch (err) {
      return {
        configured: true,
        branches: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  /** Confere (de novo) as compras de uma ocorrência — ex.: eventos antigos ou após erro. */
  app.post(
    '/events/:id/purchases',
    { schema: { params: z.object({ id: z.uuid() }) } },
    async (req) => {
      const row = await runPurchaseCheck(req.params.id, req.log);
      if (!row) {
        throw app.httpErrors.badRequest(
          'Não dá para conferir: loja sem filial da Klavi vinculada ou passagem sem horário.',
        );
      }
      const [before, after] = await Promise.all(
        [row.beforeSnapshotId, row.afterSnapshotId].map((id) =>
          id ? db.query.snapshots.findFirst({ where: eq(snapshots.id, id) }) : null,
        ),
      );
      return serializeEvent(row, before, after);
    },
  );
};
