import {
  ApiError,
  FinishReason,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
} from '@google/genai';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Comparison, Inventory, RemovalCheck, SceneValidation } from '../domain/types';
import {
  ApiRemovalCheck,
  ApiSceneValidation,
  ComparisonSchema,
  comparePrompt,
  fromBox2dResponse,
  GoogleApiComparison,
  GoogleApiInventory,
  InventorySchema,
  inventoryContext,
  inventoryPrompt,
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

/** Preços (USD por milhão de tokens: entrada, saída) só para a estimativa no log. */
const PRICING: [RegExp, number, number][] = [
  [/^gemini-(flash-lite-latest|3\.\d+-flash-lite)/, 0.3, 2.5],
  [/^gemini-(flash-latest|3\.\d+-flash)/, 0.75, 3.75],
  [/^gemini-(pro-latest|3\.\d+-pro)/, 2, 12],
  [/^gemini-2\.5-flash-lite/, 0.1, 0.4],
  [/^gemini-2\.5-flash/, 0.3, 2.5],
  [/^gemini-2\.5-pro/, 1.25, 10],
];

const RETRY_DELAYS_MS = [2000, 5000];
const isTransient = (err: unknown) =>
  err instanceof ApiError && [429, 500, 503].includes(err.status);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A família Gemini 3 recomenda manter a temperatura padrão; nas anteriores usamos 0. */
const keepDefaultTemperature = (model: string) => /^gemini-([3-9]|\d{2})/.test(model);

/** `thinkingLevel` existe a partir do Gemini 3 (os aliases -latest apontam para ele). */
const supportsThinkingLevel = (model: string) => /^gemini-([3-9]|\d{2})|-latest$/.test(model);

type Content = { role: 'user' | 'model'; parts: Part[] };

/**
 * Provider de visão com a API Gemini do Google (@google/genai): imagens inline em
 * base64, saída JSON com `responseJsonSchema` gerado do Zod, validação Zod e um retry.
 */
export class GoogleVisionProvider implements VisionProvider {
  readonly name = 'google';
  private clientInstance: GoogleGenAI | null;

  constructor(
    private readonly opts: {
      apiKey?: string;
      model: string;
      client?: GoogleGenAI;
      price?: { input?: number; output?: number };
    },
    private readonly log: FastifyBaseLogger,
  ) {
    this.clientInstance = opts.client ?? null;
  }

  /** Cliente criado sob demanda para a falta de chave não derrubar a API no boot. */
  private get client(): GoogleGenAI {
    if (!this.clientInstance) {
      if (!this.opts.apiKey)
        throw new VisionError('Chave do Google ausente: defina GOOGLE_API_KEY.');
      this.clientInstance = new GoogleGenAI({ apiKey: this.opts.apiKey });
    }
    return this.clientInstance;
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
    return this.call(
      'INVENTORY',
      [image],
      inventoryPrompt('box_2d'),
      GoogleApiInventory,
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
      [before, after],
      comparePrompt(inventoryContext(inventory, 'box_2d'), 'box_2d'),
      GoogleApiComparison,
      ComparisonSchema,
      ['ANTES', 'DEPOIS'],
    );
  }

  checkRemoval(before: Buffer, after: Buffer): Promise<VisionResult<RemovalCheck>> {
    return this.call(
      'REMOVAL_CHECK',
      [before, after],
      REMOVAL_CHECK_PROMPT,
      ApiRemovalCheck,
      RemovalCheckSchema,
      ['ANTES', 'DEPOIS'],
      true,
    );
  }

  /** Repete em erros transitórios (alta demanda/limite por minuto) com espera crescente. */
  private async generateWithRetry(
    client: GoogleGenAI,
    kind: string,
    params: GenerateParams,
  ): Promise<GenerateContentResponse> {
    for (let i = 0; ; i++) {
      try {
        return await client.models.generateContent(params);
      } catch (err) {
        const delay = RETRY_DELAYS_MS[i];
        if (delay === undefined || !isTransient(err)) throw err;
        this.log.warn(
          { kind, status: (err as ApiError).status, delay },
          'Google indisponível; tentando de novo',
        );
        await sleep(delay);
      }
    }
  }

  private async call<A extends z.ZodType, S extends z.ZodType>(
    kind: string,
    images: Buffer[],
    prompt: string,
    apiSchema: A,
    finalSchema: S,
    captions?: string[],
    /** Pergunta simples: pede pouco raciocínio (menos tokens de saída). */
    lowThinking = false,
  ): Promise<VisionResult<z.output<S>>> {
    const { model } = this.opts;
    const parts: Part[] = [];
    images.forEach((img, i) => {
      if (captions?.[i]) parts.push({ text: `Imagem ${i + 1} — ${captions[i]}:` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: img.toString('base64') } });
    });
    parts.push({ text: prompt });

    const contents: Content[] = [{ role: 'user', parts }];
    const usage: VisionUsage = { inputTokens: 0, outputTokens: 0, model };
    // `$schema` não faz parte do subconjunto aceito pelo Gemini.
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(apiSchema, { io: 'input' });

    for (let attempt = 1; attempt <= 2; attempt++) {
      const client = this.client;
      let response: GenerateContentResponse;
      const started = Date.now();
      try {
        response = await this.generateWithRetry(client, kind, {
          model,
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: 'application/json',
            responseJsonSchema: jsonSchema,
            maxOutputTokens: 16000,
            ...(keepDefaultTemperature(model) ? {} : { temperature: 0 }),
            ...(lowThinking && supportsThinkingLevel(model)
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
          },
        });
      } catch (err) {
        throw new VisionError(describeApiError(err), usage.inputTokens ? usage : null, {
          cause: err,
        });
      }

      const meta = response.usageMetadata;
      usage.inputTokens += meta?.promptTokenCount ?? 0;
      // Tokens de "pensamento" são cobrados como saída.
      usage.outputTokens += (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0);
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
          model: response.modelVersion ?? model,
          attempt,
          inputTokens: meta?.promptTokenCount,
          outputTokens: meta?.candidatesTokenCount,
          thoughtsTokens: meta?.thoughtsTokenCount,
          estimatedCostUsd: usage.estimatedCostUsd?.toFixed(5),
          ms: Date.now() - started,
        },
        'Chamada de visão',
      );

      const blocked = response.promptFeedback?.blockReason;
      if (blocked)
        throw new VisionError(`O modelo recusou a análise (bloqueio: ${blocked}).`, usage);
      const candidate = response.candidates?.[0];
      const finish = candidate?.finishReason;
      if (finish === FinishReason.MAX_TOKENS)
        throw new VisionError('Resposta truncada (MAX_TOKENS).', usage);
      if (finish && finish !== FinishReason.STOP) {
        throw new VisionError(`O modelo interrompeu a resposta (${finish}).`, usage);
      }

      const text = (response.text ?? '').trim();
      // Caixas vêm em box_2d (formato nativo do Gemini) e são convertidas para {x, y, w, h}.
      const result = parseVisionJson(finalSchema, text, fromBox2dResponse);
      if (result.ok) return { data: result.data, usage };
      const { problem } = result;

      this.log.warn({ kind, attempt, problem }, 'Resposta de visão inválida');
      if (attempt === 2) throw new VisionError(`Resposta inválida da IA: ${problem}`, usage);
      contents.push(
        { role: 'model', parts: [{ text: text || '(vazio)' }] },
        { role: 'user', parts: [{ text: retryPrompt(problem) }] },
      );
    }
    throw new VisionError('Falha inesperada na chamada de visão', usage);
  }
}

type GenerateParams = Parameters<GoogleGenAI['models']['generateContent']>[0];

function describeApiError(err: unknown): string {
  if (err instanceof VisionError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 400 && /API key/i.test(err.message)) return 'Chave do Google inválida.';
    if (err.status === 401 || err.status === 403)
      return 'Chave do Google inválida ou sem permissão.';
    if (err.status === 429) return 'Limite de requisições (ou de cota) do Google atingido.';
    return `Erro da API do Google (${err.status}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
