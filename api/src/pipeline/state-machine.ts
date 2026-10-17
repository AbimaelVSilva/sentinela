import type { FastifyBaseLogger } from 'fastify';
import { bboxRoiOverlap } from '../domain/geometry';
import type { RoiPolygon } from '../domain/types';
import type { WorkerState } from '../lib/bus';
import type { PersonDetector } from './person-detector';

export type MachineState = Exclude<WorkerState, 'OFFLINE'>;

export interface MachineParams {
  /** Confiança mínima do detector para contar uma pessoa. */
  personConfidence: number;
  enterFrames: number;
  clearMs: number;
  stableMs: number;
  stableDiffMax: number;
  overlapMin: number;
  maxOcclusionMs: number;
  /** Se a cena nunca estabilizar, captura o after mesmo assim após este tempo. */
  stableMaxWaitMs: number;
}

export interface MachineConfig {
  monitoringEnabled: boolean;
  hasBaseline: boolean;
  roi: RoiPolygon | null;
}

export interface StateInfo {
  since: number;
  personEnteredAt: number | null;
  queued: boolean;
}

export interface AnalysisRequest {
  after: Buffer;
  personEnteredAt: number;
  personLeftAt: number;
}

export interface MachineDeps {
  detector: PersonDetector;
  /** Fração de pixels diferentes na ROI entre dois frames. */
  diff: (a: Buffer, b: Buffer, roi: RoiPolygon | null) => Promise<number>;
  now: () => number;
  onState: (state: MachineState, info: StateInfo) => void;
  /** Comparação antes/depois (seção 8.5). Ao terminar, o after deve virar o baseline. */
  analyze: (req: AnalysisRequest) => Promise<void>;
  /** Pessoa ficou tempo demais na frente da prateleira. */
  occlusionTimeout: (req: { personEnteredAt: number }) => Promise<void>;
  log: FastifyBaseLogger;
}

/**
 * Máquina de estados por câmera (seção 8.4):
 * DISABLED → NO_BASELINE → IDLE → OCCUPIED → WAITING_CLEAR → WAITING_STABLE → ANALYZING → IDLE
 *
 * `processFrame` deve ser chamado sequencialmente (um frame por vez). A análise
 * roda em background; frames recebidos durante ANALYZING só enfileiram a próxima ocupação.
 */
export class CameraStateMachine {
  private _state: MachineState = 'DISABLED';
  private cfg: MachineConfig = { monitoringEnabled: false, hasBaseline: false, roi: null };

  private streak = 0;
  private streakStart = 0;
  private enteredAt: number | null = null;
  private clearSince = 0;
  private stableStart = 0;
  private stableSince: number | null = null;
  private prevJpeg: Buffer | null = null;
  private prevTs = 0;
  private occlusionReported = false;
  private queuedStreak = 0;
  private queuedStart = 0;
  private queued = false;
  private analysis: Promise<void> | null = null;

  constructor(
    private params: MachineParams,
    private readonly deps: MachineDeps,
  ) {}

  /** Atualiza os parâmetros (configurações da câmera) sem perder o estado atual. */
  setParams(params: MachineParams) {
    this.params = params;
  }

  get state(): MachineState {
    return this._state;
  }

  /** Promise da análise em andamento (útil em testes). */
  get pendingAnalysis(): Promise<void> | null {
    return this.analysis;
  }

  configure(cfg: MachineConfig) {
    this.cfg = cfg;
    if (this._state === 'ANALYZING') return; // reavaliado ao fim da análise
    const base = this.baseState();
    if (base !== 'IDLE') {
      if (this._state !== base) this.setState(base);
    } else if (this._state === 'DISABLED' || this._state === 'NO_BASELINE') {
      this.setState('IDLE');
    }
  }

  /** Reemite o estado atual (ex.: ao (re)conectar a câmera). */
  announce() {
    this.deps.onState(this._state, this.info(this.deps.now()));
  }

  private baseState(): MachineState {
    if (!this.cfg.monitoringEnabled) return 'DISABLED';
    if (!this.cfg.hasBaseline) return 'NO_BASELINE';
    return 'IDLE';
  }

  private info(since: number): StateInfo {
    return { since, personEnteredAt: this.enteredAt, queued: this.queued };
  }

  private setState(state: MachineState, at = this.deps.now()) {
    this._state = state;
    if (state === 'IDLE' || state === 'DISABLED' || state === 'NO_BASELINE') {
      this.enteredAt = null;
      this.streak = 0;
      this.occlusionReported = false;
      this.prevJpeg = null;
    }
    this.deps.onState(state, this.info(at));
  }

  async processFrame(jpeg: Buffer): Promise<void> {
    const s = this._state;
    if (s === 'DISABLED' || s === 'NO_BASELINE') return;

    const t = this.deps.now();
    const dets = await this.deps.detector.detect(jpeg);
    const occupied = dets.some(
      (d) =>
        d.confidence >= this.params.personConfidence &&
        bboxRoiOverlap(d.bbox, this.cfg.roi) >= this.params.overlapMin,
    );
    // O estado pode ter mudado enquanto o detector rodava (ex.: monitoramento desligado).
    if (this._state !== s) return;

    switch (s) {
      case 'IDLE': {
        if (!occupied) {
          this.streak = 0;
          break;
        }
        if (this.streak === 0) this.streakStart = t;
        this.streak++;
        if (this.streak >= this.params.enterFrames) this.enterOccupied(this.streakStart, t);
        break;
      }
      case 'OCCUPIED': {
        if (occupied) {
          if (
            !this.occlusionReported &&
            this.enteredAt !== null &&
            t - this.enteredAt >= this.params.maxOcclusionMs
          ) {
            this.occlusionReported = true;
            const personEnteredAt = this.enteredAt;
            this.deps
              .occlusionTimeout({ personEnteredAt })
              .catch((err: unknown) =>
                this.deps.log.warn({ err }, 'Falha ao registrar oclusão prolongada'),
              );
          }
        } else {
          this.clearSince = t;
          this.setState('WAITING_CLEAR', t);
        }
        break;
      }
      case 'WAITING_CLEAR': {
        if (occupied) {
          this.setState('OCCUPIED', t);
        } else if (t - this.clearSince >= this.params.clearMs) {
          this.stableStart = t;
          this.stableSince = null;
          this.prevJpeg = jpeg;
          this.prevTs = t;
          this.setState('WAITING_STABLE', t);
        }
        break;
      }
      case 'WAITING_STABLE': {
        if (occupied) {
          this.setState('OCCUPIED', t);
          break;
        }
        const prev = this.prevJpeg;
        const prevTs = this.prevTs;
        this.prevJpeg = jpeg;
        this.prevTs = t;
        if (prev) {
          const d = await this.deps.diff(prev, jpeg, this.cfg.roi);
          if (d < this.params.stableDiffMax) this.stableSince ??= prevTs;
          else this.stableSince = null;
        }
        const stable = this.stableSince !== null && t - this.stableSince >= this.params.stableMs;
        const timedOut = t - this.stableStart >= this.params.stableMaxWaitMs;
        if (stable || timedOut) {
          if (timedOut && !stable)
            this.deps.log.warn('Cena não estabilizou; capturando assim mesmo');
          this.startAnalysis(jpeg, t);
        }
        break;
      }
      case 'ANALYZING': {
        if (this.queued) break;
        if (!occupied) {
          this.queuedStreak = 0;
          break;
        }
        if (this.queuedStreak === 0) this.queuedStart = t;
        this.queuedStreak++;
        if (this.queuedStreak >= this.params.enterFrames) {
          this.queued = true;
          this.deps.onState('ANALYZING', this.info(t));
        }
        break;
      }
    }
  }

  private enterOccupied(enteredAt: number, t: number) {
    this.enteredAt = enteredAt;
    this.occlusionReported = false;
    this.setState('OCCUPIED', t);
  }

  private startAnalysis(after: Buffer, t: number) {
    const personEnteredAt = this.enteredAt ?? this.clearSince;
    const personLeftAt = this.clearSince;
    this.queued = false;
    this.queuedStreak = 0;
    this.setState('ANALYZING', t);
    this.analysis = this.deps
      .analyze({ after, personEnteredAt, personLeftAt })
      .catch((err: unknown) => this.deps.log.error({ err }, 'Falha na análise'))
      .finally(() => this.finishAnalysis());
  }

  private finishAnalysis() {
    this.analysis = null;
    const base = this.baseState();
    const queued = this.queued;
    const queuedStart = this.queuedStart;
    this.queued = false;
    this.queuedStreak = 0;
    this.enteredAt = null;
    if (base !== 'IDLE') {
      this.setState(base);
    } else if (queued) {
      // A pessoa chegou durante a análise: a ocupação começa agora, com o novo baseline.
      this.enterOccupied(queuedStart, this.deps.now());
    } else {
      this.setState('IDLE');
    }
  }
}
