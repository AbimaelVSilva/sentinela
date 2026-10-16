import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { bus, PUBLIC_EVENTS } from '../../lib/bus';

const HEARTBEAT_MS = 15_000;

/** GET /stream — Server-Sent Events. `?cameraId=` filtra eventos de uma câmera. */
export const sseRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/stream',
    { schema: { querystring: z.object({ cameraId: z.uuid().optional() }) } },
    (req, reply) => {
      const { cameraId } = req.query;
      // Repassa os headers já definidos pelos plugins (CORS) antes de assumir o socket.
      const headers = {
        ...(reply.getHeaders() as Record<string, string>),
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      };
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, headers);
      res.write(`retry: 3000\n: conectado\n\n`);

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const unsubs = PUBLIC_EVENTS.map((name) =>
        bus.on(name, (payload) => {
          if (cameraId && payload.cameraId !== cameraId) return;
          send(name, payload);
        }),
      );
      const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);

      req.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubs.forEach((u) => u());
      });
    },
  );
};
