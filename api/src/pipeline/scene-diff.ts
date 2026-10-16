import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { roiBoundingBox } from '../domain/geometry';
import type { Point, RoiPolygon } from '../domain/types';
import { imageInfo, regionToPixels } from './image';

export interface SceneDiffOptions {
  /** Largura de trabalho (px). */
  width?: number;
  /** Threshold do pixelmatch (0..1); maior = menos sensível. */
  threshold?: number;
  /** Sigma do blur gaussiano aplicado antes da comparação (0 = sem blur). */
  blur?: number;
}

const DEFAULTS: Required<SceneDiffOptions> = { width: 320, threshold: 0.12, blur: 1.2 };

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Máscara "ignorar" (1 = fora da ROI) para o recorte da bbox da ROI, no tamanho w×h.
 * Retorna também quantos pixels estão dentro.
 */
export function roiIgnoreMask(
  roi: RoiPolygon | null | undefined,
  w: number,
  h: number,
): { mask: Uint8Array | undefined; inside: number } {
  if (!roi || roi.length < 3) return { mask: undefined, inside: w * h };
  const box = roiBoundingBox(roi);
  const mask = new Uint8Array(w * h);
  let inside = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = { x: box.x + ((x + 0.5) / w) * box.w, y: box.y + ((y + 0.5) / h) * box.h };
      if (pointInPolygon(p, roi)) inside++;
      else mask[y * w + x] = 1;
    }
  }
  return { mask, inside };
}

const maskCache = new Map<string, ReturnType<typeof roiIgnoreMask>>();
function cachedMask(roi: RoiPolygon | null | undefined, w: number, h: number) {
  const key = `${JSON.stringify(roi ?? null)}|${w}x${h}`;
  let m = maskCache.get(key);
  if (!m) {
    m = roiIgnoreMask(roi, w, h);
    if (maskCache.size > 50) maskCache.clear();
    maskCache.set(key, m);
  }
  return m;
}

/**
 * Recorta a bbox da ROI, reduz e aplica blur; devolve RGBA.
 * Mantém a cor de propósito: em cinza, um produto com a mesma luminância do fundo
 * (ex.: lata vermelha em prateleira cinza) desapareceria e a retirada passaria
 * batida pelo pré-filtro. O pixelmatch compara luminância e crominância.
 */
async function prepare(
  jpeg: Buffer,
  roi: RoiPolygon | null | undefined,
  o: Required<SceneDiffOptions>,
) {
  const info = await imageInfo(jpeg);
  let img = sharp(jpeg).extract(regionToPixels(roiBoundingBox(roi), info));
  img = img.resize({ width: o.width });
  if (o.blur > 0.3) img = img.blur(o.blur);
  const { data, info: out } = await img
    .removeAlpha()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (out.channels !== 4)
    throw new Error(`scene-diff: esperado RGBA, recebido ${out.channels} canais`);
  return { data, width: out.width, height: out.height };
}

/**
 * Fração (0..1) de pixels diferentes entre duas imagens dentro da ROI.
 * Usado no pré-filtro antes/depois e para detectar estabilidade da cena.
 */
export async function sceneDiff(
  a: Buffer,
  b: Buffer,
  roi: RoiPolygon | null | undefined,
  opts: SceneDiffOptions = {},
): Promise<number> {
  const o = { ...DEFAULTS, ...opts };
  const [pa, pb] = await Promise.all([prepare(a, roi, o), prepare(b, roi, o)]);
  // Frames de resoluções diferentes (ex.: câmera mudou de perfil): redimensiona b para a.
  let bData: Uint8Array = pb.data;
  if (pb.width !== pa.width || pb.height !== pa.height) {
    bData = await sharp(pb.data, { raw: { width: pb.width, height: pb.height, channels: 4 } })
      .resize(pa.width, pa.height, { fit: 'fill' })
      .raw()
      .toBuffer();
  }
  const { mask, inside } = cachedMask(roi, pa.width, pa.height);
  if (inside === 0) return 0;
  const diff = pixelmatch(pa.data, bData, null, pa.width, pa.height, {
    threshold: o.threshold,
    includeAA: true,
    ignoreMask: mask,
  });
  return diff / inside;
}
