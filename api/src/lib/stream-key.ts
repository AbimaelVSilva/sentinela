import { randomBytes } from 'node:crypto';

/** 24 caracteres url-safe (base64url de 18 bytes aleatórios). */
export function generateStreamKey(): string {
  return randomBytes(18).toString('base64url');
}

/** Extrai a stream key de um path `live/<key>` do MediaMTX. */
export function streamKeyFromPath(path: string | undefined | null): string | null {
  if (!path) return null;
  const m = /^\/?live\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  return m?.[1] ?? null;
}
