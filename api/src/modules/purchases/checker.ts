import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { cameras, type EventRow, events, snapshots, stores } from '../../db/schema';
import { eventMeta } from '../../domain/classification';
import type { PurchaseCheck } from '../../domain/types';
import { klaviConfigured, ordersBetween } from '../../integrations/klavi';
import { bus } from '../../lib/bus';
import { serializeEvent } from '../events/serializer';

/**
 * Conferência de compras: para cada passagem, procura na Klavi pedidos da loja entre
 * (entrada − margem) e (saída + margem). Como o cliente costuma pagar no totem logo
 * depois de pegar o produto, a consulta só roda quando a janela fecha; até lá o evento
 * fica "pending" e o alerta não é avisado.
 */

const RETRY_MS = 60_000;
const timers = new Map<string, NodeJS.Timeout>();

/** Janela de busca: margem antes da entrada e depois da saída da pessoa. */
export function purchaseWindow(enteredAt: Date, leftAt: Date) {
  const margin = env.KLAVI_WINDOW_SECONDS * 1000;
  return { from: new Date(enteredAt.getTime() - margin), to: new Date(leftAt.getTime() + margin) };
}

/** Filiais da Klavi da loja (vazio = loja sem integração ou Klavi não configurada). */
export async function storeBranches(storeId: string): Promise<string[]> {
  if (!klaviConfigured()) return [];
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { klaviBranchIds: true },
  });
  return store?.klaviBranchIds ?? [];
}

/** Estado inicial da conferência para um evento novo (null = não confere). */
export async function initialPurchase(
  storeId: string,
  enteredAt: Date,
  leftAt: Date,
): Promise<PurchaseCheck | null> {
  if ((await storeBranches(storeId)).length === 0) return null;
  const w = purchaseWindow(enteredAt, leftAt);
  return {
    status: 'pending',
    windowFrom: w.from.toISOString(),
    windowTo: w.to.toISOString(),
    orders: [],
  };
}

/** Agenda a conferência para quando a janela fechar (+ atraso para o pedido chegar à API). */
export function schedulePurchaseCheck(eventId: string, windowTo: Date, log: FastifyBaseLogger) {
  clearTimeout(timers.get(eventId));
  const at = windowTo.getTime() + env.KLAVI_CHECK_DELAY_SECONDS * 1000;
  const timer = setTimeout(
    () => {
      timers.delete(eventId);
      void runPurchaseCheck(eventId, log, { retryOnError: true });
    },
    Math.max(0, at - Date.now()),
  );
  timer.unref();
  timers.set(eventId, timer);
}

async function emitUpdated(row: EventRow, notify: boolean) {
  const camera = await db.query.cameras.findFirst({ where: eq(cameras.id, row.cameraId) });
  if (!camera) return;
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, camera.storeId),
    columns: { name: true },
  });
  const [before, after] = await Promise.all(
    [row.beforeSnapshotId, row.afterSnapshotId].map((id) =>
      id ? db.query.snapshots.findFirst({ where: eq(snapshots.id, id) }) : null,
    ),
  );
  bus.emit('event.updated', {
    cameraId: row.cameraId,
    event: serializeEvent(row, before, after),
    storeId: camera.storeId,
    storeName: store?.name ?? '',
    cameraName: camera.name,
    notify,
  });
}

/**
 * Consulta a Klavi e grava o resultado. Avisa (notify) quando a conferência sai de
 * "pending" e o evento ficou como alerta (vermelho) ou atenção (laranja).
 */
export async function runPurchaseCheck(
  eventId: string,
  log: FastifyBaseLogger,
  opts: { retryOnError?: boolean } = {},
): Promise<EventRow | null> {
  const ev = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!ev?.personEnteredAt || !ev.personLeftAt) return null;
  const camera = await db.query.cameras.findFirst({
    where: eq(cameras.id, ev.cameraId),
    columns: { storeId: true },
  });
  const branches = camera ? await storeBranches(camera.storeId) : [];
  if (branches.length === 0) return null;

  const w = purchaseWindow(ev.personEnteredAt, ev.personLeftAt);
  const base = { windowFrom: w.from.toISOString(), windowTo: w.to.toISOString() };
  let purchase: PurchaseCheck;
  try {
    const orders = await ordersBetween(branches, w.from, w.to);
    purchase = {
      ...base,
      status: orders.length ? 'found' : 'none',
      orders,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.retryOnError) {
      log.warn({ eventId, err: message }, 'Klavi indisponível; tentando de novo em 1 min');
      const t = setTimeout(() => void runPurchaseCheck(eventId, log), RETRY_MS);
      t.unref();
      return null;
    }
    purchase = {
      ...base,
      status: 'error',
      orders: [],
      error: message,
      checkedAt: new Date().toISOString(),
    };
  }

  const wasPending = !ev.purchase || ev.purchase.status === 'pending';
  const { severity } = eventMeta(ev.type, purchase);
  const [row] = await db
    .update(events)
    .set({ purchase, severity })
    .where(eq(events.id, eventId))
    .returning();
  if (!row) return null;
  log.info(
    { eventId, status: purchase.status, orders: purchase.orders.length, severity },
    'Compras da passagem conferidas',
  );
  await emitUpdated(row, wasPending && (severity === 'alert' || severity === 'attention'));
  return row;
}

/** No boot: reagenda as conferências que ficaram pendentes (ex.: API reiniciada). */
export async function resumePendingPurchaseChecks(log: FastifyBaseLogger) {
  const pending = await db
    .select({ id: events.id, purchase: events.purchase })
    .from(events)
    .where(sql`${events.purchase}->>'status' = 'pending'`);
  for (const p of pending) schedulePurchaseCheck(p.id, new Date(p.purchase!.windowTo), log);
  if (pending.length) log.info({ count: pending.length }, 'Conferências de compras retomadas');
}
