/**
 * Parser tolerante do QR das câmeras Intelbras Mibo.
 *
 * O formato do QR não é documentado, então tentamos, em ordem:
 *  1. JSON;
 *  2. URL / querystring com parâmetros;
 *  3. pares `chave:valor` (ou `chave=valor`) separados por `;`, `,`, `|` ou quebra de linha;
 *  4. um token alfanumérico longo, tratado como número de série.
 * Em todos os casos também procuramos um modelo da linha iM no texto.
 */

export const MIBO_MODELS = [
  'iM1',
  'iM3',
  'iM3 C',
  'iM4',
  'iM4 C',
  'iM5',
  'iM5 S',
  'iM5 SC',
  'iM6',
  'iM7',
  'iM7 S',
  'iM9+',
  'iME 360',
  'iME 500',
  'Outro',
] as const;

export interface MiboQrResult {
  serial?: string;
  model?: string;
}

const SERIAL_KEYS = [
  'sn',
  'serial',
  'serialnumber',
  'serialno',
  'seriesnumber',
  'deviceserial',
  'devicesn',
  'deviceid',
  'devid',
  'did',
  'uid',
  'id',
];
const MODEL_KEYS = ['model', 'devicemodel', 'modelo', 'md', 'devmodel', 'type', 'devicetype', 'pn'];

const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const squash = (s: string) => s.toUpperCase().replace(/[\s_-]+/g, '');

/** Converte variações ("IM5SC", "im5-sc") para o nome canônico da lista, se houver. */
export function normalizeMiboModel(value: string): string {
  const trimmed = value.trim();
  const hit = MIBO_MODELS.find((m) => m !== 'Outro' && squash(m) === squash(trimmed));
  return hit ?? trimmed;
}

const MODEL_IN_TEXT = /\biM(?:E[\s_-]?(?:360|500)|\d\+?(?:[\s_-]?(?:SC|S|C))?)(?![A-Za-z0-9])/i;

function findModelInText(text: string): string | undefined {
  const m = MODEL_IN_TEXT.exec(text);
  return m ? normalizeMiboModel(m[0]) : undefined;
}

function fromRecord(rec: Record<string, unknown>): MiboQrResult {
  const entries = Object.entries(rec).map(([k, v]) => [normKey(k), v] as const);
  const pick = (keys: string[]) => {
    for (const key of keys) {
      const hit = entries.find(([k]) => k === key);
      if (hit && (typeof hit[1] === 'string' || typeof hit[1] === 'number')) {
        const v = String(hit[1]).trim();
        if (v) return v;
      }
    }
    return undefined;
  };
  const out: MiboQrResult = {};
  const serial = pick(SERIAL_KEYS);
  const model = pick(MODEL_KEYS);
  if (serial) out.serial = serial;
  if (model) out.model = normalizeMiboModel(model);
  return out;
}

/** Achata objetos aninhados ({ device: { sn } }) em um único nível. */
function flatten(
  obj: unknown,
  acc: Record<string, unknown> = {},
  depth = 0,
): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || depth > 3) return acc;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, acc, depth + 1);
    else if (!(k in acc)) acc[k] = v;
  }
  return acc;
}

function tryJson(raw: string): MiboQrResult | null {
  const t = raw.trim();
  if (!t.startsWith('{')) return null;
  try {
    return fromRecord(flatten(JSON.parse(t)));
  } catch {
    return null;
  }
}

function tryQuery(raw: string): MiboQrResult | null {
  const t = raw.trim();
  let params: URLSearchParams | null = null;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
      const url = new URL(t);
      params = new URLSearchParams(url.search);
      if (url.hash.includes('=')) {
        new URLSearchParams(url.hash.replace(/^#\??/, '')).forEach((v, k) => params!.append(k, v));
      }
    } else if (/^[^\s=&]+=[^&\s]*(&[^\s=&]+=[^&\s]*)*$/.test(t.replace(/^\?/, ''))) {
      params = new URLSearchParams(t.replace(/^\?/, ''));
    }
  } catch {
    return null;
  }
  if (!params || [...params.keys()].length === 0) return null;
  return fromRecord(Object.fromEntries(params.entries()));
}

function tryKeyValue(raw: string): MiboQrResult | null {
  const parts = raw
    .split(/[;\n\r,|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rec: Record<string, string> = {};
  for (const part of parts) {
    const m = /^([^:=]+)[:=](.*)$/.exec(part);
    if (m && m[1] && m[2] !== undefined) rec[m[1].trim()] = m[2].trim();
  }
  if (Object.keys(rec).length === 0) return null;
  return fromRecord(rec);
}

function tryToken(raw: string): MiboQrResult | null {
  const tokens = raw.match(/[A-Za-z0-9]{8,}/g) ?? [];
  // Preferimos tokens com letras e dígitos (padrão típico de serial).
  const candidates = tokens
    .filter((t) => /\d/.test(t) && !MODEL_IN_TEXT.test(t))
    .sort((a, b) => b.length - a.length);
  const serial = candidates[0];
  return serial ? { serial } : null;
}

export function parseMiboQr(raw: string): MiboQrResult {
  const text = (raw ?? '').trim();
  if (!text) return {};

  const strategies = [tryJson, tryQuery, tryKeyValue];
  let result: MiboQrResult = {};
  for (const strategy of strategies) {
    const r = strategy(text);
    if (r && (r.serial || r.model)) {
      result = r;
      break;
    }
  }
  if (!result.serial) {
    const token = tryToken(text);
    if (token?.serial) result = { ...result, serial: token.serial };
  }
  if (!result.model) {
    const model = findModelInText(text);
    if (model) result = { ...result, model };
  }
  return result;
}
