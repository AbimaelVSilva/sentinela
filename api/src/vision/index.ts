import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env';
import { AnthropicVisionProvider } from './anthropic';
import { MockVisionProvider } from './mock';
import type { VisionProvider } from './provider';

let instance: VisionProvider | null = null;

/** Provider configurado por VISION_PROVIDER (singleton). */
export function getVisionProvider(log: FastifyBaseLogger): VisionProvider {
  if (instance) return instance;
  if (env.VISION_PROVIDER === 'mock') {
    log.warn('VISION_PROVIDER=mock: análises de visão são SIMULADAS');
    instance = new MockVisionProvider();
  } else {
    instance = new AnthropicVisionProvider(
      {
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        model: env.VISION_MODEL,
        effort: env.VISION_EFFORT,
      },
      log.child({ module: 'vision' }),
    );
  }
  return instance;
}
