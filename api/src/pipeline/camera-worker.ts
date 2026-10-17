import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env';
import { db } from '../db/client';
import { cameras } from '../db/schema';
import {
  type AnalysisSettings,
  defaultAnalysisSettings,
  resolveAnalysisSettings,
} from '../domain/analysis-settings';
import { bus } from '../lib/bus';
import type { VisionProvider } from '../vision/provider';
import { recordOcclusionTimeout, runComparison } from './analysis';
import { type Frame, FrameSource } from './frame-source';
import { grabFullFrame } from './grab';
import type { PersonDetector } from './person-detector';
import { sceneDiff } from './scene-diff';
import { CameraStateMachine, type MachineParams } from './state-machine';

export { CameraStateMachine } from './state-machine';

/** Converte as configurações de análise da câmera nos parâmetros da máquina de estados. */
export function machineParams(s: AnalysisSettings = defaultAnalysisSettings()): MachineParams {
  return {
    personConfidence: s.personConfidence,
    enterFrames: s.enterConsecutiveFrames,
    clearMs: s.clearSeconds * 1000,
    stableMs: s.stableSeconds * 1000,
    stableDiffMax: s.stableDiffMax,
    overlapMin: s.roiOverlapMin,
    maxOcclusionMs: s.maxOcclusionSeconds * 1000,
    stableMaxWaitMs: s.stableMaxWaitSeconds * 1000,
  };
}

export interface WorkerDeps {
  detector: PersonDetector & { available?: boolean };
  vision: VisionProvider;
  log: FastifyBaseLogger;
}

/**
 * Worker de uma câmera online: lê frames (FrameSource) e alimenta a máquina de
 * estados. Frames que chegam enquanto o anterior é processado são descartados
 * (fica só o mais recente), mantendo a análise em tempo real.
 */
export class CameraWorker {
  private source: FrameSource | null = null;
  private machine: CameraStateMachine;
  private streamKey: string;
  private fps = defaultAnalysisSettings().analysisFps;
  private busy = false;
  private pending: Frame | null = null;
  private detectorWarned = false;
  private readonly log: FastifyBaseLogger;

  constructor(
    readonly cameraId: string,
    streamKey: string,
    private readonly deps: WorkerDeps,
  ) {
    this.streamKey = streamKey;
    this.log = deps.log.child({ cameraId });
    this.machine = new CameraStateMachine(machineParams(), {
      detector: deps.detector,
      diff: (a, b, roi) => sceneDiff(a, b, roi),
      now: () => Date.now(),
      log: this.log,
      onState: (state, info) =>
        bus.emit('camera.state', {
          cameraId,
          state,
          since: new Date(info.since).toISOString(),
          personEnteredAt: info.personEnteredAt
            ? new Date(info.personEnteredAt).toISOString()
            : null,
          queued: info.queued,
        }),
      analyze: async ({ after, personEnteredAt, personLeftAt }) => {
        // O after em resolução total (o frame de análise é reduzido a 1280 px).
        const full = (await grabFullFrame(this.rtspUrl)) ?? after;
        await runComparison({
          cameraId,
          after: full,
          personEnteredAt: new Date(personEnteredAt),
          personLeftAt: new Date(personLeftAt),
          vision: deps.vision,
          log: this.log,
        });
        await this.reload();
      },
      occlusionTimeout: ({ personEnteredAt }) =>
        recordOcclusionTimeout(cameraId, new Date(personEnteredAt), this.log),
    });
  }

  get rtspUrl(): string {
    return `${env.MEDIAMTX_RTSP_URL}/live/${this.streamKey}`;
  }

  get latestFrame(): Frame | null {
    return this.source?.latest ?? null;
  }

  get state() {
    return this.machine.state;
  }

  async start() {
    await this.reload();
    this.machine.announce();
    this.startSource();
  }

  stop() {
    this.source?.stop();
    this.source = null;
    bus.emit('camera.state', {
      cameraId: this.cameraId,
      state: 'OFFLINE',
      since: new Date().toISOString(),
      personEnteredAt: null,
      queued: false,
    });
  }

  /** Frame atual (aguarda o próximo se ainda não houver nenhum). */
  async currentFrame(timeoutMs = 5000): Promise<Buffer | null> {
    if (!this.source) return null;
    const f = await this.source.nextFrame(timeoutMs, 2000);
    return f?.jpeg ?? null;
  }

  /** Frame em resolução total (para calibração); cai para o último frame reduzido. */
  async fullFrame(): Promise<Buffer | null> {
    return (await grabFullFrame(this.rtspUrl)) ?? (await this.currentFrame());
  }

  /** Recarrega a configuração da câmera do banco (ROI, monitoramento, baseline, key). */
  async reload() {
    const cam = await db.query.cameras.findFirst({ where: eq(cameras.id, this.cameraId) });
    if (!cam) return;
    if (cam.streamKey !== this.streamKey) {
      this.streamKey = cam.streamKey;
      if (this.source) {
        this.source.stop();
        this.source = null;
        this.startSource();
      }
    }
    const settings = resolveAnalysisSettings(cam.analysisSettings);
    this.machine.setParams(machineParams(settings));
    if (settings.analysisFps !== this.fps) {
      this.fps = settings.analysisFps;
      if (this.source) {
        this.source.stop();
        this.source = null;
        this.startSource();
      }
    }
    const detectorOk = this.deps.detector.available !== false;
    if (!detectorOk && cam.monitoringEnabled && !this.detectorWarned) {
      this.detectorWarned = true;
      this.log.warn('Modelo YOLO ausente (rode `npm run model:download`); monitoramento inativo');
    }
    this.machine.configure({
      monitoringEnabled: cam.monitoringEnabled && detectorOk,
      hasBaseline: !!cam.baselineSnapshotId,
      roi: cam.roi,
    });
  }

  private startSource() {
    if (this.source) return;
    const source = new FrameSource({
      url: this.rtspUrl,
      fps: this.fps,
      bufferSeconds: 3,
      log: this.log,
    });
    source.on('frame', (f) => this.onFrame(f));
    source.start();
    this.source = source;
  }

  private onFrame(frame: Frame) {
    if (this.busy) {
      this.pending = frame;
      return;
    }
    void this.process(frame);
  }

  private async process(frame: Frame) {
    this.busy = true;
    try {
      await this.machine.processFrame(frame.jpeg);
    } catch (err) {
      this.log.warn({ err }, 'Erro ao processar frame');
    } finally {
      this.busy = false;
      const next = this.pending;
      this.pending = null;
      if (next) void this.process(next);
    }
  }
}
