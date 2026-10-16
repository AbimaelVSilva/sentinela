import { describe, expect, it } from 'vitest';
import { MjpegSplitter } from '../src/pipeline/frame-source';
import { nms, postprocess } from '../src/pipeline/person-detector';

describe('MjpegSplitter', () => {
  const jpeg = (fill: number) => Buffer.from([0xff, 0xd8, fill, fill, fill, 0xff, 0xd9]);

  it('separa frames concatenados', () => {
    const s = new MjpegSplitter();
    const frames = s.push(Buffer.concat([jpeg(1), jpeg(2), jpeg(3)]));
    expect(frames).toHaveLength(3);
    expect(frames[1]).toEqual(jpeg(2));
  });

  it('remonta frames quebrados entre chunks', () => {
    const s = new MjpegSplitter();
    const data = Buffer.concat([jpeg(1), jpeg(2)]);
    expect(s.push(data.subarray(0, 4))).toHaveLength(0);
    expect(s.push(data.subarray(4, 10))).toHaveLength(1);
    expect(s.push(data.subarray(10))).toEqual([jpeg(2)]);
  });

  it('descarta lixo antes do SOI', () => {
    const s = new MjpegSplitter();
    expect(s.push(Buffer.concat([Buffer.from([1, 2, 3]), jpeg(9)]))).toEqual([jpeg(9)]);
  });
});

describe('postprocess YOLO', () => {
  // Saída [1, 84, N]: 4 linhas de caixa + 80 classes; N âncoras.
  function output(
    boxes: { cx: number; cy: number; w: number; h: number; cls: number; conf: number }[],
  ) {
    const n = boxes.length;
    const data = new Float32Array(84 * n);
    boxes.forEach((b, i) => {
      data[i] = b.cx;
      data[n + i] = b.cy;
      data[2 * n + i] = b.w;
      data[3 * n + i] = b.h;
      data[(4 + b.cls) * n + i] = b.conf;
    });
    return { data, dims: [1, 84, n] };
  }
  // Frame 1280×720 com letterbox para 640: escala 0.5, padY = 140.
  const lb = { scale: 0.5, padX: 0, padY: 140, width: 1280, height: 720 };

  it('mantém só pessoas acima da confiança e desfaz o letterbox', () => {
    const { data, dims } = output([
      { cx: 320, cy: 320, w: 100, h: 200, cls: 0, conf: 0.9 },
      { cx: 100, cy: 300, w: 50, h: 50, cls: 2, conf: 0.95 }, // carro
      { cx: 500, cy: 300, w: 50, h: 50, cls: 0, conf: 0.2 }, // pessoa fraca
    ]);
    const dets = postprocess(data, dims, lb, 0.45);
    expect(dets).toHaveLength(1);
    const b = dets[0]!.bbox;
    // x0 = (320-50)/0.5 = 540 px → 0.4219; y0 = (220-140)/0.5 = 160 px → 0.2222
    expect(b.x).toBeCloseTo(540 / 1280, 3);
    expect(b.y).toBeCloseTo(160 / 720, 3);
    expect(b.w).toBeCloseTo(200 / 1280, 3);
    expect(b.h).toBeCloseTo(400 / 720, 3);
  });

  it('NMS remove caixas sobrepostas de menor confiança', () => {
    const dets = nms([
      { bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.4 }, confidence: 0.8 },
      { bbox: { x: 0.11, y: 0.1, w: 0.2, h: 0.4 }, confidence: 0.9 },
      { bbox: { x: 0.6, y: 0.1, w: 0.2, h: 0.4 }, confidence: 0.7 },
    ]);
    expect(dets.map((d) => d.confidence)).toEqual([0.9, 0.7]);
  });
});
