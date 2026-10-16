import { describe, expect, it } from 'vitest';
import {
  bboxRoiOverlap,
  clipPolygonToRect,
  polygonArea,
  regionFromCrop,
  regionToCrop,
  roiBoundingBox,
} from '../src/domain/geometry';

const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('polygonArea', () => {
  it('calcula área de quadrado e triângulo', () => {
    expect(polygonArea(square(0, 0, 0.5, 0.5))).toBeCloseTo(0.25);
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]),
    ).toBeCloseTo(0.5);
  });
  it('independe da orientação', () => {
    expect(polygonArea(square(0, 0, 1, 1).reverse())).toBeCloseTo(1);
  });
});

describe('bboxRoiOverlap (interseção / área do bbox)', () => {
  const roi = square(0.2, 0.2, 0.8, 0.8);

  it('bbox inteiro dentro da ROI = 1', () => {
    expect(bboxRoiOverlap({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, roi)).toBeCloseTo(1);
  });
  it('bbox fora da ROI = 0', () => {
    expect(bboxRoiOverlap({ x: 0.85, y: 0.85, w: 0.1, h: 0.1 }, roi)).toBe(0);
  });
  it('bbox pela metade dentro = 0.5', () => {
    expect(bboxRoiOverlap({ x: 0.7, y: 0.3, w: 0.2, h: 0.2 }, roi)).toBeCloseTo(0.5);
  });
  it('pessoa grande cobrindo a ROI: fração relativa ao bbox da pessoa', () => {
    // bbox 0..1 (área 1), ROI 0.6×0.6 = 0.36
    expect(bboxRoiOverlap({ x: 0, y: 0, w: 1, h: 1 }, roi)).toBeCloseTo(0.36);
  });
  it('ROI triangular', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(bboxRoiOverlap({ x: 0, y: 0, w: 1, h: 1 }, tri)).toBeCloseTo(0.5);
  });
  it('sem ROI usa o frame inteiro', () => {
    expect(bboxRoiOverlap({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, null)).toBeCloseTo(1);
    expect(bboxRoiOverlap({ x: 0.9, y: 0.1, w: 0.2, h: 0.2 }, [])).toBeCloseTo(0.5);
  });
  it('bbox degenerado = 0', () => {
    expect(bboxRoiOverlap({ x: 0.5, y: 0.5, w: 0, h: 0.2 }, roi)).toBe(0);
  });
});

describe('clipPolygonToRect', () => {
  it('recorta polígono por retângulo', () => {
    const clipped = clipPolygonToRect(square(0, 0, 1, 1), { x: 0.5, y: 0.5, w: 1, h: 1 });
    expect(polygonArea(clipped)).toBeCloseTo(0.25);
  });
});

describe('roiBoundingBox / mapeamento de recorte', () => {
  it('bbox com margem limitada a 0..1', () => {
    const box = roiBoundingBox(square(0.1, 0.2, 0.5, 0.6), 0.05);
    expect(box.x).toBeCloseTo(0.08);
    expect(box.y).toBeCloseTo(0.18);
    expect(box.w).toBeCloseTo(0.44);
    expect(box.h).toBeCloseTo(0.44);
    expect(roiBoundingBox(square(0, 0, 1, 1), 0.1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(roiBoundingBox(null)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it('ida e volta entre recorte e frame', () => {
    const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.8 };
    const r = { x: 0.3, y: 0.4, w: 0.1, h: 0.2 };
    const back = regionToCrop(regionFromCrop(r, crop), crop);
    expect(back.x).toBeCloseTo(r.x);
    expect(back.y).toBeCloseTo(r.y);
    expect(back.w).toBeCloseTo(r.w);
    expect(back.h).toBeCloseTo(r.h);
  });
});
