/**
 * Roda a retenção de vídeos na hora (o mesmo job que a API executa a cada 1 h).
 * Uso: npm run clips:cleanup -w api [-- --hours 24]
 */
import { sqlClient } from '../src/db/client';
import { cleanupNoChangeClips } from '../src/pipeline/clip-retention';

const idx = process.argv.indexOf('--hours');
const hours = idx >= 0 ? Number(process.argv[idx + 1]) : undefined;
const log = {
  info: (o: unknown, m?: string) => console.log(m ?? '', JSON.stringify(o)),
  warn: (o: unknown, m?: string) => console.warn(m ?? '', JSON.stringify(o)),
  error: (o: unknown, m?: string) => console.error(m ?? '', o),
} as never;

try {
  const r = await cleanupNoChangeClips({ log, olderThanHours: hours });
  console.log(`Vídeos apagados: ${r.deleted} (${(r.bytes / 1024 / 1024).toFixed(1)} MB liberados)`);
} finally {
  await sqlClient.end({ timeout: 5 });
}
