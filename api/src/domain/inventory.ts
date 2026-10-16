import type { Change, Inventory, InventoryItem, Region } from './types';

function iou(a: Region, b: Region): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function findItem(items: InventoryItem[], c: Change): InventoryItem | undefined {
  if (c.itemId) {
    const byId = items.find((i) => i.id === c.itemId);
    if (byId) return byId;
  }
  if (c.beforeRegion) {
    let best: InventoryItem | undefined;
    let bestIou = 0.3;
    for (const it of items) {
      const v = iou(it.region, c.beforeRegion);
      if (v > bestIou) {
        best = it;
        bestIou = v;
      }
    }
    return best;
  }
  return undefined;
}

function nextId(items: InventoryItem[]): string {
  const max = items.reduce((m, i) => {
    const n = /^p(\d+)$/.exec(i.id);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `p${max + 1}`;
}

/**
 * Aplica as mudanças de uma comparação ao inventário (regiões já em coordenadas
 * do frame inteiro): remove/decrementa retirados, reposiciona movidos e inclui
 * adicionados. Função pura.
 */
export function applyChanges(inventory: Inventory | null, changes: Change[]): Inventory {
  const items = (inventory?.items ?? []).map((i) => ({ ...i, region: { ...i.region } }));
  for (const c of changes) {
    const item = findItem(items, c);
    if (c.change === 'removed') {
      if (!item) continue;
      item.quantity -= Math.max(1, c.quantity);
      if (item.quantity <= 0) items.splice(items.indexOf(item), 1);
    } else if (c.change === 'moved') {
      if (item && c.afterRegion) item.region = { ...c.afterRegion };
      else if (!item && c.afterRegion) {
        items.push({
          id: nextId(items),
          label: c.label,
          quantity: c.quantity,
          region: c.afterRegion,
        });
      }
    } else if (c.change === 'added' && c.afterRegion) {
      items.push({
        id: nextId(items),
        label: c.label,
        quantity: Math.max(1, c.quantity),
        region: { ...c.afterRegion },
      });
    }
  }
  return { items, updatedAt: new Date().toISOString() };
}
