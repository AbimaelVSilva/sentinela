import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import type { Region } from '../domain/types';

export interface Detection {
  /** bbox normalizada 0..1 no frame original. */
  bbox: Region;
  confidence: number;
}

/** Interface mínima usada pela máquina de estados (facilita mocks nos testes). */
export interface PersonDetector {
  detect(jpeg: Buffer): Promise<Detection[]>;
}

const INPUT = 640;
const PAD_VALUE = 114;
const PERSON_CLASS = 0;
const NMS_IOU = 0.45;

export interface Letterbox {
  scale: number;
  padX: number;
  padY: number;
  width: number;
  height: number;
}

/** Letterbox para 640×640 (RGB, NCHW Float32 normalizado 0..1). */
export async function preprocess(jpeg: Buffer): Promise<{ tensor: Float32Array; lb: Letterbox }> {
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? INPUT;
  const height = meta.height ?? INPUT;
  const scale = Math.min(INPUT / width, INPUT / height);
  const nw = Math.round(width * scale);
  const nh = Math.round(height * scale);
  const padX = Math.floor((INPUT - nw) / 2);
  const padY = Math.floor((INPUT - nh) / 2);

  const { data } = await sharp(jpeg)
    .resize(nw, nh, { fit: 'fill' })
    .extend({
      left: padX,
      right: INPUT - nw - padX,
      top: padY,
      bottom: INPUT - nh - padY,
      background: { r: PAD_VALUE, g: PAD_VALUE, b: PAD_VALUE },
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const plane = INPUT * INPUT;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    tensor[i] = data[i * 3]! / 255;
    tensor[plane + i] = data[i * 3 + 1]! / 255;
    tensor[2 * plane + i] = data[i * 3 + 2]! / 255;
  }
  return { tensor, lb: { scale, padX, padY, width, height } };
}

function iou(a: Region, b: Region): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export function nms(dets: Detection[], iouThreshold = NMS_IOU): Detection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (kept.every((k) => iou(k.bbox, d.bbox) < iouThreshold)) kept.push(d);
  }
  return kept;
}

/**
 * Pós-processa a saída do YOLOv8/11 ([1, 4 + nc, N], colunas cx, cy, w, h, scores…)
 * mantendo só a classe `person`, desfazendo o letterbox e normalizando 0..1.
 */
export function postprocess(
  output: Float32Array,
  dims: readonly number[],
  lb: Letterbox,
  minConf: number,
): Detection[] {
  const [, rows = 0, n = 0] = dims;
  if (rows < 5) return [];
  const dets: Detection[] = [];
  const cls = 4 + PERSON_CLASS;
  for (let i = 0; i < n; i++) {
    const conf = output[cls * n + i]!;
    if (conf < minConf) continue;
    const cx = output[i]!;
    const cy = output[n + i]!;
    const w = output[2 * n + i]!;
    const h = output[3 * n + i]!;
    const x0 = (cx - w / 2 - lb.padX) / lb.scale;
    const y0 = (cy - h / 2 - lb.padY) / lb.scale;
    const x1 = (cx + w / 2 - lb.padX) / lb.scale;
    const y1 = (cy + h / 2 - lb.padY) / lb.scale;
    const nx0 = Math.max(0, Math.min(1, x0 / lb.width));
    const ny0 = Math.max(0, Math.min(1, y0 / lb.height));
    const nx1 = Math.max(0, Math.min(1, x1 / lb.width));
    const ny1 = Math.max(0, Math.min(1, y1 / lb.height));
    if (nx1 <= nx0 || ny1 <= ny0) continue;
    dets.push({ bbox: { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 }, confidence: conf });
  }
  return nms(dets);
}

/**
 * Detector YOLO (ONNX). Uma única InferenceSession compartilhada entre câmeras e
 * inferências serializadas por uma fila, para não estourar a CPU.
 */
export class YoloPersonDetector implements PersonDetector {
  private session: Promise<ort.InferenceSession> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly modelPath: string,
    private readonly minConf: number,
    private readonly log: FastifyBaseLogger,
  ) {}

  get available(): boolean {
    return fs.existsSync(this.modelPath);
  }

  /** Quantas inferências estão na fila (para descartar frames se acumular). */
  get backlog(): number {
    return this.pending;
  }

  private getSession(): Promise<ort.InferenceSession> {
    if (!this.session) {
      this.session = ort.InferenceSession.create(this.modelPath, {
        intraOpNumThreads: 2,
        graphOptimizationLevel: 'all',
      }).then(
        (s) => {
          this.log.info({ model: this.modelPath, inputs: s.inputNames }, 'Modelo YOLO carregado');
          return s;
        },
        (err: unknown) => {
          this.session = null;
          throw err;
        },
      );
    }
    return this.session;
  }

  detect(jpeg: Buffer): Promise<Detection[]> {
    this.pending++;
    const run = this.queue.then(async () => {
      const session = await this.getSession();
      const { tensor, lb } = await preprocess(jpeg);
      const input = new ort.Tensor('float32', tensor, [1, 3, INPUT, INPUT]);
      const results = await session.run({ [session.inputNames[0]!]: input });
      const out = results[session.outputNames[0]!]!;
      return postprocess(out.data as Float32Array, out.dims, lb, this.minConf);
    });
    this.queue = run.catch(() => undefined).finally(() => this.pending--);
    return run;
  }
}
