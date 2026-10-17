import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listModels, providerCatalog } from '../../vision/catalog';
import { currentModel, getVisionSettings, updateVisionSettings } from './service';

const ProviderId = z.enum(['anthropic', 'openai', 'google', 'mock']);

function settingsDto() {
  const s = getVisionSettings();
  return {
    vision: { provider: s.provider, model: currentModel(s), effort: s.effort, models: s.models },
    providers: providerCatalog(),
  };
}

/**
 * Configurações do painel. As chaves de API ficam só no .env do servidor; aqui se
 * escolhe qual IA e qual modelo usar (vale na próxima análise, sem reiniciar).
 */
export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/settings', async () => settingsDto());

  app.patch(
    '/settings',
    {
      schema: {
        body: z.object({
          vision: z.object({
            provider: ProviderId.optional(),
            model: z
              .string()
              .trim()
              .min(1)
              .max(120)
              .regex(/^[A-Za-z0-9._:/@-]+$/, 'Nome de modelo inválido')
              .optional(),
            effort: z.enum(['low', 'medium', 'high']).optional(),
          }),
        }),
      },
    },
    async (req) => {
      const { provider, model, effort } = req.body.vision;
      const target = providerCatalog().find(
        (p) => p.id === (provider ?? getVisionSettings().provider),
      )!;
      if (!target.configured) {
        throw app.httpErrors.badRequest(
          `${target.label} não tem chave configurada no servidor (defina ${target.keyEnv} no .env).`,
        );
      }
      await updateVisionSettings({ provider, model, effort });
      req.log.info({ provider, model, effort }, 'Configurações de IA atualizadas');
      return settingsDto();
    },
  );

  app.get(
    '/settings/models',
    { schema: { querystring: z.object({ provider: ProviderId }) } },
    async (req) => listModels(req.query.provider),
  );
};
