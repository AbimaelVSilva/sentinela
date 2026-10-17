import { describe, expect, it } from 'vitest';
import {
  box2dToRegion,
  fromBox2dResponse,
  InventorySchema,
  inventoryContext,
  regionToBox2d,
} from '../src/vision/prompts';

describe('formato box_2d (Gemini)', () => {
  it('converte [ymin, xmin, ymax, xmax] 0..1000 para {x, y, w, h}', () => {
    const r = box2dToRegion([100, 200, 400, 600])!;
    expect(r.x).toBeCloseTo(0.2);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.4);
    expect(r.h).toBeCloseTo(0.3);
  });

  it('tolera ordem invertida e valores fora de 0..1000', () => {
    const r = box2dToRegion([400, 600, 100, -50])!;
    expect(r).toEqual({ x: 0, y: 0.1, w: 0.6, h: expect.closeTo(0.3) });
    expect(box2dToRegion([1, 2, 3])).toBeNull();
    expect(box2dToRegion('x')).toBeNull();
  });

  it('ida e volta com regionToBox2d', () => {
    const box = regionToBox2d({ x: 0.25, y: 0.5, w: 0.1, h: 0.2 });
    expect(box).toEqual([500, 250, 700, 350]);
    expect(box2dToRegion(box)).toEqual({
      x: 0.25,
      y: 0.5,
      w: expect.closeTo(0.1),
      h: expect.closeTo(0.2),
    });
  });

  it('converte respostas de inventário e comparação para o formato comum', () => {
    const inv = fromBox2dResponse({
      items: [{ id: 'p1', label: 'Coca', quantity: 2, box_2d: [0, 0, 500, 250], shelfRow: 1 }],
    });
    const parsed = InventorySchema.parse(inv);
    expect(parsed.items[0]!.region).toEqual({ x: 0, y: 0, w: 0.25, h: 0.5 });

    const cmp = fromBox2dResponse({
      changes: [{ change: 'moved', before_box_2d: [0, 0, 100, 100], after_box_2d: null }],
    }) as { changes: Record<string, unknown>[] };
    expect(cmp.changes[0]).toMatchObject({
      beforeRegion: { x: 0, y: 0, w: 0.1, h: 0.1 },
      afterRegion: null,
    });
    expect(cmp.changes[0]).not.toHaveProperty('before_box_2d');
  });

  it('o contexto do inventário usa o mesmo formato pedido', () => {
    const inv = {
      items: [
        { id: 'p1', label: 'Leite', quantity: 3, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      ],
    };
    expect(inventoryContext(inv, 'box_2d')).toContain('box_2d [200, 100, 600, 400]');
    expect(inventoryContext(inv)).toContain('região x=0.10 y=0.20');
  });
});
