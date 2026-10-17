/** Token de sessão no navegador (localStorage) com aviso de mudanças. */
const KEY = 'sentinela-token';
const listeners = new Set<(token: string | null) => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current = read();

export const getToken = () => current;

export function setToken(token: string | null) {
  current = token;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // armazenamento indisponível: mantém só em memória
  }
  listeners.forEach((fn) => fn(token));
}

export function onTokenChange(fn: (token: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Logout/login em outra aba.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = e.newValue;
    listeners.forEach((fn) => fn(current));
  });
}

/** Acrescenta ?token= a URLs que o navegador busca sozinho (<img>, EventSource). */
export function withToken(url: string): string {
  const t = getToken();
  if (!t) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`;
}
