import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenRouterVisionProvider } from '../src/vision/openrouter';
import { VisionError } from '../src/vision/provider';
import { silentLog } from './helpers';

function completion(
  content: string,
  usage: Record<string, unknown> = { prompt_tokens: 4000, completion_tokens: 300, cost: 0.00055 },
  extra: Record<string, unknown> = {},
) {
  return {
    id: 'gen-1',
    object: 'chat.completion',
    model: 'anthropic/claude-haiku-5.5',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content, refusal: null },
      },
    ],
    usage,
    ...extra,
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

function provider(
  responses: (OpenAI.Chat.Completions.ChatCompletion | Error)[],
  model = 'anthropic/claude-haiku-5.5',
) {
  const create = vi.fn();
  responses.forEach((r) =>
    r instanceof Error ? create.mockRejectedValueOnce(r) : create.mockResolvedValueOnce(r),
  );
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return {
    p: new OpenRouterVisionProvider({ model, effort: 'medium', client }, silentLog),
    create,
  };
}

const img = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const REMOVED = JSON.stringify({ removed: true, quantity: 2, confidence: 0.85 });

describe('OpenRouterVisionProvider', () => {
  it('só retirada: 2 imagens, JSON Schema estrito, effort low e custo informado pelo OpenRouter', async () => {
    const { p, create } = provider([completion(REMOVED)]);
    const res = await p.checkRemoval(img, img);
    expect(res.data).toEqual({ removed: true, quantity: 2, confidence: 0.85 });
    expect(res.usage).toMatchObject({ inputTokens: 4000, outputTokens: 300 });
    expect(res.usage.estimatedCostUsd).toBe(0.00055);

    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'anthropic/claude-haiku-5.5',
      reasoning: { effort: 'low' },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'removal_check', strict: true },
      },
    });
    expect(body).not.toHaveProperty('temperature');
    const messages = body.messages as { role: string; content: unknown }[];
    expect(messages[0]!.role).toBe('system');
    const parts = messages[1]!.content as { type: string; image_url?: { url: string } }[];
    const images = parts.filter((c) => c.type === 'image_url');
    expect(images).toHaveLength(2);
    expect(images[0]!.image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('modo completo usa o esforço das configurações', async () => {
    const compare = JSON.stringify({ changes: [], summary: 'Nada mudou.', overallConfidence: 0.9 });
    const { p, create } = provider([completion(compare)]);
    await p.compare(img, img, null);
    expect(create.mock.calls[0]![0]).toMatchObject({ reasoning: { effort: 'medium' } });
  });

  it('sem usage.cost, estima pelo preço do modelo', async () => {
    const { p } = provider([completion(REMOVED, { prompt_tokens: 4000, completion_tokens: 300 })]);
    const res = await p.checkRemoval(img, img);
    expect(res.usage.estimatedCostUsd).toBeCloseTo((4000 * 0.1 + 300 * 0.5) / 1e6);
  });

  it('faz retry quando o JSON é inválido e soma o custo das duas chamadas', async () => {
    const { p, create } = provider([completion('{"removed": "talvez"}'), completion(REMOVED)]);
    const res = await p.checkRemoval(img, img);
    expect(res.data.removed).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(res.usage.estimatedCostUsd).toBeCloseTo(0.0011);
  });

  it('sem créditos (402) vira mensagem clara', async () => {
    const err = OpenAI.APIError.generate(
      402,
      { message: 'Insufficient credits' },
      undefined,
      new Headers(),
    );
    const { p } = provider([err]);
    await expect(p.checkRemoval(img, img)).rejects.toThrow(/Sem créditos no OpenRouter/);
  });

  it('sem chave falha com VisionError (sem derrubar a API)', async () => {
    const p = new OpenRouterVisionProvider(
      { model: 'anthropic/claude-haiku-5.5', effort: 'low' },
      silentLog,
    );
    await expect(p.checkRemoval(img, img)).rejects.toBeInstanceOf(VisionError);
  });
});
