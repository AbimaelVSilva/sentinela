export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ??
  'http://localhost:3333';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Json = Record<string, unknown> | unknown[];

export async function apiFetch<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: Json } = {},
): Promise<T> {
  const { body, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar à API.', null);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : null) ?? `Erro ${res.status}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const fileUrl = (path: string | null | undefined) =>
  path ? (path.startsWith('http') ? path : `${API_URL}${path}`) : undefined;

// ---------- Tipos da API ----------

export interface Health {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  db: boolean;
  mediamtx: boolean;
  time: string;
}

export const api = {
  health: () => apiFetch<Health>('/health'),
};
