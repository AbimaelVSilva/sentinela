import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ApiStatus() {
  const { data, isError, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 10_000,
    retry: false,
  });

  const state = isPending
    ? 'loading'
    : isError
      ? 'down'
      : data.status === 'ok' && data.detector
        ? 'ok'
        : 'degraded';
  const label = {
    loading: 'Verificando API…',
    down: 'API offline',
    degraded: 'API com problemas',
    ok: 'API online',
  }[state];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <span
            className={cn('size-2 rounded-full', {
              'animate-pulse bg-muted-foreground': state === 'loading',
              'bg-severity-alert': state === 'down',
              'bg-severity-attention': state === 'degraded',
              'bg-success': state === 'ok',
            })}
          />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {data ? (
          <span className="grid gap-0.5">
            <span>
              Banco: {data.db ? 'ok' : 'falha'} · MediaMTX: {data.mediamtx ? 'ok' : 'falha'}
            </span>
            <span>
              Detector YOLO: {data.detector ? 'ok' : 'modelo ausente'} · IA:{' '}
              {data.vision.provider === 'mock' ? 'simulada (mock)' : data.vision.model}
            </span>
          </span>
        ) : (
          <span>Sem resposta de /health</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
