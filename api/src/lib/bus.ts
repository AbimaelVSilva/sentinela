import { EventEmitter } from 'node:events';
import type { CameraStatus } from '../db/schema';
import type { EventDto } from '../modules/events/serializer';

export type WorkerState =
  | 'OFFLINE'
  | 'DISABLED'
  | 'NO_BASELINE'
  | 'IDLE'
  | 'OCCUPIED'
  | 'WAITING_CLEAR'
  | 'WAITING_STABLE'
  | 'ANALYZING';

export type CalibrationStage = 'capturing' | 'validating' | 'inventorying' | 'done' | 'failed';

export interface StreamInfo {
  ready: boolean;
  codecs: string[];
  videoCodec: string | null;
  isH265: boolean;
  readers: number;
}

export interface BusEvents {
  /** Status de conexão da câmera (pending/online/offline). Público via SSE. */
  'camera.status': {
    cameraId: string;
    status: CameraStatus;
    lastSeenAt: string | null;
    stream: StreamInfo | null;
  };
  /** Estado da máquina de estados do worker. Público via SSE. */
  'camera.state': {
    cameraId: string;
    state: WorkerState;
    since: string;
    personEnteredAt?: string | null;
    queued?: boolean;
  };
  /** Progresso da calibração. Público via SSE. */
  'camera.calibration': {
    cameraId: string;
    stage: CalibrationStage;
    message?: string;
    sceneValidation?: unknown;
    inventory?: unknown;
    error?: string;
  };
  /** Novo evento classificado. Público via SSE. */
  'event.created': { cameraId: string; event: EventDto };
  /** Evento existente atualizado (ex.: vídeo da passagem ficou pronto). Público via SSE. */
  'event.updated': { cameraId: string; event: EventDto };
  /** Interno: configuração da câmera mudou (ROI, monitoramento, baseline, key). */
  'camera.updated': { cameraId: string };
  /** Interno: câmera removida. */
  'camera.deleted': { cameraId: string; streamKey: string };
}

export type BusEventName = keyof BusEvents;
export const PUBLIC_EVENTS = [
  'camera.status',
  'camera.state',
  'camera.calibration',
  'event.created',
  'event.updated',
] as const satisfies readonly BusEventName[];

class TypedBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  emit<K extends BusEventName>(name: K, payload: BusEvents[K]): void {
    this.emitter.emit(name, payload);
  }

  on<K extends BusEventName>(name: K, fn: (payload: BusEvents[K]) => void): () => void {
    this.emitter.on(name, fn);
    return () => this.emitter.off(name, fn);
  }
}

export const bus = new TypedBus();
