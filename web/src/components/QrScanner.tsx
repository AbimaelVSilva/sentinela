import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { CameraOffIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Lê QR codes pela webcam (ou câmera traseira do celular) usando @zxing/browser.
 * Requer contexto seguro (https ou localhost) para acessar a câmera.
 */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onResultRef = useRef(onResult);
  const [error, setError] = useState<string | null>(() =>
    !window.isSecureContext || !navigator.mediaDevices?.getUserMedia
      ? 'O navegador só libera a câmera em https ou localhost. Use a aba "Manual" ou cole o conteúdo do QR abaixo.'
      : null,
  );
  const [starting, setStarting] = useState(error === null);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
    let controls: IScannerControls | null = null;
    let cancelled = false;

    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video,
        (result, _err, ctrl) => {
          if (result && !cancelled) {
            ctrl.stop();
            onResultRef.current(result.getText());
          }
        },
      )
      .then((c) => {
        if (cancelled) c.stop();
        else controls = c;
        setStarting(false);
      })
      .catch((err: unknown) => {
        setStarting(false);
        const name = err instanceof Error ? err.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'Permissão da câmera negada. Libere o acesso no navegador ou use a aba "Manual".'
            : name === 'NotFoundError'
              ? 'Nenhuma câmera encontrada neste dispositivo.'
              : 'Não foi possível abrir a câmera.',
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border bg-black">
      <video ref={videoRef} className="size-full object-cover" muted playsInline />
      {!error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="size-48 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      )}
      {starting && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
          <LoaderCircleIcon className="mr-2 size-4 animate-spin" /> Abrindo câmera…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-6 text-center text-sm text-muted-foreground">
          <CameraOffIcon className="size-6" />
          {error}
        </div>
      )}
    </div>
  );
}
