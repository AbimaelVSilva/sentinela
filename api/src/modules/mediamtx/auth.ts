import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db/client';
import { cameras } from '../../db/schema';
import { streamKeyFromPath } from '../../lib/stream-key';

const AuthPayload = z.looseObject({
  action: z.string(),
  path: z.string().optional().default(''),
  protocol: z.string().optional(),
  ip: z.string().optional(),
  user: z.string().optional(),
  id: z.string().nullish(),
  query: z.string().optional(),
});

/**
 * Hook HTTP de autenticação do MediaMTX. Não é segurança — é roteamento:
 * só aceita publicação em `live/<key>` de uma câmera cadastrada.
 */
export const mediamtxAuthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/mediamtx/auth',
    { schema: { body: AuthPayload }, logLevel: 'warn' },
    async (req, reply) => {
      const { action, path, protocol, ip } = req.body;

      if (action !== 'publish') return reply.code(200).send();

      const key = streamKeyFromPath(path);
      const found = key
        ? await db.query.cameras.findFirst({
            where: eq(cameras.streamKey, key),
            columns: { id: true },
          })
        : undefined;

      if (!found) {
        req.log.warn({ path, protocol, ip }, 'Publicação recusada: stream key desconhecida');
        return reply.code(401).send();
      }
      req.log.info({ path, protocol, ip, cameraId: found.id }, 'Publicação autorizada');
      return reply.code(200).send();
    },
  );
};
