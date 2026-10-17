import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { getToken, onTokenChange } from './auth-token';
import { toast } from 'sonner';
import {
  API_URL,
  type CalibrationStage,
  type Camera,
  type CameraStatus,
  type EventsPage,
  type Inventory,
  type SceneValidation,
  type SentinelaEvent,
  type StreamInfo,
  type WorkerState,
  queryKeys,
} from './api';

export interface CameraStatusMsg {
  cameraId: string;
  status: CameraStatus;
  lastSeenAt: string | null;
  stream: StreamInfo | null;
}
export interface CameraStateMsg {
  cameraId: string;
  state: WorkerState;
  since: string;
  personEnteredAt?: string | null;
  queued?: boolean;
}
export interface CalibrationMsg {
  cameraId: string;
  stage: CalibrationStage;
  message?: string;
  sceneValidation?: SceneValidation;
  inventory?: Inventory;
  error?: string;
}
export interface EventCreatedMsg {
  cameraId: string;
  event: SentinelaEvent;
}

function patchCamera(qc: QueryClient, cameraId: string, patch: (c: Camera) => Camera) {
  qc.setQueryData<Camera>(queryKeys.camera(cameraId), (old) => (old ? patch(old) : old));
}

function handleStatus(qc: QueryClient, msg: CameraStatusMsg) {
  patchCamera(qc, msg.cameraId, (c) => ({
    ...c,
    status: msg.status,
    lastSeenAt: msg.lastSeenAt,
    stream: msg.stream,
  }));
  void qc.invalidateQueries({ queryKey: queryKeys.stores });
}

function handleState(qc: QueryClient, msg: CameraStateMsg) {
  patchCamera(qc, msg.cameraId, (c) => ({
    ...c,
    worker: { state: msg.state, since: msg.since, queued: msg.queued },
  }));
}

function handleCalibration(qc: QueryClient, msg: CalibrationMsg) {
  qc.setQueryData(queryKeys.calibration(msg.cameraId), msg);
  if (msg.stage === 'done' || msg.stage === 'failed') {
    void qc.invalidateQueries({ queryKey: queryKeys.camera(msg.cameraId), exact: true });
  }
}

function handleEvent(qc: QueryClient, msg: EventCreatedMsg, notify: boolean) {
  const { event } = msg;
  // A lista pode estar em cache com filtros diferentes: ['cameras', id, 'events', { types }].
  for (const q of qc.getQueryCache().findAll({ queryKey: queryKeys.events(msg.cameraId) })) {
    const filter = q.queryKey[3] as { types?: string[] } | undefined;
    if (filter?.types?.length && !filter.types.includes(event.type)) continue;
    qc.setQueryData<InfiniteData<EventsPage>>(q.queryKey, (old) => {
      if (!old || old.pages.length === 0) return old;
      if (old.pages.some((p) => p.items.some((e) => e.id === event.id))) return old;
      const [first, ...rest] = old.pages;
      return { ...old, pages: [{ ...first!, items: [event, ...first!.items] }, ...rest] };
    });
  }
  void qc.invalidateQueries({ queryKey: queryKeys.stores });
  void qc.invalidateQueries({ queryKey: queryKeys.camera(msg.cameraId), exact: true });

  if (!notify) return;
  if (event.severity === 'alert') {
    toast.error(event.label, { description: event.summary, className: 'toast-severity-alert' });
  } else if (event.severity === 'attention') {
    toast.warning(event.label, {
      description: event.summary,
      className: 'toast-severity-attention',
    });
  }
}

/**
 * Conecta ao SSE da API e mantém o cache do TanStack Query atualizado.
 * O EventSource já reconecta sozinho; se o navegador desistir (CLOSED),
 * recriamos a conexão com backoff.
 */
export function useSSE(cameraId?: string, opts: { notify?: boolean } = {}) {
  const qc = useQueryClient();
  const notify = opts.notify ?? true;
  // Reconecta quando o token muda (login/logout); sem token não conecta.
  const token = useSyncExternalStore(onTokenChange, getToken);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const parse = <T>(e: MessageEvent<string>): T | null => {
      try {
        return JSON.parse(e.data) as T;
      } catch {
        return null;
      }
    };

    if (!token) return;

    const connect = () => {
      const url = new URL(`${API_URL}/stream`);
      if (cameraId) url.searchParams.set('cameraId', cameraId);
      url.searchParams.set('token', token);
      es = new EventSource(url);

      es.onopen = () => {
        if (attempt > 0) {
          // Reconectou: o que perdemos enquanto offline é buscado de novo.
          void qc.invalidateQueries();
        }
        attempt = 0;
      };
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED && !disposed) {
          es.close();
          const delay = Math.min(30_000, 1000 * 2 ** attempt++);
          retry = setTimeout(connect, delay);
        }
      };
      es.addEventListener('camera.status', (e) => {
        const msg = parse<CameraStatusMsg>(e);
        if (msg) handleStatus(qc, msg);
      });
      es.addEventListener('camera.state', (e) => {
        const msg = parse<CameraStateMsg>(e);
        if (msg) handleState(qc, msg);
      });
      es.addEventListener('camera.calibration', (e) => {
        const msg = parse<CalibrationMsg>(e);
        if (msg) handleCalibration(qc, msg);
      });
      es.addEventListener('event.created', (e) => {
        const msg = parse<EventCreatedMsg>(e);
        if (msg) handleEvent(qc, msg, notify);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [cameraId, qc, notify, token]);
}
