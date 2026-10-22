import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
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

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Preços (USD por milhão de tokens) só para quando a resposta não trouxer `usage.cost`
 * (o OpenRouter informa o custo real em cada resposta).
 */
const PRICING: [RegExp, number, number][] = [
  [/claude-haiku-5/, 0.1, 0.5],
  [/claude-sonnet-5/, 2, 10],
  [/claude-opus-5\.5/, 4, 20],
];

type Effort = 'low' | 'medium' | 'high';
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;

/** O OpenRouter devolve o custo da chamada (USD) junto com os tokens. */
type UsageWithCost = OpenAI.CompletionUsage & { cost?: number };

/**
 * Provider de visão via OpenRouter (API compatível com Chat Completions da OpenAI):
 * dá acesso ao Claude, Gemini, GPT etc. com uma única chave. Imagens em base64,
 * saída estruturada (JSON Schema estrito), `reasoning.effort` unificado
 * (vira o `effort` do Claude), validação Zod e um retry.
 */
export class OpenRouterVisionProvider implements VisionProvider {
  readonly name = 'openrouter';
  private clientInstance: OpenAI | null;

  constructor(
    private readonly opts: {
      apiKey?: string;
      model: string;
      effort: Effort;
      client?: OpenAI;
      price?: { input?: number; output?: number };
    },
    private readonly log: FastifyBaseLogger,
  ) {
    this.clientInstance = opts.client ?? null;
  }

  /** Cliente criado sob demanda para a falta de chave não derrubar a API no boot. */
  private get client(): OpenAI {
    if (!this.clientInstance) {
      if (!this.opts.apiKey)
        throw new VisionError('Chave do OpenRouter ausente: defina OPENROUTER_API_KEY.');
      this.clientInstance = new OpenAI({
        apiKey: this.opts.apiKey,
        baseURL: OPENROUTER_BASE_URL,
        maxRetries: 2,
        // Identifica o app no painel de uso do OpenRouter.
        defaultHeaders: { 'X-Title': 'Sentinela' },
      });
    }
    return this.clientInstance;
  }

  validateScene(image: Buffer): Promise<VisionResult<SceneValidation>> {
    return this.call(
      'VALIDATE_SCENE',
      'scene_validation',
      [image],
      VALIDATE_SCENE_PROMPT,
      ApiSceneValidation,
      SceneValidationSchema,
    );
  }

  inventory(image: Buffer): Promise<VisionResult<Inventory>> {
    return this.call(
      'INVENTORY',
      'inventory',
      [image],
      inventoryPrompt(),
      ApiInventory,
      InventorySchema,
    );
  }

  compare(
    before: Buffer,
    after: Buffer,
    inventory: Inventory | null,
  ): Promise<VisionResult<Comparison>> {
    return this.call(
      'COMPARE',
      'comparison',
      [before, after],
      comparePrompt(inventoryContext(inventory)),
      ApiComparison,
      ComparisonSchema,
      ['ANTES', 'DEPOIS'],
    );
  }

  checkRemoval(before: Buffer, after: Buffer): Promise<VisionResult<RemovalCheck>> {
    // Pergunta simples: pouco raciocínio basta e reduz os tokens de saída.
    return this.call(
      'REMOVAL_CHECK',
      'removal_check',
      [before, after],
      REMOVAL_CHECK_PROMPT,
      ApiRemovalCheck,
      RemovalCheckSchema,
      ['ANTES', 'DEPOIS'],
      'low',
    );
  }

  private async call<A extends z.ZodType, S extends z.ZodType>(
    kind: string,
    formatName: string,
    images: Buffer[],
    prompt: string,
    apiSchema: A,
    finalSchema: S,
    captions?: string[],
    effortOverride?: Effort,
  ): Promise<VisionResult<z.output<S>>> {
    const { model } = this.opts;
    const effort = effortOverride ?? this.opts.effort;
    const content: Part[] = [];
    images.forEach((img, i) => {
      if (captions?.[i]) content.push({ type: 'text', text: `Imagem ${i + 1} — ${captions[i]}:` });
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}`, detail: 'high' },
      });
    });
    content.push({ type: 'text', text: prompt });

    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ];
    const usage: VisionUsage = { inputTokens: 0, outputTokens: 0, model };
    let costUsd = 0;
    let costKnown = true;
    const format = zodResponseFormat(apiSchema, formatName);

    for (let attempt = 1; attempt <= 2; attempt++) {
      let response: OpenAI.Chat.Completions.ChatCompletion;
      const started = Date.now();
      const client = this.client;
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          response_format: format,
          max_tokens: 16000,
          // Parâmetro unificado do OpenRouter; no Claude vira output_config.effort.
          ...({ reasoning: { effort } } as object),
        });
      } catch (err) {
        throw new VisionError(describeApiError(err), usage.inputTokens ? usage : null, {
          cause: err,
        });
      }

      const u = response.usage as UsageWithCost | undefined;
      usage.inputTokens += u?.prompt_tokens ?? 0;
      usage.outputTokens += u?.completion_tokens ?? 0;
      if (typeof u?.cost === 'number') costUsd += u.cost;
      else costKnown = false;
      usage.estimatedCostUsd = costKnown
        ? costUsd
        : estimateCost(model, usage.inputTokens, usage.outputTokens, PRICING, this.opts.price);
      this.log.info(
        {
          kind,
          model: response.model,
          attempt,
          inputTokens: u?.prompt_tokens,
          outputTokens: u?.completion_tokens,
          reasoningTokens: u?.completion_tokens_details?.reasoning_tokens,
          estimatedCostUsd: usage.estimatedCostUsd?.toFixed(5),
          ms: Date.now() - started,
        },
        'Chamada de visão',
      );

      const choice = response.choices[0];
      if (choice?.message.refusal)
        throw new VisionError(`O modelo recusou a análise: ${choice.message.refusal}`, usage);
      if (choice?.finish_reason === 'length')
        throw new VisionError('Resposta truncada (max_tokens).', usage);

      const text = (choice?.message.content ?? '').trim();
      const result = parseVisionJson(finalSchema, text);
      if (result.ok) return { data: result.data, usage };
      const { problem } = result;

      this.log.warn({ kind, attempt, problem }, 'Resposta de visão inválida');
      if (attempt === 2) throw new VisionError(`Resposta inválida da IA: ${problem}`, usage);
      messages.push(
        { role: 'assistant', content: text || '(vazio)' },
        { role: 'user', content: retryPrompt(problem) },
      );
    }
    throw new VisionError('Falha inesperada na chamada de visão', usage);
  }
}

function describeApiError(err: unknown): string {
  if (err instanceof VisionError) return err.message;
  if (err instanceof OpenAI.AuthenticationError) return 'Chave do OpenRouter inválida.';
  if (err instanceof OpenAI.APIError && err.status === 402)
    return 'Sem créditos no OpenRouter: adicione saldo em openrouter.ai/settings/credits.';
  if (err instanceof OpenAI.RateLimitError) return 'Limite de requisições do OpenRouter atingido.';
  if (err instanceof OpenAI.BadRequestError) return `Requisição rejeitada: ${err.message}`;
  if (err instanceof OpenAI.APIConnectionError) return 'Sem conexão com o OpenRouter.';
  if (err instanceof OpenAI.APIError) return `Erro do OpenRouter (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
