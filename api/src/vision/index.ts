import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env';
import { currentModel, getVisionSettings } from '../modules/settings/service';
import { AnthropicVisionProvider } from './anthropic';
import { googleApiKey } from './catalog';
import { GoogleVisionProvider } from './google';
import { MockVisionProvider } from './mock';
import { OpenAIVisionProvider } from './openai';
import type { VisionProvider } from './provider';

/** Modelo efetivamente em uso (conforme as configurações do painel). */
export const visionModel = () => currentModel();

function createProvider(log: FastifyBaseLogger): VisionProvider {
  const s = getVisionSettings();
  const model = currentModel(s);
  const price = {
    input: env.VISION_PRICE_INPUT_PER_MTOK,
    output: env.VISION_PRICE_OUTPUT_PER_MTOK,
  };
  switch (s.provider) {
    case 'mock':
      return new MockVisionProvider();
    case 'openai':
      return new OpenAIVisionProvider(
        {
          apiKey: env.OPENAI_API_KEY || undefined,
          baseURL: env.OPENAI_BASE_URL,
          model,
          effort: s.effort,
          price,
        },
        log,
      );
    case 'google':
      return new GoogleVisionProvider({ apiKey: googleApiKey(), model, price }, log);
    default:
      return new AnthropicVisionProvider(
        { apiKey: env.ANTHROPIC_API_KEY || undefined, model, effort: s.effort, price },
        log,
      );
  }
}

/**
 * Provider que segue as configurações do painel: a cada chamada resolve qual IA/modelo
 * usar, então trocar pelo painel vale na próxima análise, sem reiniciar a API.
 */
class VisionRouter implements VisionProvider {
  private readonly instances = new Map<string, VisionProvider>();

  constructor(private readonly log: FastifyBaseLogger) {}

  get name(): string {
    return getVisionSettings().provider;
  }

  private current(): VisionProvider {
    const s = getVisionSettings();
    const key = `${s.provider}|${currentModel(s)}|${s.effort}`;
    let p = this.instances.get(key);
    if (!p) {
      p = createProvider(this.log);
      this.instances.set(key, p);
      this.log.info(
        { provider: s.provider, model: currentModel(s), effort: s.effort },
        'Provider de visão',
      );
    }
    return p;
  }

  validateScene(image: Buffer) {
    return this.current().validateScene(image);
  }
  inventory(image: Buffer) {
    return this.current().inventory(image);
  }
  compare(...args: Parameters<VisionProvider['compare']>) {
    return this.current().compare(...args);
  }
}

let instance: VisionProvider | null = null;

export function getVisionProvider(log: FastifyBaseLogger): VisionProvider {
  instance ??= new VisionRouter(log.child({ module: 'vision' }));
  return instance;
}
