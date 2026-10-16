import { Badge } from '@/components/ui/badge';
import type { CameraStatus, Severity, WorkerState } from '@/lib/api';
import { CAMERA_STATUS_LABEL, SEVERITY_CLASSES, WORKER_STATE_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

export function CameraStatusBadge({
  status,
  className,
}: {
  status: CameraStatus | null | undefined;
  className?: string;
}) {
  if (!status) {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground', className)}>
        Sem câmera
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 bg-background/70 backdrop-blur',
        status === 'online' && 'border-success/50 text-success',
        status === 'offline' && 'border-severity-alert/50 text-severity-alert',
        status === 'pending' && 'text-muted-foreground',
        className,
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'online' && 'animate-pulse bg-success',
          status === 'offline' && 'bg-severity-alert',
          status === 'pending' && 'bg-muted-foreground',
        )}
      />
      {CAMERA_STATUS_LABEL[status]}
    </Badge>
  );
}

const ACTIVE_STATES: WorkerState[] = ['OCCUPIED', 'WAITING_CLEAR', 'WAITING_STABLE', 'ANALYZING'];

export function WorkerStateBadge({ state, className }: { state: WorkerState; className?: string }) {
  const active = ACTIVE_STATES.includes(state);
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 bg-background/70 backdrop-blur',
        active && 'border-severity-attention/60 text-severity-attention',
        state === 'IDLE' && 'border-severity-info/60 text-severity-info',
        (state === 'DISABLED' || state === 'OFFLINE' || state === 'NO_BASELINE') &&
          'text-muted-foreground',
        className,
      )}
    >
      {active && <span className="size-1.5 animate-ping rounded-full bg-severity-attention" />}
      {WORKER_STATE_LABEL[state]}
    </Badge>
  );
}

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2 rounded-full', SEVERITY_CLASSES[severity].dot, className)}
    />
  );
}
