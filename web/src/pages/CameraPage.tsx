import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  KeyRoundIcon,
  ListIcon,
  MoreVerticalIcon,
  RadioTowerIcon,
  SquareDashedIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { CalibrationPanel } from '@/components/CalibrationPanel';
import { CameraActions } from '@/components/CameraActions';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EventStepper } from '@/components/EventStepper';
import { InventoryCard } from '@/components/InventoryCard';
import { CopyField } from '@/components/CopyField';
import { QueryError } from '@/components/QueryError';
import { RoiOverlay } from '@/components/RoiOverlay';
import { CameraStatusBadge, WorkerStateBadge } from '@/components/StatusBadges';
import { VideoPlayer } from '@/components/VideoPlayer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type Camera, queryKeys } from '@/lib/api';
import { formatRelative } from '@/lib/labels';

export function CameraPage() {
  const { storeId = '', cameraId = '' } = useParams();
  const [eventsOpen, setEventsOpen] = useState(false);

  const {
    data: camera,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.camera(cameraId),
    queryFn: () => api.getCamera(cameraId),
  });

  if (isPending) {
    return (
      <div className="flex flex-1 gap-4 p-4">
        <div className="flex-1 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="aspect-video w-full rounded-xl" />
        </div>
        <Skeleton className="hidden w-[380px] rounded-xl lg:block" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <QueryError error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  const eventsPanel = <EventStepper cameraId={camera.id} />;

  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] space-y-4 p-4">
          <CameraHeader
            camera={camera}
            storeId={storeId}
            onOpenEvents={() => setEventsOpen(true)}
          />

          <VideoPlayer
            whepUrl={camera.playback.whep}
            hlsUrl={camera.playback.hls}
            online={camera.status === 'online'}
            forceHls={camera.stream?.isH265}
          >
            <RoiOverlay roi={camera.roi} />
            <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
              <CameraStatusBadge status={camera.status} />
              <WorkerStateBadge state={camera.worker.state} />
            </div>
          </VideoPlayer>

          <CameraActions camera={camera} />
          <CalibrationPanel camera={camera} />

          {!camera.roi && (
            <Alert className="border-severity-attention/50">
              <SquareDashedIcon className="text-severity-attention" />
              <AlertTitle>Área da prateleira não definida</AlertTitle>
              <AlertDescription>
                Sem a área, qualquer pessoa no quadro inteiro dispara a análise. Use “Editar área da
                prateleira” para marcar só a região com produtos.
              </AlertDescription>
            </Alert>
          )}

          {camera.stream?.isH265 && (
            <Alert className="border-severity-attention/50">
              <TriangleAlertIcon className="text-severity-attention" />
              <AlertTitle>Vídeo em H.265</AlertTitle>
              <AlertDescription>
                O WebRTC não toca H.265 na maioria dos navegadores; usando HLS (latência maior).
                Configure a câmera para H.264 no app Mibo Smart.
              </AlertDescription>
            </Alert>
          )}

          <InventoryCard camera={camera} />
        </div>
      </div>

      <aside className="hidden w-[380px] shrink-0 border-l lg:flex lg:flex-col">
        {eventsPanel}
      </aside>
      <Sheet open={eventsOpen} onOpenChange={setEventsOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-[380px]">
          <SheetHeader className="sr-only">
            <SheetTitle>Eventos</SheetTitle>
          </SheetHeader>
          {eventsPanel}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CameraHeader({
  camera,
  storeId,
  onOpenEvents,
}: {
  camera: Camera;
  storeId: string;
  onOpenEvents: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showRtmp, setShowRtmp] = useState(false);
  const [confirmKey, setConfirmKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const regen = useMutation({
    mutationFn: () => api.regenerateKey(camera.id),
    onSuccess: (res) => {
      qc.setQueryData(queryKeys.camera(camera.id), res.camera);
      setConfirmKey(false);
      setShowRtmp(true);
      toast.success('Nova chave gerada', { description: 'Atualize a URL RTMP na câmera.' });
    },
    onError: (err) => toast.error('Falha ao gerar nova chave', { description: err.message }),
  });

  const del = useMutation({
    mutationFn: () => api.deleteCamera(camera.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: queryKeys.camera(camera.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.stores });
      toast.success('Câmera removida');
      void navigate(`/lojas/${storeId}`);
    },
    onError: (err) => toast.error('Falha ao remover', { description: err.message }),
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <Link
          to={`/lojas/${storeId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Voltar para a loja
        </Link>
        <h1 className="truncate text-xl font-semibold tracking-tight">{camera.name}</h1>
        <p className="text-xs text-muted-foreground">
          {[camera.model, camera.serial && `S/N ${camera.serial}`].filter(Boolean).join(' · ') ||
            'Modelo não informado'}{' '}
          · visto {formatRelative(camera.lastSeenAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" className="lg:hidden" onClick={onOpenEvents}>
          <ListIcon /> Eventos
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Ações da câmera">
              <MoreVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setShowRtmp(true)}>
              <RadioTowerIcon /> Ver destino RTMP
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setConfirmKey(true)}>
              <KeyRoundIcon /> Gerar nova chave
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2Icon /> Remover câmera
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={showRtmp} onOpenChange={setShowRtmp}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Destino RTMP</DialogTitle>
            <DialogDescription>Configure estes dados no app Mibo Smart.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <CopyField label="URL completa" value={camera.rtmp.fullUrl} />
            <CopyField label="Servidor" value={camera.rtmp.serverUrl} />
            <CopyField label="Chave de transmissão" value={camera.rtmp.streamKey} />
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmKey}
        onOpenChange={setConfirmKey}
        title="Gerar nova chave de transmissão?"
        description="A câmera vai desconectar até você atualizar a URL RTMP no app Mibo Smart."
        confirmLabel="Gerar nova chave"
        pending={regen.isPending}
        onConfirm={() => regen.mutate()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remover esta câmera?"
        description="Os eventos e imagens desta câmera serão apagados. Esta ação não pode ser desfeita."
        confirmLabel="Remover câmera"
        destructive
        pending={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}
