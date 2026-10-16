import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EraserIcon, ImageOffIcon, LoaderCircleIcon, SaveIcon, Undo2Icon } from 'lucide-react';
import { type PointerEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, type Camera, type Point, queryKeys } from '@/lib/api';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Editor da ROI: clique para adicionar vértices, arraste para ajustar.
 * Coordenadas salvas normalizadas 0..1.
 */
export function RoiEditor({
  camera,
  open,
  onOpenChange,
}: {
  camera: Camera;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95svh] overflow-y-auto sm:max-w-4xl">
        <RoiEditorBody camera={camera} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RoiEditorBody({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const qc = useQueryClient();
  const [points, setPoints] = useState<Point[]>(camera.roi ?? []);
  const [history, setHistory] = useState<Point[][]>([]);
  const [imgState, setImgState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [aspect, setAspect] = useState(16 / 9);
  const [src] = useState(() => api.snapshotUrl(camera.id, Date.now()));
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; moved: boolean } | null>(null);

  const commit = (next: Point[]) => {
    setHistory((h) => [...h.slice(-49), points]);
    setPoints(next);
  };

  const toNorm = (e: PointerEvent): Point | null => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };

  const onBackgroundPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || imgState !== 'ok') return;
    const p = toNorm(e);
    if (p) commit([...points, p]);
  };

  const onVertexPointerDown = (index: number) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { index, moved: false };
    setHistory((h) => [...h.slice(-49), points]);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toNorm(e);
    if (!p) return;
    drag.moved = true;
    setPoints((pts) => pts.map((q, i) => (i === drag.index ? p : q)));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    // Clique sem arrastar: descarta o snapshot de histórico criado no pointerdown.
    if (drag && !drag.moved) setHistory((h) => h.slice(0, -1));
  };

  const save = useMutation({
    mutationFn: () => api.updateCamera(camera.id, { roi: points.length >= 3 ? points : null }),
    onSuccess: (cam) => {
      qc.setQueryData(queryKeys.camera(camera.id), cam);
      toast.success(
        points.length >= 3 ? 'Área da prateleira salva' : 'Área removida (frame inteiro)',
        {
          description: camera.baseline
            ? 'Memorize a prateleira de novo para atualizar o inventário desta área.'
            : undefined,
        },
      );
      onClose();
    },
    onError: (err) => toast.error('Não foi possível salvar a área', { description: err.message }),
  });

  const poly = points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');

  return (
    <>
      <DialogHeader>
        <DialogTitle>Área da prateleira</DialogTitle>
        <DialogDescription>
          Clique para marcar os cantos da área com produtos; arraste os pontos para ajustar. Só
          pessoas sobre esta área disparam a análise.
        </DialogDescription>
      </DialogHeader>

      <div
        ref={boxRef}
        className="relative w-full touch-none overflow-hidden rounded-lg bg-black select-none"
        style={{ aspectRatio: aspect, cursor: imgState === 'ok' ? 'crosshair' : 'default' }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          src={src}
          alt="Imagem atual da câmera"
          className="pointer-events-none size-full object-fill"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight)
              setAspect(img.naturalWidth / img.naturalHeight);
            setImgState('ok');
          }}
          onError={() => setImgState('error')}
        />
        {imgState !== 'ok' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/70">
            {imgState === 'loading' ? (
              <>
                <LoaderCircleIcon className="size-6 animate-spin" /> Carregando imagem…
              </>
            ) : (
              <>
                <ImageOffIcon className="size-6" /> Sem imagem — a câmera precisa estar online.
              </>
            )}
          </div>
        )}
        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {points.length >= 3 && (
            <polygon
              points={poly}
              className="fill-severity-info/25 stroke-severity-info"
              style={{ strokeWidth: 2 }}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.length === 2 && (
            <polyline
              points={poly}
              className="fill-none stroke-severity-info"
              style={{ strokeWidth: 2 }}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* Vértices em um SVG sem distorção (pixels) para manter os círculos redondos. */}
        <svg className="absolute inset-0 size-full overflow-visible">
          {points.map((p, i) => (
            <circle
              key={i}
              cx={`${p.x * 100}%`}
              cy={`${p.y * 100}%`}
              r={7}
              className="cursor-grab fill-white stroke-severity-info active:cursor-grabbing"
              strokeWidth={3}
              onPointerDown={onVertexPointerDown(i)}
            />
          ))}
        </svg>
      </div>

      <DialogFooter className="flex-row flex-wrap items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {points.length} ponto(s){points.length > 0 && points.length < 3 && ' — mínimo 3'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={history.length === 0}
            onClick={() => {
              setPoints(history[history.length - 1] ?? []);
              setHistory((h) => h.slice(0, -1));
            }}
          >
            <Undo2Icon /> Desfazer
          </Button>
          <Button variant="outline" disabled={points.length === 0} onClick={() => commit([])}>
            <EraserIcon /> Limpar
          </Button>
          <Button
            disabled={(points.length > 0 && points.length < 3) || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />} Salvar
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
