import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import type { Comparison, Inventory, SceneValidation } from '../domain/types';
import {
  ApiComparison,
  ApiInventory,
  ApiSceneValidation,
  ComparisonSchema,
  comparePrompt,
  inventoryPrompt,
  InventorySchema,
  inventoryContext,
  parseVisionJson,
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

/**
 * Preços (USD por milhão de tokens: entrada, saída) só para a estimativa no log.
 * Mude com VISION_PRICE_INPUT_PER_MTOK / VISION_PRICE_OUTPUT_PER_MTOK se o modelo não estiver aqui.
 */
const PRICING: [RegExp, number, number][] = [
  [/^gpt-4o-mini/, 0.15, 0.6],
  [/^gpt-4o/, 2.5, 10],
  [/^gpt-4\.1-mini/, 0.4, 1.6],
  [/^gpt-4\.1/, 2, 8],
];

/** Modelos de raciocínio (gpt-5*, o*) rejeitam temperature e aceitam reasoning.effort. */
const isReasoningModel = (model: string) => /^(gpt-5|o\d)/.test(model);

type Effort = 'low' | 'medium' | 'high';
type InputItem = OpenAI.Responses.ResponseInputItem;

/**
 * Provider de visão com a API da OpenAI (Responses API): imagens JPEG em base64,
 * saída estruturada (JSON Schema estrito gerado do Zod), validação Zod e um retry.
 */
export class OpenAIVisionProvider implements VisionProvider {
  readonly name = 'openai';
  private clientInstance: OpenAI | null;

  constructor(
    private readonly opts: {
      apiKey?: string;
      baseURL?: string;
      model: string;
      effort: Effort;
      client?: OpenAI;
      price?: { input?: number; output?: number };
    },
    private readonly log: FastifyBaseLogger,
  ) {
    this.clientInstance = opts.client ?? null;
  }

  /**
   * Cliente criado sob demanda: o SDK lança no construtor quando não há chave, e isso
   * não pode derrubar a API no boot — vira uma falha de análise com mensagem clara.
   */
  private get client(): OpenAI {
    if (!this.clientInstance) {
      try {
        // Sem chave explícita o SDK lê OPENAI_API_KEY do ambiente.
        this.clientInstance = new OpenAI({
          ...(this.opts.apiKey ? { apiKey: this.opts.apiKey } : {}),
          ...(this.opts.baseURL ? { baseURL: this.opts.baseURL } : {}),
          maxRetries: 2,
        });
      } catch (err) {
        throw new VisionError('Chave da OpenAI ausente: defina OPENAI_API_KEY.', null, {
          cause: err,
        });
      }
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

  private async call<A extends z.ZodType, S extends z.ZodType>(
    kind: string,
    formatName: string,
    images: Buffer[],
    prompt: string,
    apiSchema: A,
    finalSchema: S,
    captions?: string[],
  ): Promise<VisionResult<z.output<S>>> {
    const { model, effort } = this.opts;
    const content: OpenAI.Responses.ResponseInputContent[] = [];
    images.forEach((img, i) => {
      if (captions?.[i])
        content.push({ type: 'input_text', text: `Imagem ${i + 1} — ${captions[i]}:` });
      content.push({
        type: 'input_image',
        image_url: `data:image/jpeg;base64,${img.toString('base64')}`,
        detail: 'high',
      });
    });
    content.push({ type: 'input_text', text: prompt });

    const input: InputItem[] = [{ role: 'user', content }];
    const usage: VisionUsage = { inputTokens: 0, outputTokens: 0, model };
    const format = zodTextFormat(apiSchema, formatName);
    const reasoning = isReasoningModel(model);

    for (let attempt = 1; attempt <= 2; attempt++) {
      let response: OpenAI.Responses.Response;
      const started = Date.now();
      const client = this.client;
      try {
        response = await client.responses.create({
          model,
          instructions: SYSTEM_PROMPT,
          input,
          text: { format },
          max_output_tokens: 16000,
          store: false,
          ...(reasoning ? { reasoning: { effort } } : { temperature: 0 }),
        });
      } catch (err) {
        throw new VisionError(describeApiError(err), usage.inputTokens ? usage : null, {
          cause: err,
        });
      }

      usage.inputTokens += response.usage?.input_tokens ?? 0;
      usage.outputTokens += response.usage?.output_tokens ?? 0;
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
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          estimatedCostUsd: usage.estimatedCostUsd?.toFixed(5),
          ms: Date.now() - started,
        },
        'Chamada de visão',
      );

      const parts = response.output.flatMap((item) =>
        item.type === 'message' ? item.content : [],
      );
      const refusal = parts.find((p) => p.type === 'refusal');
      if (refusal) throw new VisionError(`O modelo recusou a análise: ${refusal.refusal}`, usage);
      if (response.status === 'incomplete') {
        const reason = response.incomplete_details?.reason ?? 'desconhecido';
        throw new VisionError(`Resposta incompleta (${reason}).`, usage);
      }

      const text = parts
        .filter((p): p is OpenAI.Responses.ResponseOutputText => p.type === 'output_text')
        .map((p) => p.text)
        .join('')
        .trim();

      const result = parseVisionJson(finalSchema, text);
      if (result.ok) return { data: result.data, usage };
      const { problem } = result;

      this.log.warn({ kind, attempt, problem }, 'Resposta de visão inválida');
      if (attempt === 2) throw new VisionError(`Resposta inválida da IA: ${problem}`, usage);
      input.push(
        { role: 'assistant', content: text || '(vazio)' },
        { role: 'user', content: retryPrompt(problem) },
      );
    }
    throw new VisionError('Falha inesperada na chamada de visão', usage);
  }
}

function describeApiError(err: unknown): string {
  if (err instanceof OpenAI.AuthenticationError) return 'Chave da OpenAI inválida ou ausente.';
  if (err instanceof OpenAI.RateLimitError)
    return 'Limite de requisições (ou de crédito) da OpenAI atingido.';
  if (err instanceof OpenAI.BadRequestError) return `Requisição rejeitada pela API: ${err.message}`;
  if (err instanceof OpenAI.APIConnectionError) return 'Sem conexão com a API da OpenAI.';
  if (err instanceof OpenAI.APIError)
    return `Erro da API da OpenAI (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
