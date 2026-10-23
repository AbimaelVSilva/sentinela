import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { BellIcon, LoaderCircleIcon, ShoppingCartIcon, VideoIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState } from '@/components/EmptyState';
import { EventDetailDialog } from '@/components/EventDetailDialog';
import { EventIcon } from '@/components/EventIcon';
import { QueryError } from '@/components/QueryError';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type AlertFilters, type AlertItem, api, queryKeys, type SentinelaEvent } from '@/lib/api';
import { addDays, dayLabel, startOfDay } from '@/lib/days';
import { SEVERITY_CLASSES, formatClock } from '@/lib/labels';
import { cn } from '@/lib/utils';

const PERIODS = {
  hoje: { label: 'Hoje', days: 1 },
  '7d': { label: '7 dias', days: 7 },
  '30d': { label: '30 dias', days: 30 },
  tudo: { label: 'Tudo', days: null },
} as const;
type Period = keyof typeof PERIODS;

const SEVERITIES = {
  todos: { label: 'Todos', value: undefined },
  vermelhos: { label: 'Vermelhos', value: 'alert' },
  laranjas: { label: 'Laranjas', value: 'attention' },
} as const;
type SeverityKey = keyof typeof SEVERITIES;

const ALL_STORES = 'todas';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Tela de alertas: todos os alertas (vermelhos e laranjas) das lojas, com filtros por
 * período, cor e loja (guardados na URL), contagem por cor e detalhe da ocorrência.
 */
export function AlertsPage() {
  const [params, setParams] = useSearchParams();
  const period = (params.get('periodo') as Period | null) ?? 'hoje';
  const sevKey = (params.get('cor') as SeverityKey | null) ?? 'todos';
  const storeId = params.get('loja') ?? ALL_STORES;
  const [open, setOpen] = useState<SentinelaEvent | null>(null);

  const setParam = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  // O início do período é fixado por dia, para a chave da consulta não mudar a cada render.
  const today = startOfDay(new Date()).getTime();
  const filters = useMemo<AlertFilters>(() => {
    // Valor desconhecido na URL cai em "hoje"; "tudo" (null) não tem início.
    const days = period in PERIODS ? PERIODS[period].days : 1;
    return {
      severity: SEVERITIES[sevKey]?.value,
      storeId: storeId === ALL_STORES ? undefined : storeId,
      from: days ? addDays(new Date(today), -(days - 1)).toISOString() : undefined,
    };
  }, [period, sevKey, storeId, today]);

  const stores = useQuery({ queryKey: queryKeys.stores, queryFn: api.listStores });
  const q = useInfiniteQuery({
    queryKey: queryKeys.alertsPage(filters),
    queryFn: ({ pageParam }) => api.listAlertsPage(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = q.data?.pages[0]?.counts;
  const groups = groupByDay(items);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Alertas</h1>
        <p className="text-sm text-muted-foreground">
          Vermelho: retirada sem compra. Laranja: passagem com compra no totem ou produto movido.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={period}
          onValueChange={(v) => v && setParam('periodo', v, 'hoje')}
          aria-label="Período"
        >
          {(Object.keys(PERIODS) as Period[]).map((k) => (
            <ToggleGroupItem key={k} value={k}>
              {PERIODS[k].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select value={storeId} onValueChange={(v) => setParam('loja', v, ALL_STORES)}>
          <SelectTrigger size="sm" className="w-48" aria-label="Loja">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL_STORES}>Todas as lojas</SelectItem>
            {[...(stores.data ?? [])]
              .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
              .map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Cor do alerta">
        {(Object.keys(SEVERITIES) as SeverityKey[]).map((k) => {
          const n =
            k === 'todos'
              ? counts && counts.alert + counts.attention
              : counts?.[SEVERITIES[k].value];
          const active = sevKey === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setParam('cor', k, 'todos')}
              className={cn(
                'flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent/50',
                active && 'border-foreground/40 bg-accent/40 ring-1 ring-foreground/20',
              )}
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {k !== 'todos' && (
                  <span
                    className={cn('size-2 rounded-full', SEVERITY_CLASSES[SEVERITIES[k].value].dot)}
                  />
                )}
                {SEVERITIES[k].label}
              </span>
              <span className="text-2xl font-semibold tabular-nums">{n ?? '—'}</span>
            </button>
          );
        })}
      </div>

      {q.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellIcon}
          title="Nenhum alerta"
          description="Não há alertas com esses filtros. Experimente um período maior."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-sm font-medium">
                {g.title}{' '}
                <span className="font-normal text-muted-foreground">
                  {g.subtitle} · {g.items.length}
                </span>
              </h2>
              <ul className="divide-y rounded-lg border">
                {g.items.map((a) => (
                  <AlertRow key={a.event.id} alert={a} onOpen={() => setOpen(a.event)} />
                ))}
              </ul>
            </section>
          ))}
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
              >
                {q.isFetchingNextPage && <LoaderCircleIcon className="animate-spin" />} Carregar
                mais
              </Button>
            </div>
          )}
        </div>
      )}

      <EventDetailDialog event={open} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}

function AlertRow({ alert: a, onOpen }: { alert: AlertItem; onOpen: () => void }) {
  const ev = a.event;
  const sev = SEVERITY_CLASSES[ev.severity];
  const orders = ev.purchase?.status === 'found' ? ev.purchase.orders : [];
  return (
    <li className="flex gap-3 px-3 py-3">
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-white',
          sev.dot,
        )}
      >
        <EventIcon type={ev.type} className="size-4" />
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm font-medium', sev.text)}>{ev.label}</span>
          <time className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatClock(ev.createdAt)}
          </time>
        </div>
        <p className="truncate text-sm font-medium">
          {a.storeName} <span className="font-normal text-muted-foreground">· {a.cameraName}</span>
        </p>
        <p className="truncate text-sm text-muted-foreground">{ev.summary}</p>
        {orders.length > 0 && (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-severity-attention">
            <ShoppingCartIcon className="size-3 shrink-0" />
            <span className="truncate">
              {orders
                .map(
                  (o) =>
                    `${o.customerName ?? 'Cliente'}: ${o.items.map((i) => `${i.quantity}× ${i.title}`).join(', ')} (${brl.format(o.total)})`,
                )
                .join(' · ')}
            </span>
          </p>
        )}
      </button>
      <div className="flex shrink-0 flex-col items-end justify-center gap-1">
        <Button size="sm" variant="outline" onClick={onOpen}>
          Ver
        </Button>
        <Link
          to={`/lojas/${a.storeId}/cameras/${a.cameraId}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <VideoIcon className="size-3" /> câmera
        </Link>
      </div>
    </li>
  );
}

/** Agrupa por dia local, mantendo a ordem (mais recentes primeiro). */
function groupByDay(items: AlertItem[]) {
  const today = new Date();
  const groups: { key: string; title: string; subtitle: string; items: AlertItem[] }[] = [];
  for (const a of items) {
    const day = startOfDay(new Date(a.event.createdAt));
    const key = day.toISOString();
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      const offset = Math.round((startOfDay(today).getTime() - day.getTime()) / 86_400_000);
      g = { key, ...dayLabel(today, offset), items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }
  return groups;
}
