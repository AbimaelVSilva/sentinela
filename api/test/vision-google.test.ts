import { FinishReason, type GenerateContentResponse, type GoogleGenAI } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { GoogleVisionProvider } from '../src/vision/google';
import { VisionError } from '../src/vision/provider';
import { silentLog } from './helpers';

function reply(text: string, extra: Partial<GenerateContentResponse> = {}) {
  return {
    text,
    candidates: [
      { finishReason: FinishReason.STOP, content: { role: 'model', parts: [{ text }] } },
    ],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 150 },
    modelVersion: 'gemini-2.5-flash',
    ...extra,
  } as unknown as GenerateContentResponse;
}

function provider(responses: GenerateContentResponse[], model = 'gemini-2.5-flash') {
  const generateContent = vi.fn();
  responses.forEach((r) => generateContent.mockResolvedValueOnce(r));
  const client = { models: { generateContent } } as unknown as GoogleGenAI;
  return { p: new GoogleVisionProvider({ model, client }, silentLog), generateContent };
}

const SCENE = JSON.stringify({
  isShelfScene: false,
  viewAngle: 'frontal',
  productCountEstimate: 3,
  issues: ['muito escuro'],
});
const img = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe('GoogleVisionProvider', () => {
  it('envia imagens inline com JSON Schema e soma tokens de pensamento como saída', async () => {
    const { p, generateContent } = provider([reply(SCENE)]);
    const res = await p.validateScene(img);
    expect(res.data).toMatchObject({ isShelfScene: false, issues: ['muito escuro'] });
    expect(res.usage).toMatchObject({ inputTokens: 1000, outputTokens: 200 });
    expect(res.usage.estimatedCostUsd).toBeCloseTo((1000 * 0.3 + 200 * 2.5) / 1e6);

    const req = generateContent.mock.calls[0]![0] as {
      contents: { parts: { inlineData?: { mimeType: string } }[] }[];
      config: {
        responseMimeType: string;
        responseJsonSchema: { type: string };
        temperature?: number;
      };
    };
    expect(req.contents[0]!.parts.some((p) => p.inlineData?.mimeType === 'image/jpeg')).toBe(true);
    expect(req.config.responseMimeType).toBe('application/json');
    expect(req.config.responseJsonSchema.type).toBe('object');
    expect(req.config.temperature).toBe(0);
  });

  it('Gemini 3 mantém a temperatura padrão', async () => {
    const { p, generateContent } = provider([reply(SCENE)], 'gemini-3-pro-preview');
    await p.validateScene(img);
    expect(generateContent.mock.calls[0]![0].config).not.toHaveProperty('temperature');
  });

  it('retry com o erro de validação e falha na segunda resposta inválida', async () => {
    const ok = provider([reply('{"isShelfScene": 1}'), reply(SCENE)]);
    await expect(ok.p.validateScene(img)).resolves.toBeTruthy();
    const retry = ok.generateContent.mock.calls[1]![0] as { contents: { role: string }[] };
    expect(retry.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);

    const bad = provider([reply('x'), reply('y')]);
    await expect(bad.p.validateScene(img)).rejects.toBeInstanceOf(VisionError);
  });

  it('bloqueio de segurança e truncamento viram VisionError', async () => {
    const blocked = provider([reply('', { promptFeedback: { blockReason: 'SAFETY' } } as never)]);
    await expect(blocked.p.validateScene(img)).rejects.toThrow(/recusou/);
    const truncated = provider([
      reply('{', {
        candidates: [{ finishReason: FinishReason.MAX_TOKENS }],
      } as never),
    ]);
    await expect(truncated.p.validateScene(img)).rejects.toThrow(/truncada/);
  });

  it('sem chave não quebra na criação; a chamada falha com mensagem clara', async () => {
    const p = new GoogleVisionProvider({ model: 'gemini-2.5-flash' }, silentLog);
    await expect(p.validateScene(img)).rejects.toThrow(/GOOGLE_API_KEY/);
  });
});
