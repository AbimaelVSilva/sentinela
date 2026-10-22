import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { env } from '../config/env';
import type { VisionProviderId } from '../db/schema';

export interface ProviderInfo {
  id: VisionProviderId;
  label: string;
  /** Há credencial no servidor para este provider? */
  configured: boolean;
  /** Variável de ambiente onde a chave deve ser definida. */
  keyEnv: string | null;
  defaultModel: string;
  suggestedModels: string[];
}

export function providerCatalog(): ProviderInfo[] {
  return [
    {
      id: 'anthropic',
      label: 'Anthropic (Claude)',
      configured: !!(env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      keyEnv: 'ANTHROPIC_API_KEY',
      defaultModel: env.VISION_MODEL,
      suggestedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    },
    {
      id: 'openai',
      label: 'OpenAI (GPT)',
      configured: !!env.OPENAI_API_KEY,
      keyEnv: 'OPENAI_API_KEY',
      defaultModel: env.OPENAI_MODEL,
      suggestedModels: ['gpt-5.1', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
    },
    {
      id: 'google',
      label: 'Google (Gemini)',
      configured: !!(env.GOOGLE_API_KEY || env.GEMINI_API_KEY),
      keyEnv: 'GOOGLE_API_KEY',
      defaultModel: env.GOOGLE_MODEL,
      suggestedModels: ['gemini-flash-latest', 'gemini-pro-latest', 'gemini-flash-lite-latest'],
    },
    {
      id: 'mock',
      label: 'Simulada (sem IA)',
      configured: true,
      keyEnv: null,
      defaultModel: 'mock',
      suggestedModels: ['mock'],
    },
  ];
}

export const googleApiKey = () => env.GOOGLE_API_KEY || env.GEMINI_API_KEY || undefined;

/** Modelos de chat com visão: exclui áudio, embeddings, geração de imagem etc. */
const OPENAI_VISION = /^(gpt-4o|gpt-4\.1|gpt-5|o[1-9])/;
const OPENAI_EXCLUDE =
  /(audio|realtime|transcribe|tts|search|image|codex|embedding|moderation|instruct)/;
const GOOGLE_EXCLUDE =
  /(embedding|tts|image|live|audio|aqa|imagen|veo|learnlm|robotics|computer-use|transcribe|nano-banana|customtools)/;

const cache = new Map<VisionProviderId, { at: number; models: string[] }>();
const TTL_MS = 10 * 60 * 1000;

export interface ModelList {
  models: string[];
  /** 'live' = listados pela API do provider; 'suggested' = lista interna. */
  source: 'live' | 'suggested';
  error?: string;
}

/** Lista os modelos disponíveis na conta (com cache de 10 min); cai para sugestões. */
export async function listModels(id: VisionProviderId): Promise<ModelList> {
  const info = providerCatalog().find((p) => p.id === id)!;
  if (!info.configured || id === 'mock')
    return { models: info.suggestedModels, source: 'suggested' };
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return { models: hit.models, source: 'live' };

  try {
    let models: string[] = [];
    if (id === 'anthropic') {
      const client = new Anthropic(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {});
      for await (const m of client.models.list({ limit: 100 })) models.push(m.id);
    } else if (id === 'openai') {
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      const all: { id: string; created: number }[] = [];
      for await (const m of client.models.list()) all.push({ id: m.id, created: m.created });
      models = all
        .filter((m) => OPENAI_VISION.test(m.id) && !OPENAI_EXCLUDE.test(m.id))
        .sort((a, b) => b.created - a.created)
        .map((m) => m.id);
    } else if (id === 'google') {
      const client = new GoogleGenAI({ apiKey: googleApiKey() });
      const pager = await client.models.list({ config: { pageSize: 100 } });
      for await (const m of pager) {
        const name = (m.name ?? '').replace(/^models\//, '');
        if (
          name.startsWith('gemini') &&
          !GOOGLE_EXCLUDE.test(name) &&
          (m.supportedActions ?? []).includes('generateContent')
        ) {
          models.push(name);
        }
      }
      // Aliases *-latest primeiro (acompanham o modelo atual), depois os mais novos.
      models.sort(
        (a, b) =>
          Number(b.endsWith('-latest')) - Number(a.endsWith('-latest')) || b.localeCompare(a),
      );
    }
    if (models.length === 0) return { models: info.suggestedModels, source: 'suggested' };
    cache.set(id, { at: Date.now(), models });
    return { models, source: 'live' };
  } catch (err) {
    return {
      models: info.suggestedModels,
      source: 'suggested',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
