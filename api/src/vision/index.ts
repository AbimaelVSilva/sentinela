import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env';
import { AnthropicVisionProvider } from './anthropic';
import { MockVisionProvider } from './mock';
import { OpenAIVisionProvider } from './openai';
import type { VisionProvider } from './provider';

let instance: VisionProvider | null = null;

/** Modelo efetivamente usado pelo provider configurado. */
export function visionModel(): string {
  if (env.VISION_PROVIDER === 'mock') return 'mock';
  return env.VISION_PROVIDER === 'openai' ? env.OPENAI_MODEL : env.VISION_MODEL;
}

/** Provider configurado por VISION_PROVIDER (singleton). */
export function getVisionProvider(log: FastifyBaseLogger): VisionProvider {
  if (instance) return instance;
  const price = {
    input: env.VISION_PRICE_INPUT_PER_MTOK,
    output: env.VISION_PRICE_OUTPUT_PER_MTOK,
  };
  const vlog = log.child({ module: 'vision' });
  switch (env.VISION_PROVIDER) {
    case 'mock':
      log.warn('VISION_PROVIDER=mock: análises de visão são SIMULADAS');
      instance = new MockVisionProvider();
      break;
    case 'openai':
      instance = new OpenAIVisionProvider(
        {
          apiKey: env.OPENAI_API_KEY || undefined,
          baseURL: env.OPENAI_BASE_URL,
          model: env.OPENAI_MODEL,
          effort: env.VISION_EFFORT,
          price,
        },
        vlog,
      );
      break;
    default:
      instance = new AnthropicVisionProvider(
        {
          apiKey: env.ANTHROPIC_API_KEY || undefined,
          model: env.VISION_MODEL,
          effort: env.VISION_EFFORT,
          price,
        },
        vlog,
      );
  }
  log.info({ provider: env.VISION_PROVIDER, model: visionModel() }, 'Provider de visão');
  return instance;
}
