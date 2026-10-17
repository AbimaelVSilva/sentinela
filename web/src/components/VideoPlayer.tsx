import Hls from 'hls.js';
import { LoaderCircleIcon, VideoOffIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { startWhep, type WhepSession } from '@/lib/whep';
import { cn } from '@/lib/utils';

export type PlayerMode = 'webrtc' | 'hls';
type PlayerStatus = 'offline' | 'connecting' | 'playing' | 'error';

const WEBRTC_TIMEOUT_MS = 8_000;
const RETRY_MS = 3_000;

/**
 * Player ao vivo: WebRTC via WHEP (baixa latência) com fallback para HLS (hls.js)
 * quando o WebRTC falha ou o codec é H.265.
 */
export function VideoPlayer({
  whepUrl,
  hlsUrl,
  online,
  forceHls,
  className,
  children,
  contentOverlay,
}: {
  whepUrl: string;
  hlsUrl: string;
  online: boolean;
  /** Ex.: stream em H.265 — vai direto para HLS. */
  forceHls?: boolean;
  className?: string;
  /** Overlays posicionados sobre o player (badges, botões). */
  children?: ReactNode;
  /**
   * Overlays alinhados à área real da imagem (ROI, destaques): o vídeo usa
   * object-contain, então a imagem pode não ocupar o player inteiro.
   */
  contentOverlay?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSize, setVideoSize] = useState({ w: 16, h: 9 });

  // Proporção real da imagem do vídeo (para alinhar os overlays à área visível).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) {
        setVideoSize({ w: video.videoWidth, h: video.videoHeight });
      }
    };
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('resize', onMeta);
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('resize', onMeta);
    };
  }, []);

  // Área ocupada pela imagem com object-contain, só com CSS (container queries):
  // não depende de medir o DOM em JavaScript.
  const ratio = videoSize.w / videoSize.h;
  const content = {
    width: `min(100cqw, calc(100cqh * ${ratio}))`,
    height: `min(100cqh, calc(100cqw / ${ratio}))`,
  };
  const [mode, setMode] = useState<PlayerMode>(forceHls ? 'hls' : 'webrtc');
  const [status, setStatus] = useState<PlayerStatus>(online ? 'connecting' : 'offline');
  const [attempt, setAttempt] = useState(0);
  const effectiveMode: PlayerMode = forceHls ? 'hls' : mode;

  // Ajusta o status visível quando a câmera cai/volta (estado derivado, sem effect).
  const [prevOnline, setPrevOnline] = useState(online);
  if (prevOnline !== online) {
    setPrevOnline(online);
    setStatus(online ? 'connecting' : 'offline');
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !online) return;

    let disposed = false;
    let session: WhepSession | null = null;
    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const abort = new AbortController();

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      retryTimer = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
    };
    const onPlaying = () => !disposed && setStatus('playing');
    video.addEventListener('playing', onPlaying);

    if (effectiveMode === 'webrtc') {
      const timeout = setTimeout(() => {
        if (!disposed && video.readyState < 2) {
          console.warn('[player] WebRTC sem mídia; caindo para HLS');
          setMode('hls');
        }
      }, WEBRTC_TIMEOUT_MS);

      startWhep(
        whepUrl,
        (stream) => {
          if (disposed) return;
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        },
        abort.signal,
      )
        .then((s) => {
          if (disposed) return s.close();
          session = s;
          s.pc.addEventListener('connectionstatechange', () => {
            const st = s.pc.connectionState;
            if (st === 'failed') {
              clearTimeout(timeout);
              if (video.readyState < 2) setMode('hls');
              else {
                setStatus('connecting');
                scheduleRetry();
              }
            } else if (st === 'disconnected' || st === 'closed') {
              setStatus('connecting');
              scheduleRetry();
            }
          });
        })
        .catch((err: unknown) => {
          if (disposed) return;
          clearTimeout(timeout);
          console.warn('[player] WHEP falhou; usando HLS', err);
          setMode('hls');
        });

      return () => {
        disposed = true;
        clearTimeout(timeout);
        if (retryTimer) clearTimeout(retryTimer);
        abort.abort();
        session?.close();
        video.removeEventListener('playing', onPlaying);
        video.srcObject = null;
      };
    }

    // ---- HLS ----
    if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, backBufferLength: 10 });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          // O muxer HLS do MediaMTX leva alguns segundos para ficar pronto na 1ª requisição.
          setStatus('connecting');
          hls?.destroy();
          hls = null;
          scheduleRetry();
        }
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined));
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      void video.play().catch(() => undefined);
    } else {
      setStatus('error');
    }

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      hls?.destroy();
      video.removeEventListener('playing', onPlaying);
      video.removeAttribute('src');
      video.load();
    };
  }, [online, effectiveMode, whepUrl, hlsUrl, attempt]);

  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-xl bg-black [container-type:size]',
        className,
      )}
    >
      <video
        ref={videoRef}
        className={cn('size-full object-contain', status !== 'playing' && 'opacity-0')}
        muted
        autoPlay
        playsInline
      />

      {status !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/70">
          {status === 'offline' ? (
            <>
              <VideoOffIcon className="size-8" />
              Câmera sem sinal
            </>
          ) : status === 'error' ? (
            <>
              <VideoOffIcon className="size-8" />
              Este navegador não suporta o vídeo ao vivo
            </>
          ) : (
            <>
              <LoaderCircleIcon className="size-8 animate-spin" />
              Conectando ({effectiveMode === 'webrtc' ? 'WebRTC' : 'HLS'})…
            </>
          )}
        </div>
      )}

      {contentOverlay && (
        <div className="pointer-events-none absolute inset-0 m-auto" style={content}>
          {contentOverlay}
        </div>
      )}

      {children}

      {online && (
        <button
          type="button"
          className="absolute right-2 bottom-2 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[10px] tracking-wider text-white/80 uppercase hover:bg-black/80 disabled:cursor-default"
          title={forceHls ? 'H.265: somente HLS' : 'Alternar WebRTC / HLS'}
          disabled={forceHls}
          onClick={() => {
            setStatus('connecting');
            setMode((m) => (m === 'webrtc' ? 'hls' : 'webrtc'));
          }}
        >
          {effectiveMode === 'webrtc' ? 'WebRTC' : 'HLS'}
        </button>
      )}
    </div>
  );
}
