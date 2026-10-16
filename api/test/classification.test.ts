import { describe, expect, it } from 'vitest';
import { classifyComparison, EVENT_META, severityOf } from '../src/domain/classification';
import { applyChanges } from '../src/domain/inventory';
import type { Change } from '../src/domain/types';

const change = (kind: Change['change'], extra: Partial<Change> = {}): Change => ({
  itemId: null,
  label: 'Item',
  change: kind,
  quantity: 1,
  beforeRegion: null,
  afterRegion: null,
  confidence: 0.9,
  ...extra,
});

describe('classifyComparison (precedência)', () => {
  it('sem mudanças → no_change', () => {
    expect(classifyComparison({ changes: [] })).toBe('no_change');
  });
  it('retirado vence movido e adicionado', () => {
    expect(
      classifyComparison({ changes: [change('moved'), change('removed'), change('added')] }),
    ).toBe('removed');
  });
  it('só movido → moved', () => {
    expect(classifyComparison({ changes: [change('moved')] })).toBe('moved');
  });
  it('adicionado conta como moved (atenção)', () => {
    expect(classifyComparison({ changes: [change('added')] })).toBe('moved');
  });
});

describe('mapeamento tipo → severidade', () => {
  it('é fixo', () => {
    expect(severityOf('removed')).toBe('alert');
    expect(severityOf('moved')).toBe('attention');
    expect(severityOf('no_change')).toBe('info');
    expect(severityOf('analysis_failed')).toBe('error');
    expect(EVENT_META.removed.label).toBe('Alerta: produto retirado');
  });
});

describe('applyChanges (inventário)', () => {
  const inv = {
    items: [
      { id: 'p1', label: 'Coca', quantity: 2, region: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
      { id: 'p2', label: 'Suco', quantity: 1, region: { x: 0.5, y: 0.1, w: 0.1, h: 0.1 } },
    ],
  };

  it('decrementa e remove itens retirados', () => {
    const a = applyChanges(inv, [change('removed', { itemId: 'p1' })]);
    expect(a.items.find((i) => i.id === 'p1')?.quantity).toBe(1);
    const b = applyChanges(inv, [change('removed', { itemId: 'p2' })]);
    expect(b.items.some((i) => i.id === 'p2')).toBe(false);
  });
  it('acha o item pela região quando não há itemId', () => {
    const a = applyChanges(inv, [
      change('removed', { beforeRegion: { x: 0.5, y: 0.1, w: 0.1, h: 0.1 } }),
    ]);
    expect(a.items.map((i) => i.id)).toEqual(['p1']);
  });
  it('reposiciona movidos e adiciona novos com id sequencial', () => {
    const after = { x: 0.7, y: 0.7, w: 0.1, h: 0.1 };
    const a = applyChanges(inv, [
      change('moved', { itemId: 'p2', afterRegion: after }),
      change('added', { label: 'Água', afterRegion: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 } }),
    ]);
    expect(a.items.find((i) => i.id === 'p2')?.region).toEqual(after);
    expect(a.items.find((i) => i.id === 'p3')?.label).toBe('Água');
  });
  it('não altera o inventário original', () => {
    applyChanges(inv, [change('removed', { itemId: 'p1' })]);
    expect(inv.items[0]!.quantity).toBe(2);
  });
});
