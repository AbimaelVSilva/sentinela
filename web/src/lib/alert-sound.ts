/**
 * Som de alerta gerado com Web Audio (sem arquivo). Navegadores só liberam áudio
 * depois de uma interação do usuário: o contexto é desbloqueado no primeiro clique/tecla.
 */
import type { Severity } from './api';

const MUTE_KEY = 'sentinela-alert-muted';
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  return ctx;
}

// Desbloqueia o áudio na primeira interação (política de autoplay dos navegadores).
if (typeof window !== 'undefined') {
  const unlock = () => {
    void getCtx()?.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export const isAlertMuted = () => muted;

export function setAlertMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // ignora armazenamento indisponível
  }
  listeners.forEach((fn) => fn());
}

export function onAlertMutedChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Toca o aviso: 3 toques agudos para retirado (alerta), 2 para movido (atenção). */
export function playAlertSound(severity: Severity) {
  if (muted) return;
  const ac = getCtx();
  if (!ac || ac.state === 'closed') return;
  const pattern =
    severity === 'alert'
      ? [
          { f: 988, t: 0 },
          { f: 1319, t: 0.18 },
          { f: 988, t: 0.36 },
        ]
      : [
          { f: 784, t: 0 },
          { f: 659, t: 0.22 },
        ];
  const start = ac.currentTime + 0.02;
  for (const { f, t } of pattern) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, start + t);
    gain.gain.exponentialRampToValueAtTime(0.35, start + t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + t + 0.16);
    osc.connect(gain).connect(ac.destination);
    osc.start(start + t);
    osc.stop(start + t + 0.18);
  }
}
