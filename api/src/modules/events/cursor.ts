import type { EventRow } from '../../db/schema';

/** Cursor opaco: `<createdAt ISO>|<id>` em base64url (ordem estável por created_at desc, id desc). */
export const encodeCursor = (e: EventRow) =>
  Buffer.from(`${e.createdAt.toISOString()}|${e.id}`).toString('base64url');

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const createdAt = new Date(ts ?? '');
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
