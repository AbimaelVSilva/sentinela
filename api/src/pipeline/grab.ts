import { spawn } from 'node:child_process';

/**
 * Captura um único frame em resolução total do RTSP (para baseline/after).
 * Resolve null em caso de erro ou timeout.
 */
export function grabFullFrame(url: string, timeoutMs = 8000): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-rtsp_transport',
        'tcp',
        '-i',
        url,
        '-an',
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      resolve(code === 0 && buf.length > 100 ? buf : null);
    });
  });
}
