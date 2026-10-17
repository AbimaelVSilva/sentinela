import { useQuery } from '@tanstack/react-query';
import { FilmIcon, ImageOffIcon, LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { EventIcon } from '@/components/EventIcon';
import { RoiOverlay } from '@/components/RoiOverlay';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  api,
  type Change,
  fileUrl,
  type Point,
  queryKeys,
  type Region,
  type SentinelaEvent,
  type Snapshot,
} from '@/lib/api';
import { SEVERITY_CLASSES, formatDuration, formatTime } from '@/lib/labels';
import { cn } from '@/lib/utils';

const CHANGE_STYLE: Record<
  Change['change'],
  { label: string; stroke: string; fill: string; badge: string }
> = {
  removed: {
    label: 'Retirado',
    stroke: 'stroke-severity-alert',
    fill: 'fill-severity-alert/15',
    badge: 'bg-severity-alert text-white',
  },
  moved: {
    label: 'Movido',
    stroke: 'stroke-severity-attention',
    fill: 'fill-severity-attention/15',
    badge: 'bg-severity-attention text-white',
  },
  added: {
    label: 'Adicionado',
    stroke: 'stroke-success',
    fill: 'fill-success/15',
    badge: 'bg-success text-white',
  },
};

const REASON_TEXT: Record<string, string> = {
  below_diff_threshold:
    'Pré-filtro: a diferença na prateleira ficou abaixo do limiar — a IA não foi chamada.',
  occlusion_timeout:
    'A prateleira ficou encoberta por tempo demais; a análise segue quando a pessoa sair.',
};

export function EventDetailDialog({
  event,
  onOpenChange,
}: {
  event: SentinelaEvent | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94svh] overflow-y-auto sm:max-w-5xl">
        {event && <Detail initial={event} />}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ initial }: { initial: SentinelaEvent }) {
  const { data: event } = useQuery({
    queryKey: queryKeys.event(initial.id),
    queryFn: () => api.getEvent(initial.id),
    initialData: initial,
    staleTime: 60_000,
  });
  const sev = SEVERITY_CLASSES[event.severity];
  const details = event.details;
  const changes = details?.comparison?.changes ?? [];
  const roi = details?.roi ?? null;
  const usage = details?.usage;

  return (
    <>
      <DialogHeader>
        <DialogTitle className={cn('flex items-center gap-2', sev.text)}>
          <span
            className={cn(
              'flex size-7 items-center justify-center rounded-full text-white',
              sev.dot,
            )}
          >
            <EventIcon type={event.type} className="size-4" />
          </span>
          {event.label}
        </DialogTitle>
        <DialogDescription>
          {formatTime(event.createdAt)} · ocupação de {formatDuration(event.durationSeconds)}
          {event.personEnteredAt && <> · entrou {formatTime(event.personEnteredAt)}</>}
          {event.personLeftAt && <> · saiu {formatTime(event.personLeftAt)}</>}
        </DialogDescription>
      </DialogHeader>

      <p className={cn('rounded-lg border-l-4 px-3 py-2 text-sm', sev.border, sev.bg)}>
        {event.summary}
      </p>

      <ClipView event={event} />

      <div className="grid gap-3 md:grid-cols-2">
        <SnapshotView
          title="Antes"
          snapshot={event.before}
          roi={roi}
          changes={changes}
          side="before"
        />
        <SnapshotView
          title="Depois"
          snapshot={event.after}
          roi={roi}
          changes={changes}
          side="after"
        />
      </div>

      {changes.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Mudanças detectadas</h3>
          <ul className="divide-y rounded-lg border">
            {changes.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <Badge className={CHANGE_STYLE[c.change].badge}>
                  {CHANGE_STYLE[c.change].label}
                </Badge>
                <span className="font-medium">{c.label}</span>
                {c.quantity > 1 && <span className="text-muted-foreground">×{c.quantity}</span>}
                {c.itemId && (
                  <span className="font-mono text-xs text-muted-foreground">{c.itemId}</span>
                )}
                <ConfidenceBar value={c.confidence} className="ml-auto" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {details?.reason && REASON_TEXT[details.reason] && (
        <p className="text-sm text-muted-foreground">{REASON_TEXT[details.reason]}</p>
      )}
      {details?.error && (
        <p className="rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          {details.error}
        </p>
      )}

      <Separator />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        <Meta label="Diferença na prateleira">
          {event.sceneDiffScore != null ? `${(event.sceneDiffScore * 100).toFixed(2)}%` : '—'}
        </Meta>
        <Meta label="Confiança geral">
          {details?.comparison ? `${Math.round(details.comparison.overallConfidence * 100)}%` : '—'}
        </Meta>
        <Meta label="Tokens (entrada/saída)">
          {usage ? `${usage.inputTokens} / ${usage.outputTokens}` : '—'}
        </Meta>
        <Meta label="Custo estimado">
          {usage?.estimatedCostUsd != null ? `US$ ${usage.estimatedCostUsd.toFixed(4)}` : '—'}
        </Meta>
      </dl>
    </>
  );
}

/** Tempo em que ainda faz sentido esperar o vídeo ficar pronto. */
const CLIP_PENDING_MS = 3 * 60_000;

function ClipView({ event }: { event: SentinelaEvent }) {
  // Momento em que o detalhe foi aberto (estável entre renders).
  const [openedAt] = useState(() => Date.now());
  // Oclusão prolongada não gera vídeo (a pessoa ainda não saiu).
  if (event.details?.reason === 'occlusion_timeout') return null;
  if (event.clip) {
    return (
      <figure className="space-y-1.5">
        <figcaption className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <FilmIcon className="size-3.5" /> Vídeo da passagem
          {event.clip.durationSeconds != null && (
            <span className="font-normal normal-case">
              {Math.round(event.clip.durationSeconds)} s
            </span>
          )}
        </figcaption>
        <video
          key={event.clip.url}
          src={fileUrl(event.clip.url)}
          className="aspect-video max-h-[45svh] w-full rounded-lg bg-black object-contain"
          controls
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      </figure>
    );
  }
  const recent = openedAt - new Date(event.createdAt).getTime() < CLIP_PENDING_MS;
  if (!recent) return null;
  return (
    <div className="flex aspect-[32/9] w-full items-center justify-center gap-2 rounded-lg bg-muted text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" /> Gerando o vídeo da passagem…
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="font-medium text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

function ConfidenceBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  return (
    <span className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            'block h-full rounded-full',
            pct < 50 ? 'bg-severity-attention' : 'bg-success',
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      {pct}%
    </span>
  );
}

function SnapshotView({
  title,
  snapshot,
  roi,
  changes,
  side,
}: {
  title: string;
  snapshot: Snapshot | null;
  roi: Point[] | null;
  changes: Change[];
  side: 'before' | 'after';
}) {
  const regions = changes
    .map((c) => ({ c, r: side === 'before' ? c.beforeRegion : c.afterRegion }))
    .filter((x): x is { c: Change; r: Region } => !!x.r);

  return (
    <figure className="space-y-1.5">
      <figcaption className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
        {snapshot && (
          <span className="ml-2 font-normal normal-case">{formatTime(snapshot.capturedAt)}</span>
        )}
      </figcaption>
      <div
        className="relative overflow-hidden rounded-lg bg-muted"
        style={{ aspectRatio: snapshot ? `${snapshot.width} / ${snapshot.height}` : '16 / 9' }}
      >
        {snapshot ? (
          <>
            <img
              src={fileUrl(snapshot.url)}
              alt={`Prateleira ${title.toLowerCase()}`}
              className="size-full"
            />
            <RoiOverlay roi={roi} className="opacity-60" />
            <svg
              className="absolute inset-0 size-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {regions.map(({ c, r }, i) => (
                <rect
                  key={i}
                  x={r.x * 100}
                  y={r.y * 100}
                  width={r.w * 100}
                  height={r.h * 100}
                  rx={0.8}
                  className={cn(CHANGE_STYLE[c.change].stroke, CHANGE_STYLE[c.change].fill)}
                  style={{ strokeWidth: 3 }}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <ImageOffIcon className="size-5" /> Sem imagem
          </div>
        )}
      </div>
    </figure>
  );
}
