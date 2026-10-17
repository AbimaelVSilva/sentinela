import type { InventoryItem } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Destaca um item do inventário sobre a imagem (vídeo ou foto): escurece o resto
 * e desenha a moldura com o nome. O contêiner deve ter exatamente a área da imagem.
 */
export function InventoryHighlight({
  item,
  className,
}: {
  item: InventoryItem | null | undefined;
  className?: string;
}) {
  if (!item) return null;
  const { x, y, w, h } = item.region;
  // Rótulo acima da caixa; se não couber (item no topo), vai para dentro dela.
  const labelInside = y < 0.08;
  return (
    <div
      key={item.id}
      className={cn(
        'pointer-events-none absolute inset-0 animate-in duration-150 fade-in-0',
        className,
      )}
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <mask id={`hl-${item.id}`}>
            <rect width="100" height="100" fill="white" />
            <rect x={x * 100} y={y * 100} width={w * 100} height={h * 100} fill="black" />
          </mask>
        </defs>
        <rect width="100" height="100" fill="black" opacity="0.45" mask={`url(#hl-${item.id})`} />
        <rect
          x={x * 100}
          y={y * 100}
          width={w * 100}
          height={h * 100}
          fill="none"
          className="stroke-severity-attention"
          style={{ strokeWidth: 3 }}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute max-w-[60%] truncate rounded-md bg-severity-attention px-2 py-0.5 text-xs font-medium text-white shadow"
        style={{
          left: `${Math.min(x, 0.7) * 100}%`,
          top: labelInside ? `calc(${y * 100}% + 4px)` : undefined,
          bottom: labelInside ? undefined : `calc(${(1 - y) * 100}% + 4px)`,
        }}
      >
        {item.id} · {item.label}
        {item.quantity > 1 && ` ×${item.quantity}`}
      </span>
    </div>
  );
}
