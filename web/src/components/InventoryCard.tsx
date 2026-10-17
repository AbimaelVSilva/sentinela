import { ChevronDownIcon, PackageIcon, PinIcon } from 'lucide-react';
import { useState } from 'react';
import { InventoryHighlight } from '@/components/InventoryHighlight';
import { Badge } from '@/components/ui/badge';
import { type Camera, fileUrl } from '@/lib/api';
import { formatRelative } from '@/lib/labels';
import { cn } from '@/lib/utils';

/**
 * Inventário memorizado. Passar o mouse (ou focar) num item destaca o produto no
 * vídeo ao vivo e na foto de referência; clicar fixa o destaque.
 */
export function InventoryCard({
  camera,
  highlightId,
  onHighlight,
}: {
  camera: Camera;
  highlightId: string | null;
  onHighlight: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [pinned, setPinned] = useState<string | null>(null);
  const items = camera.inventory?.items ?? [];
  if (!camera.inventory) return null;
  const baseline = camera.baseline;
  const highlighted = items.find((i) => i.id === highlightId) ?? null;

  const hover = (id: string | null) => onHighlight(id ?? pinned);
  const togglePin = (id: string) => {
    const next = pinned === id ? null : id;
    setPinned(next);
    onHighlight(next ?? id);
  };

  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <PackageIcon className="size-4 text-muted-foreground" />
        <span className="font-medium">Inventário memorizado</span>
        <Badge variant="secondary">{items.length} itens</Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          atualizado {formatRelative(camera.inventory.updatedAt)}
        </span>
        <ChevronDownIcon className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid gap-4 border-t p-4 md:grid-cols-2">
          {baseline && (
            <div className="md:sticky md:top-4 md:self-start">
              <div
                className="relative overflow-hidden rounded-lg bg-muted"
                style={{ aspectRatio: `${baseline.width} / ${baseline.height}` }}
              >
                <img
                  src={fileUrl(baseline.url)}
                  alt="Foto de referência da prateleira"
                  className="size-full object-cover"
                />
                <InventoryHighlight item={highlighted} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Passe o mouse num item para ver onde ele está; clique para fixar.
              </p>
            </div>
          )}
          <ul className="grid content-start gap-0.5 text-sm" onMouseLeave={() => hover(null)}>
            {items.length === 0 && (
              <li className="text-muted-foreground">Nenhum produto listado.</li>
            )}
            {items.map((i) => {
              const active = i.id === highlightId;
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                      active && 'bg-severity-attention/15 text-foreground',
                    )}
                    onMouseEnter={() => hover(i.id)}
                    onFocus={() => hover(i.id)}
                    onBlur={() => hover(null)}
                    onClick={() => togglePin(i.id)}
                    aria-pressed={pinned === i.id}
                  >
                    <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                      {i.id}
                    </span>
                    <span className="truncate">{i.label}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {pinned === i.id && <PinIcon className="size-3 text-severity-attention" />}×
                      {i.quantity}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
