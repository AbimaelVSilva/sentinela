import { useQuery } from '@tanstack/react-query';
import { BellIcon, CameraIcon, MapPinIcon, PlusIcon, StoreIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EmptyState } from '@/components/EmptyState';
import { QueryError } from '@/components/QueryError';
import { CameraStatusBadge } from '@/components/StatusBadges';
import { StoreFormDialog } from '@/components/StoreFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type CameraStatus, queryKeys, type Store } from '@/lib/api';
import { formatRelative } from '@/lib/labels';

export function StoresPage() {
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.stores,
    queryFn: api.listStores,
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lojas</h1>
          <p className="text-sm text-muted-foreground">
            Lojas monitoradas e o status das câmeras de cada uma.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon /> Nova loja
        </Button>
      </div>

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={StoreIcon}
          title="Nenhuma loja cadastrada"
          description="Cadastre sua primeira loja para conectar uma câmera Mibo e começar a monitorar a prateleira."
          action={
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> Cadastrar loja
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((store) => (
            <StoreCard key={store.id} store={store} />
          ))}
        </div>
      )}

      <StoreFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(s) => void navigate(`/lojas/${s.id}`)}
      />
    </div>
  );
}

/** Status que resume a loja: basta uma câmera offline para chamar atenção. */
const STATUS_PRIORITY: CameraStatus[] = ['offline', 'pending', 'online'];

function StoreCard({ store }: { store: Store }) {
  const cams = store.cameras;
  const camera = cams[0];
  const online = cams.filter((c) => c.status === 'online').length;
  const status = STATUS_PRIORITY.find((st) => cams.some((c) => c.status === st));
  const lastEvent = cams
    .map((c) => c.lastEvent)
    .filter((e) => !!e)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const cameraText =
    cams.length === 0
      ? 'Nenhuma câmera'
      : cams.length === 1
        ? camera!.name
        : `${cams.length} câmeras · ${online} online`;
  return (
    <Link to={`/lojas/${store.id}`} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/20 group-hover:bg-accent/30">
        <CardHeader>
          <CardTitle className="flex items-start justify-between gap-2">
            <span className="truncate">{store.name}</span>
            {store.alerts24h > 0 && (
              <Badge className="shrink-0 gap-1 bg-severity-alert text-white">
                <BellIcon /> {store.alerts24h}
              </Badge>
            )}
          </CardTitle>
          <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <MapPinIcon className="size-3.5 shrink-0" />
            {store.address || 'Sem endereço'}
          </p>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <CameraIcon className="size-4 shrink-0" />
            <span className="truncate">{cameraText}</span>
          </span>
          <CameraStatusBadge status={status} />
        </CardContent>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {store.alerts24h > 0
            ? `${store.alerts24h} alerta(s) nas últimas 24 h`
            : 'Nenhum alerta nas últimas 24 h'}
          {lastEvent && <> · último evento {formatRelative(lastEvent.createdAt)}</>}
        </CardContent>
      </Card>
    </Link>
  );
}
