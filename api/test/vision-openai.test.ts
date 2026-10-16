import type OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { describe, expect, it, vi } from 'vitest';
import { OpenAIVisionProvider } from '../src/vision/openai';
import { ApiComparison, ApiInventory, ApiSceneValidation } from '../src/vision/prompts';
import { VisionError } from '../src/vision/provider';
import { silentLog } from './helpers';

type Part = { type: 'output_text'; text: string } | { type: 'refusal'; refusal: string };

function response(parts: Part[], extra: Record<string, unknown> = {}) {
  return {
    id: 'resp_1',
    object: 'response',
    model: 'gpt-5.1',
    status: 'completed',
    output: [
      { type: 'message', role: 'assistant', id: 'msg_1', status: 'completed', content: parts },
    ],
    usage: { input_tokens: 1200, output_tokens: 80, total_tokens: 1280 },
    ...extra,
  } as unknown as OpenAI.Responses.Response;
}
const text = (t: string) => response([{ type: 'output_text', text: t }]);

function provider(responses: OpenAI.Responses.Response[], model = 'gpt-5.1') {
  const create = vi.fn();
  responses.forEach((r) => create.mockResolvedValueOnce(r));
  const client = { responses: { create } } as unknown as OpenAI;
  return {
    p: new OpenAIVisionProvider({ model, effort: 'medium', client }, silentLog),
    create,
  };
}

const VALID_SCENE = JSON.stringify({
  isShelfScene: true,
  viewAngle: 'high_angle',
  productCountEstimate: 24,
  issues: [],
});
const VALID_COMPARE = JSON.stringify({
  changes: [
    {
      itemId: null,
      label: 'Suco de uva 1L',
      change: 'moved',
      quantity: 1,
      beforeRegion: { x: 0.6, y: 0.1, w: 0.1, h: 0.2 },
      afterRegion: { x: 0.8, y: 0.7, w: 0.1, h: 0.2 },
      confidence: 0.8,
    },
  ],
  summary: 'Suco de uva mudou de prateleira',
  overallConfidence: 0.85,
});
const img = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe('OpenAIVisionProvider', () => {
  it('os schemas geram formato JSON estrito aceito pela Responses API', () => {
    for (const [s, name] of [
      [ApiSceneValidation, 'scene'],
      [ApiInventory, 'inventory'],
      [ApiComparison, 'comparison'],
    ] as const) {
      const f = zodTextFormat(s, name);
      expect(f.type).toBe('json_schema');
      expect(f.strict).toBe(true);
    }
  });

  it('envia as imagens em base64 e valida a resposta', async () => {
    const { p, create } = provider([text(VALID_COMPARE)]);
    const res = await p.compare(img, img, null);
    expect(res.data.changes[0]!.change).toBe('moved');
    expect(res.usage).toMatchObject({ inputTokens: 1200, outputTokens: 80 });

    const body = create.mock.calls[0]![0] as {
      input: { content: { type: string; image_url?: string }[] }[];
      text: { format: { type: string } };
      reasoning?: { effort: string };
      temperature?: number;
    };
    const images = body.input[0]!.content.filter((c) => c.type === 'input_image');
    expect(images).toHaveLength(2);
    expect(images[0]!.image_url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.text.format.type).toBe('json_schema');
    // gpt-5*: modelo de raciocínio → reasoning.effort, sem temperature
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body).not.toHaveProperty('temperature');
  });

  it('modelos sem raciocínio recebem temperature 0', async () => {
    const { p, create } = provider([text(VALID_SCENE)], 'gpt-4.1');
    const res = await p.validateScene(img);
    expect(res.data.isShelfScene).toBe(true);
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty('reasoning');
    expect(res.usage.estimatedCostUsd).toBeCloseTo((1200 * 2 + 80 * 8) / 1e6);
  });

  it('faz retry quando o JSON não passa na validação', async () => {
    const { p, create } = provider([text('{"isShelfScene": "talvez"}'), text(VALID_SCENE)]);
    const res = await p.validateScene(img);
    expect(res.data.productCountEstimate).toBe(24);
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1]![0] as { input: { role: string; content: unknown }[] };
    expect(retry.input.map((i) => i.role)).toEqual(['user', 'assistant', 'user']);
    expect(res.usage.inputTokens).toBe(2400);
  });

  it('recusa e resposta incompleta viram VisionError', async () => {
    const refused = provider([response([{ type: 'refusal', refusal: 'não posso ajudar' }])]);
    await expect(refused.p.validateScene(img)).rejects.toThrow(/recusou/);

    const truncated = provider([
      response([{ type: 'output_text', text: '{"items": [' }], {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    ]);
    await expect(truncated.p.inventory(img)).rejects.toBeInstanceOf(VisionError);
  });
});

describe('OpenAIVisionProvider sem chave', () => {
  it('não falha na criação; a chamada vira VisionError com mensagem clara', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const p = new OpenAIVisionProvider({ model: 'gpt-5.1', effort: 'low' }, silentLog);
      await expect(p.validateScene(img)).rejects.toThrow(/OPENAI_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });
});
