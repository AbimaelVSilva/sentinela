import type { EventSeverity, EventType } from '../db/schema';
import type { Comparison } from './types';

export const EVENT_META: Record<EventType, { severity: EventSeverity; label: string }> = {
  removed: { severity: 'alert', label: 'Alerta: produto retirado' },
  moved: { severity: 'attention', label: 'Atenção: produto movido' },
  no_change: { severity: 'info', label: 'Movimentação humana sem alteração' },
  analysis_failed: { severity: 'error', label: 'Falha na análise' },
};

export const severityOf = (type: EventType): EventSeverity => EVENT_META[type].severity;

/**
 * Regra de precedência (seção 6):
 * - qualquer item removido → `removed`;
 * - senão, qualquer item movido ou adicionado → `moved`;
 * - sem mudanças → `no_change`.
 */
export function classifyComparison(comparison: Pick<Comparison, 'changes'>): EventType {
  const kinds = new Set(comparison.changes.map((c) => c.change));
  if (kinds.has('removed')) return 'removed';
  if (kinds.has('moved') || kinds.has('added')) return 'moved';
  return 'no_change';
}
