import { describe, expect, it } from 'vitest';
import {
  cleanupNoChangeClips,
  type ExpiredClip,
  type RetentionDeps,
} from '../src/pipeline/clip-retention';
import { silentLog } from './helpers';

/** "Banco" em memória: eventos com tipo, data de criação e vídeo. */
function fakeDeps(
  rows: { id: string; type: string; createdAt: Date; clipPath: string | null; size: number }[],
  opts: { failIds?: string[] } = {},
) {
  const removed: string[] = [];
  const deps: RetentionDeps = {
    async findExpired(cutoff, limit) {
      return rows
        .filter((r) => r.type === 'no_change' && r.clipPath && r.createdAt < cutoff)
        .slice(0, limit)
        .map((r) => ({ id: r.id, clipPath: r.clipPath! }) satisfies ExpiredClip);
    },
    async removeFile(relPath) {
      const row = rows.find((r) => r.clipPath === relPath)!;
      if (opts.failIds?.includes(row.id)) throw new Error('EACCES');
      removed.push(relPath);
      return row.size;
    },
    async markDeleted(ids) {
      for (const r of rows) if (ids.includes(r.id)) r.clipPath = null;
    },
  };
  return { deps, removed, rows };
}

const now = new Date('2026-10-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000);

describe('retenção de vídeos "sem alteração"', () => {
  it('apaga só no_change com mais de 24 h; mantém os demais', async () => {
    const { deps, removed, rows } = fakeDeps([
      { id: 'a', type: 'no_change', createdAt: hoursAgo(25), clipPath: 'c/a.mp4', size: 10 },
      { id: 'b', type: 'no_change', createdAt: hoursAgo(23), clipPath: 'c/b.mp4', size: 10 },
      { id: 'c', type: 'removed', createdAt: hoursAgo(72), clipPath: 'c/c.mp4', size: 10 },
      { id: 'd', type: 'moved', createdAt: hoursAgo(72), clipPath: 'c/d.mp4', size: 10 },
      { id: 'e', type: 'no_change', createdAt: hoursAgo(48), clipPath: 'c/e.mp4', size: 30 },
    ]);
    const r = await cleanupNoChangeClips({ log: silentLog, now, olderThanHours: 24, deps });
    expect(r).toEqual({ deleted: 2, bytes: 40 });
    expect(removed.sort()).toEqual(['c/a.mp4', 'c/e.mp4']);
    expect(rows.filter((x) => x.clipPath).map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });

  it('é idempotente', async () => {
    const { deps } = fakeDeps([
      { id: 'a', type: 'no_change', createdAt: hoursAgo(30), clipPath: 'c/a.mp4', size: 5 },
    ]);
    await cleanupNoChangeClips({ log: silentLog, now, deps });
    expect(await cleanupNoChangeClips({ log: silentLog, now, deps })).toEqual({
      deleted: 0,
      bytes: 0,
    });
  });

  it('erro em um arquivo não impede os outros nem trava o job', async () => {
    const { deps, rows } = fakeDeps(
      [
        { id: 'a', type: 'no_change', createdAt: hoursAgo(30), clipPath: 'c/a.mp4', size: 5 },
        { id: 'b', type: 'no_change', createdAt: hoursAgo(30), clipPath: 'c/b.mp4', size: 7 },
      ],
      { failIds: ['a'] },
    );
    const r = await cleanupNoChangeClips({ log: silentLog, now, deps });
    expect(r).toEqual({ deleted: 1, bytes: 7 });
    expect(rows.find((x) => x.id === 'a')!.clipPath).toBe('c/a.mp4');
  });

  it('processa em lotes até acabar', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({
      id: `e${i}`,
      type: 'no_change',
      createdAt: hoursAgo(26),
      clipPath: `c/${i}.mp4`,
      size: 1,
    }));
    const { deps } = fakeDeps(many);
    expect((await cleanupNoChangeClips({ log: silentLog, now, deps })).deleted).toBe(450);
  });
});
