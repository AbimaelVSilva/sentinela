import fs from 'node:fs';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { env } from './config/env';
import { cameraRoutes } from './modules/cameras/routes';
import { eventRoutes } from './modules/events/routes';
import { sseRoutes } from './modules/events/sse';
import { healthRoutes } from './modules/health/routes';
import { mediamtxAuthRoutes } from './modules/mediamtx/auth';
import { storeRoutes } from './modules/stores/routes';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: true },
            }
          : undefined,
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Protótipo: CORS liberado. Ponto de extensão para restringir origens.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(sensible);

  fs.mkdirSync(env.STORAGE_DIR, { recursive: true });
  await app.register(fastifyStatic, { root: env.STORAGE_DIR, prefix: '/files/' });

  await app.register(healthRoutes);
  await app.register(storeRoutes);
  await app.register(cameraRoutes);
  await app.register(eventRoutes);
  await app.register(sseRoutes);
  await app.register(mediamtxAuthRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
