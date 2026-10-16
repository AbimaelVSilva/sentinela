import { z } from 'zod';
import { env } from '../../config/env';
import type { StreamInfo } from '../../lib/bus';

// Schema tolerante: o formato de `tracks` mudou entre versões do MediaMTX
// (string[] → objetos em `tracks2`). Aceitamos os dois.
const TrackSchema = z.union([
  z.string(),
  z.looseObject({ codec: z.string().optional(), type: z.string().optional() }),
]);

const PathItemSchema = z.looseObject({
  name: z.string(),
  ready: z.boolean().optional().default(false),
  available: z.boolean().optional(),
  tracks: z.array(TrackSchema).nullish(),
  tracks2: z.array(TrackSchema).nullish(),
  readers: z.array(z.unknown()).nullish(),
});

const PathListSchema = z.looseObject({
  itemCount: z.number().optional(),
  pageCount: z.number().optional(),
  items: z.array(PathItemSchema).default([]),
});

export type MediaMtxPath = z.infer<typeof PathItemSchema>;

const VIDEO_CODECS = [
  'H264',
  'H265',
  'AV1',
  'VP8',
  'VP9',
  'MJPEG',
  'MPEG-4 VIDEO',
  'MPEG-1/2 VIDEO',
];

function codecName(t: z.infer<typeof TrackSchema>): string | null {
  if (typeof t === 'string') return t;
  return t.codec ?? null;
}

export function streamInfoFromPath(p: MediaMtxPath): StreamInfo {
  const raw = (p.tracks2?.length ? p.tracks2 : p.tracks) ?? [];
  const codecs = raw.map(codecName).filter((c): c is string => !!c);
  const videoCodec = codecs.find((c) => VIDEO_CODECS.includes(c.toUpperCase())) ?? null;
  return {
    ready: p.ready === true || p.available === true,
    codecs,
    videoCodec,
    isH265: !!videoCodec && /^(H265|HEVC)$/i.test(videoCodec),
    readers: p.readers?.length ?? 0,
  };
}

/** Lista todos os paths ativos (paginando se necessário). */
export async function listPaths(): Promise<MediaMtxPath[]> {
  const items: MediaMtxPath[] = [];
  for (let page = 0; page < 50; page++) {
    const res = await fetch(`${env.MEDIAMTX_API_URL}/v3/paths/list?page=${page}&itemsPerPage=200`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`MediaMTX /v3/paths/list respondeu ${res.status}`);
    const data = PathListSchema.parse(await res.json());
    items.push(...data.items);
    if (!data.pageCount || page + 1 >= data.pageCount) break;
  }
  return items;
}

/** Derruba sessões publicando em `live/<key>` (usado ao regenerar/remover a key). */
export async function kickPublisher(streamKey: string): Promise<void> {
  try {
    const res = await fetch(`${env.MEDIAMTX_API_URL}/v3/rtmpconns/list`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { items?: { id: string; path: string; state: string }[] };
    const conns = (data.items ?? []).filter(
      (c) => c.path === `live/${streamKey}` && c.state === 'publish',
    );
    await Promise.all(
      conns.map((c) =>
        fetch(`${env.MEDIAMTX_API_URL}/v3/rtmpconns/kick/${c.id}`, {
          method: 'POST',
          signal: AbortSignal.timeout(2500),
        }),
      ),
    );
  } catch {
    // best effort
  }
}
