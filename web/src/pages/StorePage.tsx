import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  CameraIcon,
  ChevronRightIcon,
  MapPinIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { CameraThumbnail } from '@/components/CameraThumbnail';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { QueryError } from '@/components/QueryError';
import { CameraStatusBadge, SeverityDot, WorkerStateBadge } from '@/components/StatusBadges';
import { StoreFormDialog } from '@/components/StoreFormDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, queryKeys, type StoreCamera } from '@/lib/api';
import { formatRelative } from '@/lib/labels';
import { AddCameraWizard } from './AddCameraWizard';

export function StorePage() {
  const { storeId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);

  const {
    data: store,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.store(storeId),
    queryFn: () => api.getStore(storeId),
  });

  const del = useMutation({
    mutationFn: () => api.deleteStore(storeId),
    onSuccess: () => {
      toast.success('Loja excluída');
      qc.removeQueries({ queryKey: queryKeys.store(storeId) });
      void qc.invalidateQueries({ queryKey: queryKeys.stores });
      void navigate('/');
    },
    onError: (err) => toast.error('Não foi possível excluir', { description: err.message }),
  });

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-6 h-64 w-full max-w-md rounded-xl" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  const hasCamera = store.cameras.length > 0;
  const addButton = (
    <Button onClick={() => setAdding(true)} disabled={hasCamera}>
      <PlusIcon /> Adicionar câmera
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> Lojas
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{store.name}</h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPinIcon className="size-3.5" /> {store.address || 'Sem endereço'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasCamera ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{addButton}</span>
              </TooltipTrigger>
              <TooltipContent>Protótipo: 1 câmera por loja</TooltipContent>
            </Tooltip>
          ) : (
            addButton
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Ações da loja">
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <PencilIcon /> Editar
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2Icon /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {hasCamera ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {store.cameras.map((c) => (
            <CameraCard key={c.id} camera={c} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CameraIcon}
          title="Nenhuma câmera conectada"
          description="Adicione a câmera Mibo que filma a prateleira. Você vai escanear o QR (ou digitar os dados) e receber a URL RTMP para configurar no app."
          action={
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> Adicionar câmera
            </Button>
          }
        />
      )}

      <StoreFormDialog open={editing} onOpenChange={setEditing} store={store} />
      <AddCameraWizard storeId={store.id} open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Excluir "${store.name}"?`}
        description="A câmera, os eventos e as imagens desta loja serão apagados. Esta ação não pode ser desfeita."
        confirmLabel="Excluir loja"
        destructive
        pending={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}

function CameraCard({ camera }: { camera: StoreCamera }) {
  return (
    <Link to={`/lojas/${camera.storeId}/cameras/${camera.id}`} className="group">
      <Card className="h-full gap-3 overflow-hidden pt-0 transition-colors group-hover:border-foreground/20">
        <div className="relative">
          <CameraThumbnail cameraId={camera.id} status={camera.status} className="rounded-none" />
          <div className="absolute top-2 left-2 flex gap-1.5">
            <CameraStatusBadge status={camera.status} />
          </div>
        </div>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="truncate">{camera.name}</span>
            <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {[camera.model, camera.serial && `S/N ${camera.serial}`].filter(Boolean).join(' · ') ||
              'Modelo não informado'}
          </p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <WorkerStateBadge state={camera.worker.state} />
          {camera.lastEvent ? (
            <p className="flex items-center gap-2 truncate text-muted-foreground">
              <SeverityDot severity={camera.lastEvent.severity} />
              <span className="truncate">{camera.lastEvent.label}</span>
              <span className="ml-auto shrink-0 text-xs">
                {formatRelative(camera.lastEvent.createdAt)}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">Nenhum evento ainda</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
