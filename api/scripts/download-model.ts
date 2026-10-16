/**
 * Obtém o modelo YOLO (ONNX, 640×640, COCO — classe 0 = person) em YOLO_MODEL_PATH.
 *
 * Ordem de tentativa:
 *  1. YOLO_ONNX_URL (se definido): download direto de um .onnx já exportado;
 *  2. exportação via ultralytics dentro de um container Docker (python:3.12-slim),
 *     sem instalar nada no host.
 *
 * Uso: npm run model:download [-- --model yolo11n] [-- --force]
 * Alternativa manual (com Python no host):
 *   pip install ultralytics onnx && yolo export model=yolo11n.pt format=onnx imgsz=640
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(apiRoot, process.env.YOLO_MODEL_PATH ?? './models/yolo.onnx');
const args = process.argv.slice(2);
const force = args.includes('--force');
const modelArgIdx = args.indexOf('--model');
const modelName = (modelArgIdx >= 0 ? args[modelArgIdx + 1] : undefined) ?? 'yolo11n';

function log(msg: string) {
  console.log(`[model] ${msg}`);
}

async function downloadDirect(url: string): Promise<boolean> {
  log(`Baixando ${url}…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    log(`Falhou: HTTP ${res.status}`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  log(`Salvo em ${target} (${(buf.length / 1e6).toFixed(1)} MB)`);
  return true;
}

function exportViaDocker(): boolean {
  const docker = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  if (docker.status !== 0) {
    log('Docker não encontrado.');
    return false;
  }
  const outDir = path.dirname(target);
  fs.mkdirSync(outDir, { recursive: true });
  log(`Exportando ${modelName}.pt → ONNX via Docker (pode levar alguns minutos na 1ª vez)…`);
  const script = [
    'set -e',
    'pip install -q --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu',
    'pip install -q --no-cache-dir ultralytics onnx onnxslim',
    'cd /tmp',
    `yolo export model=${modelName}.pt format=onnx imgsz=640 opset=12 simplify=True`,
    `cp /tmp/${modelName}.onnx /out/${path.basename(target)}`,
    `chown $HOST_UID:$HOST_GID /out/${path.basename(target)} || true`,
  ].join(' && ');
  const res = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      `HOST_UID=${process.getuid?.() ?? 1000}`,
      '-e',
      `HOST_GID=${process.getgid?.() ?? 1000}`,
      '-v',
      `${outDir}:/out`,
      'python:3.12-slim',
      'bash',
      '-c',
      `apt-get update -qq && apt-get install -y -qq libgl1 libglib2.0-0 >/dev/null && ${script}`,
    ],
    { stdio: 'inherit' },
  );
  return res.status === 0 && fs.existsSync(target);
}

async function main() {
  if (fs.existsSync(target) && !force) {
    log(`Modelo já existe em ${target} (use --force para substituir).`);
    return;
  }
  const url = process.env.YOLO_ONNX_URL;
  if (url && (await downloadDirect(url))) return;
  if (exportViaDocker()) {
    log(`Pronto: ${target}`);
    return;
  }
  console.error(
    '[model] Não foi possível obter o modelo. Gere manualmente:\n' +
      '  pip install ultralytics onnx\n' +
      `  yolo export model=${modelName}.pt format=onnx imgsz=640\n` +
      `  mv ${modelName}.onnx ${target}`,
  );
  process.exit(1);
}

await main();
