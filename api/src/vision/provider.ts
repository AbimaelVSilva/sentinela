import type { z } from 'zod';
import type { Comparison, Inventory, RemovalCheck, SceneValidation } from '../domain/types';

export interface VisionUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
  model?: string;
}

/** Resultado de uma chamada, com o uso de tokens para estimar custo. */
export interface VisionResult<T> {
  data: T;
  usage: VisionUsage;
}

/**
 * Provider plugável de visão. Imagens são JPEG.
 * Para `compare`, as imagens já chegam recortadas na ROI e as regiões retornadas
 * são relativas à imagem recebida.
 */
export interface VisionProvider {
  readonly name: string;
  validateScene(image: Buffer): Promise<VisionResult<SceneValidation>>;
  inventory(image: Buffer): Promise<VisionResult<Inventory>>;
  compare(
    before: Buffer,
    after: Buffer,
    inventory: Inventory | null,
  ): Promise<VisionResult<Comparison>>;
  /** Modo "só retirada": algum produto do ANTES sumiu no DEPOIS? Quantos? */
  checkRemoval(before: Buffer, after: Buffer): Promise<VisionResult<RemovalCheck>>;
}

export class VisionError extends Error {
  readonly usage: VisionUsage | null;
  constructor(message: string, usage: VisionUsage | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VisionError';
    this.usage = usage;
  }
}

export type Parsed<S extends z.ZodType> = z.output<S>;

/**
 * Custo estimado em USD a partir de uma tabela de preços (USD por milhão de tokens).
 * VISION_PRICE_INPUT_PER_MTOK / VISION_PRICE_OUTPUT_PER_MTOK sobrescrevem a tabela.
 */
export function estimateCost(
  model: string,
  input: number,
  output: number,
  table: [RegExp, number, number][],
  override?: { input?: number; output?: number },
): number | undefined {
  const row = table.find(([re]) => re.test(model));
  const pin = override?.input ?? row?.[1];
  const pout = override?.output ?? row?.[2];
  if (pin === undefined || pout === undefined) return undefined;
  return (input * pin + output * pout) / 1_000_000;
}
