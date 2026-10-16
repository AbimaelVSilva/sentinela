import { ChevronDownIcon, PackageIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Camera } from '@/lib/api';
import { formatRelative } from '@/lib/labels';
import { cn } from '@/lib/utils';

/** Inventário de referência memorizado (colapsável). */
export function InventoryCard({ camera }: { camera: Camera }) {
  const [open, setOpen] = useState(false);
  const items = camera.inventory?.items ?? [];
  if (!camera.inventory) return null;

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
        <ul className="grid gap-1 border-t px-4 py-3 text-sm sm:grid-cols-2">
          {items.length === 0 && <li className="text-muted-foreground">Nenhum produto listado.</li>}
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{i.id}</span>
              <span className="truncate">{i.label}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">×{i.quantity}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
