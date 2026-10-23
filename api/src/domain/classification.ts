import type { EventSeverity, EventType } from '../db/schema';
import type { Comparison, PurchaseCheck } from './types';

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

/**
 * Rótulo e severidade levando em conta as compras da loja na janela da passagem:
 * - houve compra → alerta laranja (atenção), seja qual for a análise;
 * - retirada comprovada e nenhuma compra → alerta vermelho;
 * - sem conferência (loja sem Klavi), aguardando ou com erro → classificação da análise.
 * Falha de análise continua como falha (mesmo com compra, a análise não diz nada).
 */
export function eventMeta(
  type: EventType,
  purchase: Pick<PurchaseCheck, 'status'> | null | undefined,
): { severity: EventSeverity; label: string } {
  const base = EVENT_META[type];
  if (type === 'analysis_failed' || !purchase) return base;
  if (purchase.status === 'found') {
    return {
      severity: 'attention',
      label:
        type === 'removed'
          ? 'Atenção: retirada com compra'
          : type === 'moved'
            ? 'Atenção: produto movido, com compra'
            : 'Atenção: compra durante a passagem',
    };
  }
  if (purchase.status === 'none' && type === 'removed') {
    return { severity: 'alert', label: 'Alerta: retirada sem compra' };
  }
  return base;
}
