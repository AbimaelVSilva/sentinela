/** Até quando o usuário já viu os alertas do sino (por usuário, no navegador). */
const listeners = new Set<() => void>();
const key = (userId: string) => `sentinela-alerts-read-${userId}`;

export function getAlertsReadAt(userId: string | undefined): number {
  if (!userId) return 0;
  try {
    return Number(localStorage.getItem(key(userId))) || 0;
  } catch {
    return 0;
  }
}

export function setAlertsReadAt(userId: string, at: number) {
  try {
    localStorage.setItem(key(userId), String(at));
  } catch {
    // ignora armazenamento indisponível
  }
  listeners.forEach((fn) => fn());
}

export function onAlertsReadChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Link da ocorrência: tela da câmera com o modal do evento aberto. */
export const eventLink = (storeId: string, cameraId: string, eventId: string) =>
  `/lojas/${storeId}/cameras/${cameraId}?evento=${eventId}`;
