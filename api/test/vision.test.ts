import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicVisionProvider } from '../src/vision/anthropic';
import {
  ApiComparison,
  ApiInventory,
  ApiSceneValidation,
  ComparisonSchema,
} from '../src/vision/prompts';
import { VisionError } from '../src/vision/provider';
import { silentLog } from './helpers';

function message(text: string, extra: Partial<Anthropic.Beta.BetaMessage> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 100 },
    ...extra,
  } as unknown as Anthropic.Beta.BetaMessage;
}

function provider(responses: Anthropic.Beta.BetaMessage[], model = 'claude-sonnet-5-5') {
  const create = vi.fn();
  responses.forEach((r) => create.mockResolvedValueOnce(r));
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  return { p: new AnthropicVisionProvider({ model, effort: 'medium', client }, silentLog), create };
}

const VALID_COMPARE = JSON.stringify({
  changes: [
    {
      itemId: 'p3',
      label: 'Coca-Cola lata 350ml',
      change: 'removed',
      quantity: 1,
      beforeRegion: { x: 0.2, y: 0.3, w: 0.1, h: 0.2 },
      afterRegion: null,
      confidence: 0.92,
    },
  ],
  summary: '1 lata de Coca-Cola retirada',
  overallConfidence: 0.9,
});

describe('schemas de saída', () => {
  it('geram JSON Schema para structured outputs', () => {
    for (const s of [ApiSceneValidation, ApiInventory, ApiComparison]) {
      const schema = zodOutputFormat(s).schema as Record<string, unknown>;
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('normaliza confiança e regiões para 0..1', () => {
    const parsed = ComparisonSchema.parse({
      changes: [
        {
          itemId: null,
          label: 'X',
          change: 'moved',
          quantity: 0,
          beforeRegion: { x: -0.1, y: 0.95, w: 0.3, h: 0.2 },
          afterRegion: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          confidence: 1.4,
        },
      ],
      summary: ' ok ',
      overallConfidence: -1,
    });
    const c = parsed.changes[0]!;
    expect(c.confidence).toBe(1);
    expect(c.quantity).toBe(1);
    expect(c.beforeRegion).toEqual({ x: 0, y: 0.95, w: 0.3, h: expect.closeTo(0.05) });
    expect(parsed.overallConfidence).toBe(0);
    expect(parsed.summary).toBe('ok');
  });
});

describe('AnthropicVisionProvider', () => {
  const img = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  it('envia as duas imagens e devolve a comparação validada com uso de tokens', async () => {
    const { p, create } = provider([message(VALID_COMPARE)]);
    const res = await p.compare(img, img, null);
    expect(res.data.changes[0]!.change).toBe('removed');
    expect(res.usage).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
    expect(res.usage.estimatedCostUsd).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6);

    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    const content = (body.messages as { content: { type: string }[] }[])[0]!.content;
    expect(content.filter((b) => b.type === 'image')).toHaveLength(2);
    // Sonnet 5.5 rejeita temperature não-padrão; o provider não envia.
    expect(body).not.toHaveProperty('temperature');
    expect(body).toMatchObject({ fallbacks: 'default', output_config: { effort: 'medium' } });
  });

  it('envia temperature 0 em modelos que aceitam', async () => {
    const { p, create } = provider([message(VALID_COMPARE)], 'claude-haiku-4-5');
    await p.compare(img, img, null);
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.temperature).toBe(0);
    expect(body.output_config).not.toHaveProperty('effort');
  });

  it('faz retry com a mensagem de erro quando o JSON é inválido', async () => {
    const { p, create } = provider([message('{"changes": "nada"}'), message(VALID_COMPARE)]);
    const res = await p.compare(img, img, null);
    expect(res.data.summary).toBe('1 lata de Coca-Cola retirada');
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1]![0] as { messages: { role: string; content: unknown }[] };
    expect(retry.messages).toHaveLength(3);
    expect(String(retry.messages[2]!.content)).toContain('não passou na validação');
    expect(res.usage.inputTokens).toBe(2000);
  });

  it('falha (VisionError) se o retry também vier inválido', async () => {
    const { p } = provider([message('não é json'), message('{}')]);
    await expect(p.compare(img, img, null)).rejects.toBeInstanceOf(VisionError);
  });

  it('trata refusal como falha de análise', async () => {
    const { p } = provider([
      message('', { stop_reason: 'refusal' } as Partial<Anthropic.Beta.BetaMessage>),
    ]);
    await expect(p.validateScene(img)).rejects.toThrow(/recusou/);
  });

  it('inclui o inventário como contexto textual', async () => {
    const { p, create } = provider([message(VALID_COMPARE)]);
    await p.compare(img, img, {
      items: [
        {
          id: 'p1',
          label: 'Leite integral 1L',
          quantity: 3,
          region: { x: 0, y: 0, w: 0.1, h: 0.1 },
        },
      ],
    });
    const body = create.mock.calls[0]![0] as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const text = body.messages[0]!.content.find(
      (b) => b.type === 'text' && b.text?.includes('Inventário'),
    );
    expect(text?.text).toContain('p1: Leite integral 1L');
  });
});
