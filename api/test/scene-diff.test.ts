import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { pointInPolygon, roiIgnoreMask, sceneDiff } from '../src/pipeline/scene-diff';

const W = 640;
const H = 360;

/** Prateleira sintética: fundo cinza com "produtos" coloridos. */
async function shelf(
  products: { x: number; y: number; color: string }[],
  opts: { noise?: number; brightness?: number } = {},
): Promise<Buffer> {
  const rects = products
    .map((p) => `<rect x="${p.x}" y="${p.y}" width="50" height="80" fill="${p.color}"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#555"/>${rects}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (opts.brightness) img = img.modulate({ brightness: opts.brightness });
  let raw = await img.removeAlpha().raw().toBuffer();
  if (opts.noise) {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    raw = Buffer.from(raw.map((v) => Math.max(0, Math.min(255, v + rand() * opts.noise!))));
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

const PRODUCTS = [
  { x: 60, y: 60, color: '#d81e1e' },
  { x: 160, y: 60, color: '#1f9e3a' },
  { x: 260, y: 60, color: '#1d4fd8' },
  { x: 360, y: 200, color: '#e8c400' },
  { x: 460, y: 200, color: '#7b2fd0' },
];
const ROI = [
  { x: 0.05, y: 0.1 },
  { x: 0.95, y: 0.1 },
  { x: 0.95, y: 0.9 },
  { x: 0.05, y: 0.9 },
];
const SCENE_DIFF_MIN = 0.004;

describe('sceneDiff', () => {
  it('imagens idênticas → 0', async () => {
    const a = await shelf(PRODUCTS);
    expect(await sceneDiff(a, a, ROI)).toBe(0);
  });

  it('ruído de sensor fica abaixo do limiar do pré-filtro', async () => {
    const a = await shelf(PRODUCTS, { noise: 10 });
    const b = await shelf(PRODUCTS, { noise: 12 });
    expect(await sceneDiff(a, b, ROI)).toBeLessThan(SCENE_DIFF_MIN);
  });

  it('produto retirado passa do limiar', async () => {
    const a = await shelf(PRODUCTS);
    const b = await shelf(PRODUCTS.slice(1));
    expect(await sceneDiff(a, b, ROI)).toBeGreaterThan(SCENE_DIFF_MIN);
  });

  it('mudança fora da ROI é ignorada', async () => {
    const smallRoi = [
      { x: 0.5, y: 0.5 },
      { x: 0.95, y: 0.5 },
      { x: 0.95, y: 0.95 },
      { x: 0.5, y: 0.95 },
    ];
    const a = await shelf(PRODUCTS);
    const b = await shelf(PRODUCTS.slice(1)); // retira o produto do canto superior esquerdo
    expect(await sceneDiff(a, b, smallRoi)).toBe(0);
  });

  it('sem ROI compara o frame inteiro', async () => {
    const a = await shelf(PRODUCTS);
    const b = await shelf(PRODUCTS.slice(1));
    expect(await sceneDiff(a, b, null)).toBeGreaterThan(SCENE_DIFF_MIN);
  });
});

describe('máscara da ROI', () => {
  it('pointInPolygon', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, ROI)).toBe(true);
    expect(pointInPolygon({ x: 0.01, y: 0.5 }, ROI)).toBe(false);
  });
  it('triângulo ocupa ~metade da bbox', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const { inside } = roiIgnoreMask(tri, 100, 100);
    expect(inside / 10000).toBeCloseTo(0.5, 1);
  });
});
