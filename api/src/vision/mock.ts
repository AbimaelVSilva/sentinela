import sharp from 'sharp';
import type { Change, Comparison, Inventory, Region, SceneValidation } from '../domain/types';
import type { VisionProvider, VisionResult } from './provider';

/**
 * Provider de visão SIMULADO (VISION_PROVIDER=mock), para desenvolvimento sem chave
 * de API. Segmenta "produtos" como manchas de cor saturada sobre um fundo neutro e
 * compara as manchas entre antes/depois. Funciona bem com o vídeo sintético de
 * `scripts/make-test-video.ts`; em cenas reais é só um placeholder.
 */

interface Blob {
  region: Region;
  area: number;
  hue: number;
}

const WIDTH = 240;
const NO_USAGE = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, model: 'mock' };

async function segment(jpeg: Buffer): Promise<{ blobs: Blob[]; brightness: number }> {
  const { data, info } = await sharp(jpeg)
    .resize({ width: WIDTH })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const mask = new Uint8Array(w * h);
  const hues = new Float32Array(w * h);
  let bright = 0;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3]! / 255;
    const g = data[i * 3 + 1]! / 255;
    const b = data[i * 3 + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const s = max === 0 ? 0 : (max - min) / max;
    bright += max;
    if (s > 0.45 && max > 0.35) {
      mask[i] = 1;
      const d = max - min;
      const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hues[i] = (hue * 60 + 360) % 360;
    }
  }

  const seen = new Uint8Array(w * h);
  const blobs: Blob[] = [];
  const minArea = (w * h) / 900;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let hx = 0;
    let hy = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      area++;
      const rad = (hues[p]! * Math.PI) / 180;
      hx += Math.cos(rad);
      hy += Math.sin(rad);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || !mask[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (area < minArea) continue;
    blobs.push({
      region: { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h },
      area: area / (w * h),
      hue: ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360,
    });
  }
  blobs.sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
  return { blobs, brightness: bright / (w * h) };
}

function colorName(hue: number): string {
  if (hue < 15 || hue >= 340) return 'vermelho';
  if (hue < 40) return 'laranja';
  if (hue < 70) return 'amarelo';
  if (hue < 170) return 'verde';
  if (hue < 200) return 'ciano';
  if (hue < 260) return 'azul';
  return 'roxo';
}

const hueDiff = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const sameKind = (a: Blob, b: Blob) =>
  hueDiff(a.hue, b.hue) < 18 && a.area / b.area > 0.6 && a.area / b.area < 1.6;

function iou(a: Region, b: Region): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock';

  async validateScene(image: Buffer): Promise<VisionResult<SceneValidation>> {
    const { blobs, brightness } = await segment(image);
    const issues = ['Análise simulada (VISION_PROVIDER=mock) — configure a IA real para produção'];
    if (brightness < 0.2) issues.push('muito escuro');
    return {
      data: {
        isShelfScene: blobs.length >= 3,
        viewAngle: 'high_angle',
        productCountEstimate: blobs.length,
        issues,
      },
      usage: NO_USAGE,
    };
  }

  async inventory(image: Buffer): Promise<VisionResult<Inventory>> {
    const { blobs } = await segment(image);
    return {
      data: {
        items: blobs.map((b, i) => ({
          id: `p${i + 1}`,
          label: `Produto ${colorName(b.hue)}`,
          quantity: 1,
          region: b.region,
          shelfRow: null,
        })),
      },
      usage: NO_USAGE,
    };
  }

  async compare(
    before: Buffer,
    after: Buffer,
    inventory: Inventory | null,
  ): Promise<VisionResult<Comparison>> {
    const [a, b] = await Promise.all([segment(before), segment(after)]);
    const freeBefore = new Set(a.blobs.map((_, i) => i));
    const freeAfter = new Set(b.blobs.map((_, i) => i));

    // 1) Mesma cor/tamanho na mesma posição → sem mudança.
    for (const i of [...freeBefore]) {
      const j = [...freeAfter].find(
        (k) =>
          sameKind(a.blobs[i]!, b.blobs[k]!) && iou(a.blobs[i]!.region, b.blobs[k]!.region) > 0.5,
      );
      if (j !== undefined) {
        freeBefore.delete(i);
        freeAfter.delete(j);
      }
    }

    const itemFor = (r: Region) =>
      inventory?.items.find((it) => iou(it.region, r) > 0.4)?.id ?? null;
    const changes: Change[] = [];

    // 2) Mesma cor/tamanho em outra posição → movido.
    for (const i of [...freeBefore]) {
      const j = [...freeAfter].find((k) => sameKind(a.blobs[i]!, b.blobs[k]!));
      if (j === undefined) continue;
      freeBefore.delete(i);
      freeAfter.delete(j);
      changes.push({
        itemId: itemFor(a.blobs[i]!.region),
        label: `Produto ${colorName(a.blobs[i]!.hue)}`,
        change: 'moved',
        quantity: 1,
        beforeRegion: a.blobs[i]!.region,
        afterRegion: b.blobs[j]!.region,
        confidence: 0.7,
      });
    }
    // 3) Sobras: antes sem par → retirado; depois sem par → adicionado.
    for (const i of freeBefore) {
      changes.push({
        itemId: itemFor(a.blobs[i]!.region),
        label: `Produto ${colorName(a.blobs[i]!.hue)}`,
        change: 'removed',
        quantity: 1,
        beforeRegion: a.blobs[i]!.region,
        afterRegion: null,
        confidence: 0.75,
      });
    }
    for (const j of freeAfter) {
      changes.push({
        itemId: null,
        label: `Produto ${colorName(b.blobs[j]!.hue)}`,
        change: 'added',
        quantity: 1,
        beforeRegion: null,
        afterRegion: b.blobs[j]!.region,
        confidence: 0.65,
      });
    }

    const count = (k: Change['change']) => changes.filter((c) => c.change === k).length;
    const parts = [
      count('removed') && `${count('removed')} retirado(s)`,
      count('moved') && `${count('moved')} movido(s)`,
      count('added') && `${count('added')} adicionado(s)`,
    ].filter(Boolean);
    return {
      data: {
        changes,
        summary: parts.length
          ? `[simulado] ${parts.join(', ')}: ${changes.map((c) => c.label.toLowerCase()).join(', ')}.`
          : '[simulado] Nenhuma alteração nos produtos.',
        overallConfidence: changes.length ? 0.7 : 0.9,
      },
      usage: NO_USAGE,
    };
  }
}
