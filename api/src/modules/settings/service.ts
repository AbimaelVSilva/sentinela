import { eq } from 'drizzle-orm';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { appSettings, type VisionProviderId, type VisionSettings } from '../../db/schema';

const ROW_ID = 'default';

/** Valores iniciais vindos do .env (usados até alguém salvar pelo painel). */
export function envVisionSettings(): VisionSettings {
  return {
    provider: env.VISION_PROVIDER,
    models: {
      anthropic: env.VISION_MODEL,
      openai: env.OPENAI_MODEL,
      google: env.GOOGLE_MODEL,
      openrouter: env.OPENROUTER_MODEL,
      mock: 'mock',
    },
    effort: env.VISION_EFFORT,
  };
}

let cache: VisionSettings | null = null;

/** Carrega do banco (uma vez) e mescla com os padrões do .env. */
export async function loadVisionSettings(): Promise<VisionSettings> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.id, ROW_ID) });
  const base = envVisionSettings();
  cache = row?.vision
    ? { ...base, ...row.vision, models: { ...base.models, ...row.vision.models } }
    : base;
  return cache;
}

/** Configuração vigente (síncrona; exige loadVisionSettings no boot). */
export function getVisionSettings(): VisionSettings {
  return cache ?? envVisionSettings();
}

export function currentModel(s: VisionSettings = getVisionSettings()): string {
  return s.provider === 'mock'
    ? 'mock'
    : (s.models[s.provider] ?? envVisionSettings().models[s.provider]!);
}

export async function updateVisionSettings(patch: {
  provider?: VisionProviderId;
  model?: string;
  effort?: VisionSettings['effort'];
}): Promise<VisionSettings> {
  const cur = getVisionSettings();
  const provider = patch.provider ?? cur.provider;
  const next: VisionSettings = {
    provider,
    effort: patch.effort ?? cur.effort,
    models: patch.model ? { ...cur.models, [provider]: patch.model } : cur.models,
  };
  await db
    .insert(appSettings)
    .values({ id: ROW_ID, vision: next })
    .onConflictDoUpdate({ target: appSettings.id, set: { vision: next } });
  cache = next;
  return next;
}
