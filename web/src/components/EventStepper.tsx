import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FilmIcon,
  HistoryIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { EventDetailDialog } from '@/components/EventDetailDialog';
import { EventIcon } from '@/components/EventIcon';
import { QueryError } from '@/components/QueryError';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, type EventType, queryKeys, type SentinelaEvent } from '@/lib/api';
import {
  EVENT_TYPE_LABEL,
  EVENT_TYPE_SHORT,
  SEVERITY_CLASSES,
  SEVERITY_OF,
  formatDuration,
  formatClock,
} from '@/lib/labels';
import { cn } from '@/lib/utils';
import { dayLabel, dayRange, msUntilMidnight, startOfDay } from '@/lib/days';

const TYPES: EventType[] = ['removed', 'moved', 'no_change', 'analysis_failed'];

/** Timeline vertical de eventos da câmera (mais recentes no topo), com scroll infinito. */
export function EventStepper({ cameraId, since }: { cameraId: string; since?: string }) {
  const [types, setTypes] = useState<EventType[]>([]);
  const [selected, setSelected] = useState<SentinelaEvent | null>(null);
  // Dia exibido: 0 = hoje, 1 = ontem, ... A referência de "hoje" vira à meia-noite.
  const [offset, setOffset] = useState(0);
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const t = setTimeout(() => setToday(new Date()), msUntilMidnight(today) + 1000);
    return () => clearTimeout(t);
  }, [today]);
  const { from, to } = dayRange(today, offset);
  const label = dayLabel(today, offset);
  // Não volta para antes do dia em que a câmera foi cadastrada.
  const canGoBack = !since || from.getTime() > startOfDay(new Date(since)).getTime();

  const query = useInfiniteQuery({
    queryKey: [
      ...queryKeys.events(cameraId),
      { types, from: from.toISOString(), to: to.toISOString() },
    ],
    queryFn: ({ pageParam }) => api.listEvents(cameraId, { cursor: pageParam, types, from, to }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  // Eventos que chegam (via SSE) depois do primeiro carregamento ganham animação de entrada.
  const filterKey = `${types.join(',')}|${from.toISOString()}`;
  const [initial, setInitial] = useState<{ key: string; at: number } | null>(null);
  if (query.isSuccess && initial?.key !== filterKey) {
    setInitial({ key: filterKey, at: query.dataUpdatedAt });
  }
  const isFresh = (e: SentinelaEvent) => !!initial && new Date(e.createdAt).getTime() > initial.at;

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" />
          <h2 className="font-semibold">Eventos</h2>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dia anterior"
            disabled={!canGoBack}
            onClick={() => setOffset((o) => o + 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <button
            type="button"
            className="flex min-w-0 flex-1 flex-col items-center rounded-md px-2 py-0.5 text-center enabled:hover:bg-accent disabled:cursor-default"
            onClick={() => setOffset(0)}
            disabled={offset === 0}
            title={offset === 0 ? undefined : 'Voltar para hoje'}
            aria-live="polite"
          >
            <span className="text-sm font-medium">{label.title}</span>
            <span className="truncate text-xs text-muted-foreground">{label.subtitle}</span>
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Próximo dia"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={types}
          onValueChange={(v) => setTypes(v as EventType[])}
          className="grid w-full grid-cols-2"
          aria-label="Filtrar por tipo"
        >
          {TYPES.map((t) => (
            <Tooltip key={t}>
              <TooltipTrigger asChild>
                <ToggleGroupItem value={t} className="flex-1 gap-1.5 text-xs">
                  <span
                    className={cn('size-2 rounded-full', SEVERITY_CLASSES[SEVERITY_OF[t]].dot)}
                  />
                  {EVENT_TYPE_SHORT[t]}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{EVENT_TYPE_LABEL[t]}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {query.isPending ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : query.isError ? (
            <QueryError error={query.error} onRetry={() => void query.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={HistoryIcon}
              title={
                types.length
                  ? 'Nenhum evento com esse filtro'
                  : offset === 0
                    ? 'Nenhum evento hoje'
                    : 'Nenhum evento neste dia'
              }
              description={
                types.length
                  ? 'Ajuste o filtro para ver outros tipos.'
                  : offset === 0
                    ? 'Quando alguém passar na frente da prateleira, o resultado aparece aqui em tempo real.'
                    : 'Use as setas para ver outros dias.'
              }
              className="border-none py-10"
            />
          ) : (
            <ol className="relative">
              {items.map((e, i) => (
                <StepItem
                  key={e.id}
                  event={e}
                  last={i === items.length - 1}
                  fresh={isFresh(e)}
                  onClick={() => setSelected(e)}
                />
              ))}
            </ol>
          )}
          <div ref={sentinel} className="h-4" />
          {isFetchingNextPage && (
            <p className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin" /> Carregando mais…
            </p>
          )}
          {!hasNextPage && items.length > 10 && (
            <p className="py-2 text-center text-xs text-muted-foreground">Fim do histórico</p>
          )}
        </div>
      </ScrollArea>

      <EventDetailDialog event={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

function StepItem({
  event,
  last,
  fresh,
  onClick,
}: {
  event: SentinelaEvent;
  last: boolean;
  fresh: boolean;
  onClick: () => void;
}) {
  const sev = SEVERITY_CLASSES[event.severity];
  return (
    <li
      className={cn(
        'relative flex gap-3 pb-5',
        fresh && 'animate-in duration-500 fade-in-0 slide-in-from-top-2',
      )}
    >
      {!last && <span className="absolute top-9 bottom-0 left-4 w-px -translate-x-1/2 bg-border" />}
      <span
        className={cn(
          'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background',
          sev.dot,
          'text-white',
        )}
      >
        <EventIcon type={event.type} className="size-4" />
      </span>
      <button
        type="button"
        onClick={onClick}
        className="-mt-0.5 min-w-0 flex-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm font-medium', sev.text)}>{event.label}</span>
          <time className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatClock(event.createdAt)}
          </time>
        </div>
        <p className="truncate text-sm text-muted-foreground">{event.summary}</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          Ocupação: {formatDuration(event.durationSeconds)}
          {event.clip && (
            <span className="inline-flex items-center gap-1" title="Tem vídeo da passagem">
              <FilmIcon className="size-3" /> vídeo
            </span>
          )}
        </p>
      </button>
    </li>
  );
}
