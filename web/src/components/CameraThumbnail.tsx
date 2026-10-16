import { VideoOffIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type CameraStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Miniatura do último frame (`/cameras/:id/snapshot`), atualizada a cada 10 s. */
export function CameraThumbnail({
  cameraId,
  status,
  className,
  intervalMs = 10_000,
}: {
  cameraId: string;
  status: CameraStatus;
  className?: string;
  intervalMs?: number;
}) {
  const [tick, setTick] = useState(() => Date.now());
  const [failedTick, setFailedTick] = useState<number | null>(null);
  const online = status === 'online';
  const failed = failedTick === tick;

  useEffect(() => {
    if (!online) return;
    const t = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [online, intervalMs]);

  return (
    <div className={cn('relative aspect-video overflow-hidden rounded-lg bg-muted', className)}>
      {online && !failed ? (
        <img
          key={tick}
          src={api.snapshotUrl(cameraId, tick)}
          alt="Última imagem da câmera"
          className="size-full object-cover"
          onError={() => setFailedTick(tick)}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
          <VideoOffIcon className="size-6" />
          {online ? 'Aguardando primeiro frame…' : 'Sem sinal'}
        </div>
      )}
    </div>
  );
}
