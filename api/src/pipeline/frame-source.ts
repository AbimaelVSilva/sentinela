import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';

export interface Frame {
  jpeg: Buffer;
  /** Momento em que o frame chegou (ms epoch). */
  ts: number;
  seq: number;
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Separa um stream MJPEG (concatenação de JPEGs) em frames usando os
 * marcadores SOI (FFD8) / EOI (FFD9). Exportado para testes.
 */
export class MjpegSplitter {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames: Buffer[] = [];
    for (;;) {
      const start = this.buf.indexOf(SOI);
      if (start < 0) {
        this.buf = Buffer.alloc(0);
        break;
      }
      const end = this.buf.indexOf(EOI, start + 2);
      if (end < 0) {
        if (start > 0) this.buf = this.buf.subarray(start);
        if (this.buf.length > MAX_BUFFER) this.buf = Buffer.alloc(0);
        break;
      }
      frames.push(Buffer.from(this.buf.subarray(start, end + 2)));
      this.buf = this.buf.subarray(end + 2);
    }
    return frames;
  }
}

export interface FrameSourceOptions {
  url: string;
  fps: number;
  /** Duração do ring buffer em segundos. */
  bufferSeconds?: number;
  log: FastifyBaseLogger;
}

/**
 * Lê o RTSP de uma câmera com ffmpeg e emite frames JPEG (`frame`).
 * Mantém o último frame e um ring buffer curto; reconecta com backoff exponencial
 * (1 s → 30 s) quando o ffmpeg termina. Nunca lança — só loga em `warn`.
 */
export class FrameSource extends EventEmitter<{ frame: [Frame] }> {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stopped = true;
  private backoffMs = 1000;
  private retryTimer: NodeJS.Timeout | null = null;
  private seq = 0;
  private ring: Frame[] = [];
  private lastStderr = '';
  private healthyTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: FrameSourceOptions) {
    super();
  }

  get latest(): Frame | null {
    return this.ring[this.ring.length - 1] ?? null;
  }

  get buffer(): readonly Frame[] {
    return this.ring;
  }

  get running(): boolean {
    return !this.stopped;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.spawn();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    this.retryTimer = null;
    this.proc?.kill('SIGKILL');
    this.proc = null;
    this.ring = [];
  }

  /** Aguarda o próximo frame (ou devolve o último se for recente). */
  async nextFrame(timeoutMs = 5000, maxAgeMs = 0): Promise<Frame | null> {
    const last = this.latest;
    if (last && maxAgeMs > 0 && Date.now() - last.ts <= maxAgeMs) return last;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off('frame', onFrame);
        resolve(this.latest);
      }, timeoutMs);
      const onFrame = (f: Frame) => {
        clearTimeout(timer);
        resolve(f);
      };
      this.once('frame', onFrame);
    });
  }

  private spawn() {
    const { url, fps, log } = this.opts;
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-rtsp_transport',
      'tcp',
      '-timeout',
      '10000000',
      '-i',
      url,
      '-an',
      '-vf',
      `fps=${fps},scale=1280:-2`,
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-q:v',
      '4',
      'pipe:1',
    ];
    let proc: ChildProcessByStdio<null, Readable, Readable>;
    try {
      proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      log.warn({ err }, 'Falha ao iniciar ffmpeg');
      this.scheduleRestart();
      return;
    }
    this.proc = proc;
    const splitter = new MjpegSplitter();
    const maxFrames = Math.max(1, Math.round((this.opts.bufferSeconds ?? 3) * fps));

    // Considera a conexão saudável após 10 s recebendo frames: zera o backoff.
    this.healthyTimer = setTimeout(() => (this.backoffMs = 1000), 10_000);

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const jpeg of splitter.push(chunk)) {
        const frame: Frame = { jpeg, ts: Date.now(), seq: ++this.seq };
        this.ring.push(frame);
        if (this.ring.length > maxFrames) this.ring.shift();
        this.emit('frame', frame);
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      this.lastStderr = (this.lastStderr + chunk.toString()).slice(-500);
    });
    proc.on('error', (err) => {
      log.warn({ err }, 'Erro no processo ffmpeg');
    });
    proc.on('close', (code, signal) => {
      if (this.healthyTimer) clearTimeout(this.healthyTimer);
      if (this.proc === proc) this.proc = null;
      if (this.stopped) return;
      log.warn(
        { code, signal, stderr: this.lastStderr.trim().split('\n').slice(-2).join(' | ') },
        `ffmpeg encerrou; reconectando em ${this.backoffMs / 1000}s`,
      );
      this.scheduleRestart();
    });
  }

  private scheduleRestart() {
    if (this.stopped) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(30_000, this.backoffMs * 2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.spawn();
    }, delay);
  }
}
