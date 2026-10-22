import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { Comparison, Inventory, RemovalCheck, SceneValidation } from '../domain/types';
import {
  ApiComparison,
  ApiInventory,
  ApiRemovalCheck,
  ApiSceneValidation,
  ComparisonSchema,
  comparePrompt,
  inventoryPrompt,
  InventorySchema,
  inventoryContext,
  parseVisionJson,
  REMOVAL_CHECK_PROMPT,
  RemovalCheckSchema,
  retryPrompt,
  SceneValidationSchema,
  SYSTEM_PROMPT,
  VALIDATE_SCENE_PROMPT,
} from './prompts';
import {
  estimateCost,
  VisionError,
  type VisionProvider,
  type VisionResult,
  type VisionUsage,
} from './provider';

/** Preço por milhão de tokens (entrada, saída), em USD. Usado só para estimativa no log. */
const PRICING: [RegExp, number, number][] = [
  [/fable|mythos/, 10, 50],
  [/opus-5-5/, 4, 20],
  [/opus-(5|4)/, 5, 25],
  [/sonnet-5/, 2, 10],
  [/sonnet-4/, 3, 15],
  [/haiku-5/, 0.1, 0.5],
  [/haiku-4/, 1, 5],
];

/**
 * `temperature` só é aceito em modelos anteriores à família 4.7/5 (que rejeitam
 * valores não-padrão com 400). Nos demais o pedido de "temperature 0" é atendido
 * pela saída estruturada + instruções determinísticas.
 */
const supportsTemperature = (model: string) =>
  /haiku-4|sonnet-4-[56]|opus-4-[56]|claude-3/.test(model);

const supportsEffort = (model: string) =>
  /opus-(4-[5-8]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos/.test(model);

/**
 * Fallback no servidor quando o modelo recusa por política. Só existe nestes modelos
 * (o Haiku 5.5, por exemplo, não tem), então nos demais o parâmetro não é enviado.
 */
const supportsFallback = (model: string) => /fable-5-1|mythos-5-1|opus-5|sonnet-5-5/.test(model);

type Effort = 'low' | 'medium' | 'high';

export class AnthropicVisionProvider implements VisionProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    private readonly opts: {
      apiKey?: string;
      model: string;
      effort: Effort;
      client?: Anthropic;
      price?: { input?: number; output?: number };
    },
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
    return this.call('INVENTORY', [image], inventoryPrompt(), ApiInventory, InventorySchema);
  }

  compare(
    before: Buffer,
    after: Buffer,
    inventory: Inventory | null,
  ): Promise<VisionResult<Comparison>> {
    const context = inventoryContext(inventory);
    return this.call(
      'COMPARE',
      [before, after],
      comparePrompt(context),
      ApiComparison,
      ComparisonSchema,
      ['ANTES', 'DEPOIS'],
    );
  }

  checkRemoval(before: Buffer, after: Buffer): Promise<VisionResult<RemovalCheck>> {
    // Pergunta simples: pouco raciocínio basta e reduz os tokens de saída.
    return this.call(
      'REMOVAL_CHECK',
      [before, after],
      REMOVAL_CHECK_PROMPT,
      ApiRemovalCheck,
      RemovalCheckSchema,
      ['ANTES', 'DEPOIS'],
      'low',
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
    effortOverride?: Effort,
  ): Promise<VisionResult<z.output<S>>> {
    const { model } = this.opts;
    const effort = effortOverride ?? this.opts.effort;
    const fallback = supportsFallback(model);
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
          system: SYSTEM_PROMPT,
          messages,
          output_config: {
            format: { type: 'json_schema', schema: format.schema },
            ...(supportsEffort(model) ? { effort } : {}),
          },
          ...(supportsTemperature(model) ? { temperature: 0 } : {}),
          // Se o modelo recusar por política, o servidor tenta o fallback padrão.
          ...(fallback
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
        });
      } catch (err) {
        throw new VisionError(describeApiError(err), usage.inputTokens ? usage : null, {
          cause: err,
        });
      }

      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
      usage.estimatedCostUsd = estimateCost(
        model,
        usage.inputTokens,
        usage.outputTokens,
        PRICING,
        this.opts.price,
      );
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

      const result = parseVisionJson(finalSchema, text);
      if (result.ok) return { data: result.data, usage };
      const { problem } = result;

      this.log.warn({ kind, attempt, problem }, 'Resposta de visão inválida');
      if (attempt === 2) throw new VisionError(`Resposta inválida da IA: ${problem}`, usage);
      messages.push(
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: retryPrompt(problem),
        },
      );
    }
    throw new VisionError('Falha inesperada na chamada de visão', usage);
  }
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
