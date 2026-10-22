import { z } from 'zod';
import { env } from '../config/env';

/**
 * Parâmetros de análise ajustáveis por câmera (tela da câmera → engrenagem).
 * O que não for personalizado usa o padrão do .env.
 */
export const ANALYSIS_LIMITS = {
  prefilterEnabled: null,
  sceneDiffMin: [0, 0.2],
  personConfidence: [0.1, 0.95],
  roiOverlapMin: [0.01, 1],
  enterConsecutiveFrames: [1, 20],
  clearSeconds: [0.5, 30],
  stableSeconds: [0.25, 30],
  stableDiffMax: [0.001, 0.2],
  stableMaxWaitSeconds: [1, 120],
  maxOcclusionSeconds: [30, 7200],
  analysisFps: [1, 10],
  analysisMode: null,
  imageMaxSide: [512, 1920],
} as const;

const range = (min: number, max: number) =>
  z.number().min(min, `mínimo ${min}`).max(max, `máximo ${max}`);

export const AnalysisSettingsSchema = z.object({
  /** Se falso, toda passagem vai para a IA (o score do diff ainda é registrado). */
  prefilterEnabled: z.boolean(),
  sceneDiffMin: range(...ANALYSIS_LIMITS.sceneDiffMin),
  personConfidence: range(...ANALYSIS_LIMITS.personConfidence),
  roiOverlapMin: range(...ANALYSIS_LIMITS.roiOverlapMin),
  enterConsecutiveFrames: range(...ANALYSIS_LIMITS.enterConsecutiveFrames).int(),
  clearSeconds: range(...ANALYSIS_LIMITS.clearSeconds),
  stableSeconds: range(...ANALYSIS_LIMITS.stableSeconds),
  stableDiffMax: range(...ANALYSIS_LIMITS.stableDiffMax),
  stableMaxWaitSeconds: range(...ANALYSIS_LIMITS.stableMaxWaitSeconds),
  maxOcclusionSeconds: range(...ANALYSIS_LIMITS.maxOcclusionSeconds),
  analysisFps: range(...ANALYSIS_LIMITS.analysisFps),
  /** full = identifica o produto; removal = só responde se algo saiu e quantos. */
  analysisMode: z.enum(['full', 'removal']),
  /** Maior lado (px) das fotos antes/depois enviadas à IA: menor = mais barato. */
  imageMaxSide: range(...ANALYSIS_LIMITS.imageMaxSide).int(),
});

export type AnalysisSettings = z.infer<typeof AnalysisSettingsSchema>;
/** Personalizações salvas na câmera (campos ausentes = padrão). */
export type AnalysisOverrides = Partial<AnalysisSettings>;

/** Corpo do PATCH: valor novo, ou null para voltar ao padrão. */
export const AnalysisPatchSchema = z
  .object(
    Object.fromEntries(
      Object.entries(AnalysisSettingsSchema.shape).map(([k, v]) => [k, v.nullable().optional()]),
    ) as {
      [K in keyof AnalysisSettings]: z.ZodOptional<
        z.ZodNullable<(typeof AnalysisSettingsSchema.shape)[K]>
      >;
    },
  )
  .strict();

export function defaultAnalysisSettings(): AnalysisSettings {
  return {
    prefilterEnabled: true,
    sceneDiffMin: env.SCENE_DIFF_MIN,
    personConfidence: env.PERSON_CONFIDENCE,
    roiOverlapMin: env.ROI_OVERLAP_MIN,
    enterConsecutiveFrames: env.ENTER_CONSECUTIVE_FRAMES,
    clearSeconds: env.CLEAR_SECONDS,
    stableSeconds: env.STABLE_SECONDS,
    stableDiffMax: env.STABLE_DIFF_MAX,
    stableMaxWaitSeconds: env.STABLE_MAX_WAIT_SECONDS,
    maxOcclusionSeconds: env.MAX_OCCLUSION_SECONDS,
    analysisFps: env.ANALYSIS_FPS,
    analysisMode: env.ANALYSIS_MODE,
    imageMaxSide: env.VISION_IMAGE_MAX_SIDE,
  };
}

export function resolveAnalysisSettings(
  overrides: AnalysisOverrides | null | undefined,
): AnalysisSettings {
  const base = defaultAnalysisSettings();
  if (!overrides) return base;
  const clean = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null),
  );
  return { ...base, ...clean };
}

/** Aplica um PATCH (null remove a personalização). */
export function mergeAnalysisOverrides(
  current: AnalysisOverrides | null | undefined,
  patch: z.infer<typeof AnalysisPatchSchema>,
): AnalysisOverrides | null {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length ? (next as AnalysisOverrides) : null;
}
