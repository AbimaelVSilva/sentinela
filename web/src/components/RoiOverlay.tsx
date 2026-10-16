import type { Point } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Desenha a ROI (polígono normalizado 0..1) sobre o vídeo/imagem. */
export function RoiOverlay({ roi, className }: { roi: Point[] | null; className?: string }) {
  if (!roi || roi.length < 3) return null;
  const points = roi.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  return (
    <svg
      className={cn('pointer-events-none absolute inset-0 size-full', className)}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon
        points={points}
        className="fill-severity-info/15 stroke-severity-info"
        strokeWidth={0.4}
        vectorEffect="non-scaling-stroke"
        style={{ strokeWidth: 2 }}
        strokeDasharray="6 4"
      />
    </svg>
  );
}
