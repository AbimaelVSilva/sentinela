import type { Point, Region, RoiPolygon } from './types';

/** Área de um polígono (fórmula do laço / shoelace). */
export function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Recorta um polígono por um retângulo (Sutherland–Hodgman). */
export function clipPolygonToRect(poly: Point[], r: Region): Point[] {
  const edges: [(p: Point) => boolean, (a: Point, b: Point) => Point][] = [
    [(p) => p.x >= r.x, (a, b) => lerpX(a, b, r.x)],
    [(p) => p.x <= r.x + r.w, (a, b) => lerpX(a, b, r.x + r.w)],
    [(p) => p.y >= r.y, (a, b) => lerpY(a, b, r.y)],
    [(p) => p.y <= r.y + r.h, (a, b) => lerpY(a, b, r.y + r.h)],
  ];
  let out = poly;
  for (const [inside, intersect] of edges) {
    const input = out;
    out = [];
    if (input.length === 0) break;
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
  }
  return out;
}

function lerpX(a: Point, b: Point, x: number): Point {
  const t = (x - a.x) / (b.x - a.x);
  return { x, y: a.y + t * (b.y - a.y) };
}
function lerpY(a: Point, b: Point, y: number): Point {
  const t = (y - a.y) / (b.y - a.y);
  return { x: a.x + t * (b.x - a.x), y };
}

/**
 * Fração do bbox da pessoa que cai dentro da ROI: área(bbox ∩ ROI) / área(bbox).
 * Sem ROI, considera o frame inteiro (retorna a fração do bbox dentro da imagem).
 */
export function bboxRoiOverlap(bbox: Region, roi: RoiPolygon | null | undefined): number {
  const area = bbox.w * bbox.h;
  if (area <= 0) return 0;
  const poly = roi && roi.length >= 3 ? roi : FULL_FRAME;
  return polygonArea(clipPolygonToRect(poly, bbox)) / area;
}

export const FULL_FRAME: RoiPolygon = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Bounding box (normalizada) da ROI, expandida por `margin` (fração do tamanho da bbox). */
export function roiBoundingBox(roi: RoiPolygon | null | undefined, margin = 0): Region {
  if (!roi || roi.length < 3) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = roi.map((p) => p.x);
  const ys = roi.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  const x0 = Math.max(0, minX - w * margin);
  const y0 = Math.max(0, minY - h * margin);
  const x1 = Math.min(1, minX + w + w * margin);
  const y1 = Math.min(1, minY + h + h * margin);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Converte uma região relativa ao recorte `crop` para coordenadas do frame inteiro. */
export function regionFromCrop(r: Region, crop: Region): Region {
  return { x: crop.x + r.x * crop.w, y: crop.y + r.y * crop.h, w: r.w * crop.w, h: r.h * crop.h };
}

/** Converte uma região do frame inteiro para coordenadas relativas ao recorte `crop`. */
export function regionToCrop(r: Region, crop: Region): Region {
  return {
    x: (r.x - crop.x) / crop.w,
    y: (r.y - crop.y) / crop.h,
    w: r.w / crop.w,
    h: r.h / crop.h,
  };
}
