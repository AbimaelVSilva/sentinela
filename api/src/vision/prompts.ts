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

export const INVENTORY_PROMPT = `A imagem mostra a prateleira de uma loja autônoma, vista por uma câmera de segurança.
Liste os produtos visíveis para servir de inventário de referência.

Para cada produto (ou grupo de unidades idênticas lado a lado):
- id: identificador curto e estável, em sequência: "p1", "p2", "p3"… (da esquerda para a direita, de cima para baixo);
- label: descrição curta que permita reconhecer o item em outra foto (marca, tipo, cor, embalagem, tamanho), em português;
- quantity: quantidade aproximada de unidades visíveis;
- region: retângulo que envolve o item, em frações 0..1 da imagem (x, y = canto superior esquerdo);
- shelfRow: número da fileira (1 = mais alta) ou null.

Não invente produtos que não estão visíveis. Ignore pessoas, mãos, etiquetas de preço e a estrutura da prateleira.`;

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

export function comparePrompt(inventoryContext: string | null): string {
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
- Regiões (beforeRegion/afterRegion) em frações 0..1 da imagem correspondente (x, y = canto superior esquerdo).
- summary: uma ou duas frases curtas em português do Brasil para o operador da loja (ex.: "1 lata de Coca-Cola retirada da 2ª prateleira").
- overallConfidence: confiança geral 0..1 na análise.
${
  inventoryContext
    ? `\nInventário de referência da prateleira (posições aproximadas na imagem ANTES; use os ids em itemId quando corresponder):\n${inventoryContext}`
    : ''
}`;
}

/** Inventário como contexto textual para o COMPARE (null se vazio). */
export function inventoryContext(inventory: Inventory | null): string | null {
  if (!inventory?.items.length) return null;
  return inventory.items
    .map(
      (i) =>
        `- ${i.id}: ${i.label} (qtd ~${i.quantity}; região x=${i.region.x.toFixed(2)} y=${i.region.y.toFixed(2)} w=${i.region.w.toFixed(2)} h=${i.region.h.toFixed(2)})`,
    )
    .join('\n');
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
): { ok: true; data: z.output<S> } | { ok: false; problem: string } {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  try {
    const parsed = schema.safeParse(JSON.parse(fenced?.[1] ?? text));
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
