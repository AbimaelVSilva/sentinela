/**
 * Gera um vídeo SINTÉTICO de prateleira para testar o pipeline sem câmera real:
 * prateleira desenhada (produtos coloridos com rótulo) e uma pessoa real (recortada de
 * uma imagem de exemplo pública do ultralytics) passando na frente 4 vezes:
 *
 *   1. retira um produto          → removed  (vermelho)
 *   2. muda um produto de lugar   → moved    (laranja)
 *   3. passa sem mexer em nada    → no_change (neutro)
 *   4. repõe tudo (fecha o loop)  → moved    (adição/reposição)
 *
 * Uso: npm run video:make -w api [-- saida.mp4]
 * Depois: api/scripts/simulate-camera.sh <streamKey> samples/prateleira-sintetica.mp4
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';

const W = 1280;
const H = 720;
const FPS = 15;
const PERSON_URL = 'https://ultralytics.com/images/zidane.jpg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'samples/prateleira-sintetica.mp4'));

interface Product {
  label: string;
  color: string;
  w: number;
  h: number;
}

const ROWS: (Product | null)[][] = [
  [
    { label: 'COCA', color: '#d81e1e', w: 70, h: 110 },
    { label: 'COCA', color: '#d81e1e', w: 70, h: 110 },
    { label: 'FANTA', color: '#ff7a00', w: 70, h: 110 },
    { label: 'GUARANÁ', color: '#1f9e3a', w: 70, h: 110 },
    { label: 'SUCO', color: '#7b2fd0', w: 90, h: 110 },
    { label: 'ÁGUA', color: '#14b4d8', w: 60, h: 120 },
  ],
  [
    { label: 'LEITE', color: '#1d4fd8', w: 90, h: 120 },
    { label: 'LEITE', color: '#1d4fd8', w: 90, h: 120 },
    { label: 'NESCAU', color: '#e8c400', w: 85, h: 110 },
    { label: 'BISCOITO', color: '#e0219a', w: 110, h: 70 },
    { label: 'CHIPS', color: '#f04a14', w: 95, h: 120 },
    { label: 'CHÁ', color: '#56c41b', w: 80, h: 100 },
  ],
  [
    { label: 'SABÃO', color: '#0aa6a6', w: 100, h: 110 },
    { label: 'DETERG.', color: '#9bd400', w: 60, h: 120 },
    { label: 'ESPONJA', color: '#ffd400', w: 90, h: 60 },
    { label: 'SHAMPOO', color: '#c21d6b', w: 60, h: 120 },
    { label: 'PASTA', color: '#2a6cf0', w: 110, h: 50 },
    null, // vaga vazia (destino do produto movido)
  ],
];

const SHELF_TOP = [70, 290, 510];
const SHELF_H = 200;
const SLOT_X = (col: number) => 190 + col * 160;

type Grid = (Product | null)[][];
const clone = (g: Grid): Grid => g.map((r) => [...r]);

// Estados da prateleira
const S0 = clone(ROWS);
const S1 = clone(S0);
S1[0]![1] = null; // passagem 1: retira uma Coca
const S2 = clone(S1);
S2[2]![5] = S2[0]![4]!; // passagem 2: move o Suco para a vaga da 3ª prateleira
S2[0]![4] = null;

function shelfSvg(grid: Grid): string {
  const parts: string[] = [
    `<rect width="${W}" height="${H}" fill="#2b2f36"/>`,
    `<rect x="150" y="40" width="980" height="${H - 60}" fill="#3a3530"/>`,
  ];
  grid.forEach((row, r) => {
    const top = SHELF_TOP[r]!;
    parts.push(`<rect x="150" y="${top + SHELF_H - 18}" width="980" height="18" fill="#6b5a48"/>`);
    row.forEach((p, c) => {
      if (!p) return;
      const x = SLOT_X(c) + (140 - p.w) / 2;
      const y = top + SHELF_H - 18 - p.h;
      parts.push(
        `<rect x="${x}" y="${y}" width="${p.w}" height="${p.h}" rx="6" fill="${p.color}" stroke="#111" stroke-width="2"/>`,
        `<rect x="${x + 6}" y="${y + p.h / 2 - 12}" width="${p.w - 12}" height="24" fill="#ffffff" opacity="0.9"/>`,
        `<text x="${x + p.w / 2}" y="${y + p.h / 2 + 6}" font-family="DejaVu Sans, Arial" font-size="${p.w < 70 ? 11 : 14}" font-weight="700" text-anchor="middle" fill="#111">${p.label}</text>`,
      );
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

async function renderShelf(grid: Grid): Promise<Buffer> {
  return sharp(Buffer.from(shelfSvg(grid)))
    .png()
    .toBuffer();
}

async function personSprite(): Promise<{ png: Buffer; w: number; h: number }> {
  const cache = path.join(root, 'samples/.person.jpg');
  let src: Buffer;
  if (fs.existsSync(cache)) src = fs.readFileSync(cache);
  else {
    console.log(`Baixando imagem de pessoa de ${PERSON_URL}…`);
    const res = await fetch(PERSON_URL);
    if (!res.ok) throw new Error(`Falha ao baixar ${PERSON_URL}: ${res.status}`);
    src = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, src);
  }
  // Pessoa da direita na zidane.jpg (1280×720).
  const h = 640;
  const png = await sharp(src)
    .extract({ left: 742, top: 43, width: 397, height: 677 })
    .resize({ height: h })
    .png()
    .toBuffer();
  const meta = await sharp(png).metadata();
  return { png, w: meta.width!, h };
}

interface Passage {
  start: number;
  /** Centro x onde a pessoa para (sobre o produto alterado). */
  stopX: number;
  /** Momento (s) em que a prateleira troca de estado, enquanto a pessoa cobre. */
  changeAt?: number;
  to?: Grid;
}

const WALK = 1.5;
const STAY = 2.5;
const PASSAGES: Passage[] = [
  { start: 15, stopX: SLOT_X(1) + 70, changeAt: 17.5, to: S1 },
  { start: 33, stopX: SLOT_X(4) + 110, changeAt: 35.5, to: S2 },
  { start: 51, stopX: SLOT_X(2) + 70 },
  { start: 69, stopX: SLOT_X(3) + 70, changeAt: 71.5, to: S0 },
];
const DURATION = 87;

async function main() {
  const shelves = new Map<Grid, Buffer>();
  for (const g of [S0, S1, S2]) shelves.set(g, await renderShelf(g));
  const person = await personSprite();

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${W}x${H}`,
      '-r',
      String(FPS),
      '-i',
      'pipe:0',
      // Ruído leve para simular sensor/compressão de câmera real.
      '-vf',
      'noise=alls=6:allf=t',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(FPS * 2),
      out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );

  let grid: Grid = S0;
  const total = DURATION * FPS;
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    for (const p of PASSAGES) if (p.changeAt !== undefined && p.to && t >= p.changeAt) grid = p.to;
    if (t < PASSAGES[0]!.changeAt!) grid = S0;

    const comps: OverlayOptions[] = [];
    const p = PASSAGES.find((x) => t >= x.start && t < x.start + 2 * WALK + STAY);
    if (p) {
      const rel = t - p.start;
      const enterFrom = -person.w;
      const exitTo = W;
      const stop = p.stopX - person.w / 2;
      const x =
        rel < WALK
          ? enterFrom + ((stop - enterFrom) * rel) / WALK
          : rel < WALK + STAY
            ? stop
            : stop + ((exitTo - stop) * (rel - WALK - STAY)) / WALK;
      const left = Math.round(x);
      const visibleLeft = Math.max(0, left);
      const visibleRight = Math.min(W, left + person.w);
      if (visibleRight > visibleLeft) {
        const crop = await sharp(person.png)
          .extract({
            left: visibleLeft - left,
            top: 0,
            width: visibleRight - visibleLeft,
            height: person.h,
          })
          .toBuffer();
        comps.push({ input: crop, left: visibleLeft, top: H - person.h });
      }
    }
    const frame = await sharp(shelves.get(grid)!).composite(comps).removeAlpha().raw().toBuffer();
    if (!ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % (FPS * 10) === 0) process.stdout.write(`\r${Math.round((i / total) * 100)}%`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`\nVídeo gerado: ${out} (${DURATION}s, ${FPS} fps)`);
  console.log('Passagens: 15s retira | 33s move | 51s sem mudança | 69s repõe');
}

await main();
