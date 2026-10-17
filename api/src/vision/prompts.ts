import { z } from 'zod';
import type { Inventory } from '../domain/types';

/**
 * Prompts e schemas Zod das respostas da IA de visão.
 *
 * Os schemas "Api*" são enviados como JSON Schema (structured outputs) e evitam
 * restrições numéricas; a validação final (com limites e normalização) é feita
 * pelos schemas sem prefixo, depois de receber a resposta.
 */

// ---------- Tipos básicos ----------

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const ApiRegion = z.object({
  x: z.number().describe('canto esquerdo, fração 0..1 da largura da imagem'),
  y: z.number().describe('topo, fração 0..1 da altura da imagem'),
  w: z.number().describe('largura, fração 0..1'),
  h: z.number().describe('altura, fração 0..1'),
});

/** Normaliza para 0..1 e garante que o retângulo cabe na imagem. */
export const RegionSchema = ApiRegion.transform((r) => {
  const x = clamp01(r.x);
  const y = clamp01(r.y);
  return { x, y, w: clamp01(Math.min(r.w, 1 - x)), h: clamp01(Math.min(r.h, 1 - y)) };
});

// ---------- VALIDATE_SCENE ----------

export const ApiSceneValidation = z.object({
  isShelfScene: z.boolean(),
  viewAngle: z.enum(['top_down', 'high_angle', 'frontal', 'other']),
  productCountEstimate: z.number().int(),
  issues: z.array(z.string()),
});
export const SceneValidationSchema = ApiSceneValidation.extend({
  productCountEstimate: z
    .number()
    .int()
    .transform((n) => Math.max(0, n)),
  issues: z.array(z.string().trim().min(1)).max(10),
});

export const VALIDATE_SCENE_PROMPT = `A imagem é de uma câmera de segurança instalada em uma loja autônoma (sem atendentes).
Determine se ela mostra prateleiras, gôndolas ou expositores de loja com múltiplos produtos visíveis, vistos de cima ou em ângulo superior — o enquadramento ideal para perceber quando um produto é retirado ou mudado de lugar.

Responda com:
- isShelfScene: true somente se há prateleira/expositor com vários produtos distinguíveis.
- viewAngle: "top_down" (câmera praticamente vertical, olhando para baixo), "high_angle" (inclinada, de cima), "frontal" (na altura da prateleira) ou "other".
- productCountEstimate: estimativa do número de unidades de produtos visíveis.
- issues: lista curta (em português do Brasil) de problemas que atrapalham o monitoramento, por exemplo "muito escuro", "prateleira cortada", "ângulo frontal dificulta ver retiradas", "câmera desfocada", "reflexo forte", "produtos pequenos demais". Lista vazia se não houver problemas.`;

// ---------- INVENTORY ----------

const ApiInventoryItem = z.object({
  id: z.string().describe('identificador curto e estável: p1, p2, p3…'),
  label: z.string().describe('descrição curta identificável: marca, tipo, cor, embalagem'),
  quantity: z.number().int(),
  region: ApiRegion,
  shelfRow: z
    .number()
    .int()
    .nullable()
    .describe('fileira/prateleira, 1 = mais alta; null se não se aplica'),
});
export const ApiInventory = z.object({ items: z.array(ApiInventoryItem) });

export const InventorySchema = z.object({
  items: z
    .array(
      ApiInventoryItem.extend({
        label: z.string().trim().min(1),
        quantity: z
          .number()
          .int()
          .transform((n) => Math.max(1, n)),
        region: RegionSchema,
      }),
    )
    .max(200),
});

/**
 * Formato das regiões pedido à IA. `xywh` (frações 0..1) é o padrão; `box_2d`
 * ([ymin, xmin, ymax, xmax] em inteiros 0..1000) é o formato nativo do Gemini,
 * que localiza objetos com bem mais precisão nele.
 */
export type BoxFormat = 'xywh' | 'box_2d';

const BOX_2D_RULE =
  '[ymin, xmin, ymax, xmax] em inteiros de 0 a 1000, relativos à altura e largura da imagem';

export function inventoryPrompt(format: BoxFormat = 'xywh'): string {
  const regionRule =
    format === 'box_2d'
      ? `- box_2d: caixa justa em volta do item (ou grupo), ${BOX_2D_RULE};`
      : '- region: retângulo justo que envolve o item, em frações 0..1 da imagem (x, y = canto superior esquerdo);';
  return `A imagem mostra a prateleira de uma loja autônoma, vista por uma câmera de segurança.
Liste os produtos visíveis para servir de inventário de referência.

Para cada produto (ou grupo de unidades idênticas lado a lado):
- id: identificador curto e estável, em sequência: "p1", "p2", "p3"… (da esquerda para a direita, de cima para baixo);
- label: descrição curta que permita reconhecer o item em outra foto (marca, tipo, cor, embalagem, tamanho), em português;
- quantity: quantidade aproximada de unidades visíveis;
${regionRule}
- shelfRow: número da fileira (1 = mais alta) ou null.

A caixa deve cobrir só aquele produto/grupo, sem incluir prateleiras vizinhas ou outros produtos.
Não invente produtos que não estão visíveis. Ignore pessoas, mãos, etiquetas de preço e a estrutura da prateleira.`;
}

/** @deprecated use inventoryPrompt() */
export const INVENTORY_PROMPT = inventoryPrompt('xywh');

// ---------- COMPARE ----------

const ApiChange = z.object({
  itemId: z.string().nullable().describe('id do inventário, se o item estiver nele; senão null'),
  label: z.string(),
  change: z.enum(['removed', 'moved', 'added']),
  quantity: z.number().int(),
  beforeRegion: ApiRegion.nullable().describe(
    'onde o item estava na imagem ANTES (null para added)',
  ),
  afterRegion: ApiRegion.nullable().describe(
    'onde o item está na imagem DEPOIS (null para removed)',
  ),
  confidence: z.number().describe('0..1'),
});
export const ApiComparison = z.object({
  changes: z.array(ApiChange),
  summary: z.string(),
  overallConfidence: z.number(),
});

export const ComparisonSchema = z.object({
  changes: z
    .array(
      ApiChange.extend({
        label: z.string().trim().min(1),
        quantity: z
          .number()
          .int()
          .transform((n) => Math.max(1, n)),
        beforeRegion: RegionSchema.nullable(),
        afterRegion: RegionSchema.nullable(),
        confidence: z.number().transform(clamp01),
      }),
    )
    .max(50),
  summary: z.string().trim(),
  overallConfidence: z.number().transform(clamp01),
});

export function comparePrompt(inventoryContext: string | null, format: BoxFormat = 'xywh'): string {
  const regionRule =
    format === 'box_2d'
      ? `- Regiões (before_box_2d/after_box_2d): ${BOX_2D_RULE}, da imagem correspondente.`
      : '- Regiões (beforeRegion/afterRegion) em frações 0..1 da imagem correspondente (x, y = canto superior esquerdo).';
  return `Você recebe duas fotos da MESMA prateleira de uma loja autônoma, tiradas pela mesma câmera fixa:
a primeira imagem é ANTES e a segunda é DEPOIS de uma pessoa passar na frente da prateleira.
Sua tarefa é dizer o que mudou nos produtos.

Regras:
- Ignore diferenças de iluminação, sombra, balanço de branco, compressão de vídeo, ruído e pequenos deslocamentos da imagem inteira.
- Ignore pessoas, mãos ou braços residuais (não deveriam estar presentes; se estiverem, não conte como mudança de produto).
- "removed": o produto (ou parte das unidades) deixou de estar visível na prateleira.
- "moved": o mesmo produto continua na imagem, mas em outra posição.
- "added": um produto apareceu na prateleira onde antes não havia (inclui reposição).
- Para cada unidade retirada de um grupo, informe quantity com quantas unidades sumiram.
- Na dúvida entre movido e retirado, escolha a opção mais provável, use confidence baixa (< 0.5) e explique a dúvida no summary.
- Se nada mudou, retorne changes vazio.
${regionRule}
- summary: uma ou duas frases curtas em português do Brasil para o operador da loja (ex.: "1 lata de Coca-Cola retirada da 2ª prateleira").
- overallConfidence: confiança geral 0..1 na análise.
${
  inventoryContext
    ? `\nInventário de referência da prateleira (posições aproximadas na imagem ANTES; use os ids em itemId quando corresponder):\n${inventoryContext}`
    : ''
}`;
}

/** Inventário como contexto textual para o COMPARE (null se vazio). */
export function inventoryContext(
  inventory: Inventory | null,
  format: BoxFormat = 'xywh',
): string | null {
  if (!inventory?.items.length) return null;
  return inventory.items
    .map((i) => {
      const r = i.region;
      const pos =
        format === 'box_2d'
          ? `box_2d [${regionToBox2d(r).join(', ')}]`
          : `região x=${r.x.toFixed(2)} y=${r.y.toFixed(2)} w=${r.w.toFixed(2)} h=${r.h.toFixed(2)}`;
      return `- ${i.id}: ${i.label} (qtd ~${i.quantity}; ${pos})`;
    })
    .join('\n');
}

// ---------- Formato box_2d (Gemini) ----------

const ApiBox2d = z
  .array(z.number().int())
  .describe('[ymin, xmin, ymax, xmax] em inteiros de 0 a 1000');

/** Schemas enviados ao Gemini: mesmas respostas, com caixas em box_2d. */
export const GoogleApiInventory = z.object({
  items: z.array(ApiInventoryItem.omit({ region: true }).extend({ box_2d: ApiBox2d })),
});
export const GoogleApiComparison = ApiComparison.extend({
  changes: z.array(
    ApiChange.omit({ beforeRegion: true, afterRegion: true }).extend({
      before_box_2d: ApiBox2d.nullable().describe('onde estava na imagem ANTES (null para added)'),
      after_box_2d: ApiBox2d.nullable().describe('onde está na imagem DEPOIS (null para removed)'),
    }),
  ),
});

/** [ymin, xmin, ymax, xmax] 0..1000 → {x, y, w, h} 0..1 (tolera ordem invertida). */
export function box2dToRegion(box: unknown): { x: number; y: number; w: number; h: number } | null {
  if (!Array.isArray(box) || box.length !== 4 || box.some((n) => typeof n !== 'number'))
    return null;
  const [a, b, c, d] = (box as number[]).map((n) => Math.min(1000, Math.max(0, n)) / 1000);
  const y0 = Math.min(a!, c!);
  const y1 = Math.max(a!, c!);
  const x0 = Math.min(b!, d!);
  const x1 = Math.max(b!, d!);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function regionToBox2d(r: { x: number; y: number; w: number; h: number }): number[] {
  return [r.y, r.x, r.y + r.h, r.x + r.w].map((v) => Math.round(clamp01(v) * 1000));
}

/** Converte a resposta em box_2d para o formato comum (region/beforeRegion/afterRegion). */
export function fromBox2dResponse(json: unknown): unknown {
  if (!json || typeof json !== 'object') return json;
  const obj = json as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };
  if (Array.isArray(obj.items)) {
    out.items = obj.items.map((it) => {
      if (!it || typeof it !== 'object') return it;
      const { box_2d, ...rest } = it as Record<string, unknown>;
      return { ...rest, region: box2dToRegion(box_2d) };
    });
  }
  if (Array.isArray(obj.changes)) {
    out.changes = obj.changes.map((ch) => {
      if (!ch || typeof ch !== 'object') return ch;
      const { before_box_2d, after_box_2d, ...rest } = ch as Record<string, unknown>;
      return {
        ...rest,
        beforeRegion: before_box_2d == null ? null : box2dToRegion(before_box_2d),
        afterRegion: after_box_2d == null ? null : box2dToRegion(after_box_2d),
      };
    });
  }
  return out;
}

export const SYSTEM_PROMPT = `Você é o módulo de visão computacional do Sentinela, um sistema de monitoramento de prateleiras de lojas autônomas.
Analise as imagens com atenção a detalhes e responda somente com o JSON solicitado.
Textos para o operador devem estar em português do Brasil.`;

/** Mensagem de retry quando a resposta não passa na validação. */
export const retryPrompt = (problem: string) =>
  `A resposta anterior não passou na validação (${problem}). Responda novamente apenas com o JSON corrigido, seguindo o schema.`;

/** Extrai e valida o JSON da resposta; devolve o dado ou a descrição do problema. */
export function parseVisionJson<S extends z.ZodType>(
  schema: S,
  text: string,
  transform: (json: unknown) => unknown = (j) => j,
): { ok: true; data: z.output<S> } | { ok: false; problem: string } {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  try {
    const parsed = schema.safeParse(transform(JSON.parse(fenced?.[1] ?? text)));
    if (parsed.success) return { ok: true, data: parsed.data };
    return {
      ok: false,
      problem: parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
        .join('; '),
    };
  } catch (err) {
    return {
      ok: false,
      problem: `JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
