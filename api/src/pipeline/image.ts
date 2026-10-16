import sharp from 'sharp';
import type { Region } from '../domain/types';

export interface ImageInfo {
  width: number;
  height: number;
}

export async function imageInfo(jpeg: Buffer): Promise<ImageInfo> {
  const meta = await sharp(jpeg).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** Converte uma região normalizada em pixels inteiros válidos para `extract`. */
export function regionToPixels(r: Region, info: ImageInfo) {
  const left = Math.max(0, Math.min(info.width - 1, Math.round(r.x * info.width)));
  const top = Math.max(0, Math.min(info.height - 1, Math.round(r.y * info.height)));
  const width = Math.max(1, Math.min(info.width - left, Math.round(r.w * info.width)));
  const height = Math.max(1, Math.min(info.height - top, Math.round(r.h * info.height)));
  return { left, top, width, height };
}

/** Recorta (região normalizada) e limita o lado maior; devolve JPEG. */
export async function cropJpeg(
  jpeg: Buffer,
  region: Region,
  opts: { maxSide?: number; quality?: number } = {},
): Promise<Buffer> {
  const info = await imageInfo(jpeg);
  const { maxSide = 1568, quality = 88 } = opts;
  return sharp(jpeg)
    .extract(regionToPixels(region, info))
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

/** Limita o lado maior de uma imagem (para envio à IA). */
export async function limitJpeg(jpeg: Buffer, maxSide = 1568, quality = 88): Promise<Buffer> {
  return sharp(jpeg)
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}
