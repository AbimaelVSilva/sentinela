import { describe, expect, it } from 'vitest';
import { clipWindow } from '../src/pipeline/clip';

const opts = { pre: 3, post: 2, max: 60 };
const t = (s: number) => new Date(Date.UTC(2026, 9, 17, 12, 0, 0) + s * 1000);

describe('clipWindow', () => {
  it('cobre de antes da entrada até depois da saída', () => {
    const w = clipWindow(t(10), t(25), opts);
    expect(w.start.toISOString()).toBe(t(7).toISOString());
    expect(w.durationSeconds).toBe(20);
  });

  it('ocupação longa: mantém o final (onde está a ação)', () => {
    const w = clipWindow(t(0), t(300), opts);
    expect(w.durationSeconds).toBe(60);
    expect(w.start.toISOString()).toBe(t(242).toISOString());
  });

  it('nunca gera duração menor que 1 s nem janela invertida', () => {
    const w = clipWindow(t(10), t(5), { pre: 0, post: 0, max: 60 });
    expect(w.durationSeconds).toBeGreaterThanOrEqual(1);
  });
});
