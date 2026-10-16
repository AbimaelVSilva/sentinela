import type { z } from 'zod';
import type { Comparison, Inventory, SceneValidation } from '../domain/types';

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
