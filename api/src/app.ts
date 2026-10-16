import fs from 'node:fs';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from './config/env';
import { cameraRoutes } from './modules/cameras/routes';
import { eventRoutes } from './modules/events/routes';
import { sseRoutes } from './modules/events/sse';
import { healthRoutes } from './modules/health/routes';
import { mediamtxAuthRoutes } from './modules/mediamtx/auth';
import { storeRoutes } from './modules/stores/routes';

// Mensagens de validação do Zod em português.
z.config(z.locales.pt());

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

  // Erros de validação com mensagem legível (ex.: "name: Informe o nome").
  app.setErrorHandler<FastifyError>((error, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const first = error.validation[0];
      const field =
        first?.instancePath?.replace(/^\//, '').replace(/\//g, '.') || error.validationContext;
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `${field ? `${field}: ` : ''}${first?.message ?? 'dados inválidos'}`,
        issues: error.validation,
      });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, 'Erro não tratado');
    return reply.code(status).send({
      statusCode: status,
      error: error.name,
      message: status >= 500 ? 'Erro interno do servidor' : error.message,
    });
  });

  await app.register(healthRoutes);
  await app.register(storeRoutes);
  await app.register(cameraRoutes);
  await app.register(eventRoutes);
  await app.register(sseRoutes);
  await app.register(mediamtxAuthRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
