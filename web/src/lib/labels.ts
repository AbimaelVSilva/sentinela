import type { CameraStatus, EventType, Severity, WorkerState } from './api';

export const CAMERA_STATUS_LABEL: Record<CameraStatus, string> = {
  pending: 'Aguardando sinal',
  online: 'Online',
  offline: 'Offline',
};

export const WORKER_STATE_LABEL: Record<WorkerState, string> = {
  OFFLINE: 'Sem sinal',
  DISABLED: 'Monitoramento desligado',
  NO_BASELINE: 'Prateleira não memorizada',
  IDLE: 'Monitorando',
  OCCUPIED: 'Pessoa na prateleira…',
  WAITING_CLEAR: 'Aguardando saída…',
  WAITING_STABLE: 'Aguardando cena estabilizar…',
  ANALYZING: 'Analisando…',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  removed: 'Alerta: produto retirado',
  moved: 'Atenção: produto movido',
  no_change: 'Movimentação humana sem alteração',
  analysis_failed: 'Falha na análise',
};

export const EVENT_TYPE_SHORT: Record<EventType, string> = {
  removed: 'Retirado',
  moved: 'Movido',
  no_change: 'Sem alteração',
  analysis_failed: 'Falha',
};

export const SEVERITY_OF: Record<EventType, Severity> = {
  removed: 'alert',
  moved: 'attention',
  no_change: 'info',
  analysis_failed: 'error',
};

/** Classes Tailwind por severidade (tokens `severity-*`). */
export const SEVERITY_CLASSES: Record<
  Severity,
  { dot: string; text: string; border: string; bg: string; ring: string }
> = {
  alert: {
    dot: 'bg-severity-alert',
    text: 'text-severity-alert',
    border: 'border-severity-alert',
    bg: 'bg-severity-alert/10',
    ring: 'ring-severity-alert/40',
  },
  attention: {
    dot: 'bg-severity-attention',
    text: 'text-severity-attention',
    border: 'border-severity-attention',
    bg: 'bg-severity-attention/10',
    ring: 'ring-severity-attention/40',
  },
  info: {
    dot: 'bg-severity-info',
    text: 'text-severity-info',
    border: 'border-severity-info',
    bg: 'bg-severity-info/10',
    ring: 'ring-severity-info/40',
  },
  error: {
    dot: 'bg-severity-error',
    text: 'text-severity-error',
    border: 'border-severity-error',
    bg: 'bg-severity-error/15',
    ring: 'ring-severity-error/40',
  },
};

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}min ${s}s` : `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? timeFmt.format(d) : dateTimeFmt.format(d);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 10) return 'agora';
  if (diff < 60) return `há ${Math.round(diff)}s`;
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  return `há ${Math.round(diff / 86400)} d`;
}
