import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { Comparison, Inventory, SceneValidation } from '../domain/types';
import {
  ApiComparison,
  ApiInventory,
  ApiSceneValidation,
  ComparisonSchema,
  comparePrompt,
  INVENTORY_PROMPT,
  InventorySchema,
  SceneValidationSchema,
  VALIDATE_SCENE_PROMPT,
} from './prompts';
import { VisionError, type VisionProvider, type VisionResult, type VisionUsage } from './provider';

/** Preço por milhão de tokens (entrada, saída), em USD. Usado só para estimativa no log. */
const PRICING: [RegExp, number, number][] = [
  [/fable|mythos/, 10, 50],
  [/opus-5-5/, 4, 20],
  [/opus-(5|4)/, 5, 25],
  [/sonnet-5/, 2, 10],
  [/sonnet-4/, 3, 15],
  [/haiku-4/, 1, 5],
];

function estimateCost(model: string, input: number, output: number): number | undefined {
  const p = PRICING.find(([re]) => re.test(model));
  return p ? (input * p[1] + output * p[2]) / 1_000_000 : undefined;
}

/**
 * `temperature` só é aceito em modelos anteriores à família 4.7/5 (que rejeitam
 * valores não-padrão com 400). Nos demais o pedido de "temperature 0" é atendido
 * pela saída estruturada + instruções determinísticas.
 */
const supportsTemperature = (model: string) =>
  /haiku-4|sonnet-4-[56]|opus-4-[56]|claude-3/.test(model);

const supportsEffort = (model: string) =>
  /opus-(4-[5-8]|5)|sonnet-(4-6|5)|fable|mythos/.test(model);

type Effort = 'low' | 'medium' | 'high';

const SYSTEM = `Você é o módulo de visão computacional do Sentinela, um sistema de monitoramento de prateleiras de lojas autônomas.
Analise as imagens com atenção a detalhes e responda somente com o JSON solicitado.
Textos para o operador devem estar em português do Brasil.`;

export class AnthropicVisionProvider implements VisionProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    private readonly opts: { apiKey?: string; model: string; effort: Effort; client?: Anthropic },
    private readonly log: FastifyBaseLogger,
  ) {
    // Sem chave explícita o SDK resolve credenciais do ambiente (ANTHROPIC_API_KEY,
    // ANTHROPIC_AUTH_TOKEN ou perfil do `ant auth login`).
    this.client =
      opts.client ??
      new Anthropic(opts.apiKey ? { apiKey: opts.apiKey, maxRetries: 2 } : { maxRetries: 2 });
  }

  validateScene(image: Buffer): Promise<VisionResult<SceneValidation>> {
    return this.call(
      'VALIDATE_SCENE',
      [image],
      VALIDATE_SCENE_PROMPT,
      ApiSceneValidation,
      SceneValidationSchema,
    );
  }

  inventory(image: Buffer): Promise<VisionResult<Inventory>> {
    return this.call('INVENTORY', [image], INVENTORY_PROMPT, ApiInventory, InventorySchema);
  }

  compare(
    before: Buffer,
    after: Buffer,
    inventory: Inventory | null,
  ): Promise<VisionResult<Comparison>> {
    const context = inventory?.items.length
      ? inventory.items
          .map(
            (i) =>
              `- ${i.id}: ${i.label} (qtd ~${i.quantity}; região x=${i.region.x.toFixed(2)} y=${i.region.y.toFixed(2)} w=${i.region.w.toFixed(2)} h=${i.region.h.toFixed(2)})`,
          )
          .join('\n')
      : null;
    return this.call(
      'COMPARE',
      [before, after],
      comparePrompt(context),
      ApiComparison,
      ComparisonSchema,
      ['ANTES', 'DEPOIS'],
    );
  }

  /**
   * Chamada com saída estruturada (JSON Schema) + validação Zod. Se a validação
   * falhar, faz um retry enviando o erro ao modelo; se falhar de novo, lança VisionError.
   */
  private async call<A extends z.ZodType, S extends z.ZodType>(
    kind: string,
    images: Buffer[],
    prompt: string,
    apiSchema: A,
    finalSchema: S,
    captions?: string[],
  ): Promise<VisionResult<z.output<S>>> {
    const { model, effort } = this.opts;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    images.forEach((img, i) => {
      if (captions?.[i]) content.push({ type: 'text', text: `Imagem ${i + 1} — ${captions[i]}:` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: img.toString('base64') },
      });
    });
    content.push({ type: 'text', text: prompt });

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
    const usage: VisionUsage = { inputTokens: 0, outputTokens: 0, model };
    const format = zodOutputFormat(apiSchema);

    for (let attempt = 1; attempt <= 2; attempt++) {
      let response: Anthropic.Beta.BetaMessage;
      const started = Date.now();
      try {
        response = await this.client.beta.messages.create({
          model,
          max_tokens: 16000,
          system: SYSTEM,
          messages,
          output_config: {
            format: { type: 'json_schema', schema: format.schema },
            ...(supportsEffort(model) ? { effort } : {}),
          },
          ...(supportsTemperature(model) ? { temperature: 0 } : {}),
          // Se o modelo recusar por política, o servidor tenta o fallback padrão.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (err) {
        throw new VisionError(describeApiError(err), usage.inputTokens ? usage : null, {
          cause: err,
        });
      }

      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
      usage.estimatedCostUsd = estimateCost(model, usage.inputTokens, usage.outputTokens);
      this.log.info(
        {
          kind,
          model: response.model,
          attempt,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          estimatedCostUsd: usage.estimatedCostUsd?.toFixed(5),
          ms: Date.now() - started,
        },
        'Chamada de visão',
      );

      if (response.stop_reason === 'refusal') {
        throw new VisionError('O modelo recusou a análise (refusal).', usage);
      }
      if (response.stop_reason === 'max_tokens') {
        throw new VisionError('Resposta truncada (max_tokens).', usage);
      }

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      let problem: string;
      try {
        const parsed = finalSchema.safeParse(JSON.parse(stripFences(text)));
        if (parsed.success) return { data: parsed.data, usage };
        problem = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
          .join('; ');
      } catch (err) {
        problem = `JSON inválido: ${err instanceof Error ? err.message : String(err)}`;
      }

      this.log.warn({ kind, attempt, problem }, 'Resposta de visão inválida');
      if (attempt === 2) throw new VisionError(`Resposta inválida da IA: ${problem}`, usage);
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: `A resposta anterior não passou na validação (${problem}). Responda novamente apenas com o JSON corrigido, seguindo o schema.`,
        },
      );
    }
    throw new VisionError('Falha inesperada na chamada de visão', usage);
  }
}

function stripFences(text: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  return m?.[1] ?? text;
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return 'Chave da Anthropic inválida ou ausente.';
  if (err instanceof Anthropic.RateLimitError)
    return 'Limite de requisições da Anthropic atingido.';
  if (err instanceof Anthropic.BadRequestError)
    return `Requisição rejeitada pela API: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Sem conexão com a API da Anthropic.';
  if (err instanceof Anthropic.APIError)
    return `Erro da API da Anthropic (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
