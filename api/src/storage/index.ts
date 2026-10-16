import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

/** Caminho relativo (dentro de STORAGE_DIR) → URL pública servida pelo @fastify/static. */
export const fileUrl = (relPath: string) => `/files/${relPath.split(path.sep).join('/')}`;

export const absPath = (relPath: string) => path.join(env.STORAGE_DIR, relPath);

/** Salva um buffer em STORAGE_DIR/<cameraId>/<name> e devolve o caminho relativo. */
export async function saveFile(cameraId: string, name: string, data: Buffer): Promise<string> {
  const rel = path.join(cameraId, name);
  const abs = absPath(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
  return rel;
}

export const readFile = (relPath: string) => fs.readFile(absPath(relPath));

export async function removeCameraDir(cameraId: string): Promise<void> {
  await fs.rm(path.join(env.STORAGE_DIR, cameraId), { recursive: true, force: true });
}
