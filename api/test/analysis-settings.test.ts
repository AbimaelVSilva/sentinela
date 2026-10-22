import { describe, expect, it } from 'vitest';
import {
  AnalysisPatchSchema,
  defaultAnalysisSettings,
  mergeAnalysisOverrides,
  resolveAnalysisSettings,
} from '../src/domain/analysis-settings';

describe('configurações de análise por câmera', () => {
  it('sem personalização usa os padrões (pré-filtro ligado)', () => {
    const s = resolveAnalysisSettings(null);
    expect(s).toEqual(defaultAnalysisSettings());
    expect(s.prefilterEnabled).toBe(true);
  });

  it('personalizações sobrescrevem só os campos definidos', () => {
    const s = resolveAnalysisSettings({ prefilterEnabled: false, sceneDiffMin: 0.02 });
    expect(s.prefilterEnabled).toBe(false);
    expect(s.sceneDiffMin).toBe(0.02);
    expect(s.clearSeconds).toBe(defaultAnalysisSettings().clearSeconds);
  });

  it('PATCH com null volta ao padrão; sem campos vira null', () => {
    const a = mergeAnalysisOverrides(null, { prefilterEnabled: false, clearSeconds: 4 });
    expect(a).toEqual({ prefilterEnabled: false, clearSeconds: 4 });
    const b = mergeAnalysisOverrides(a, { clearSeconds: null });
    expect(b).toEqual({ prefilterEnabled: false });
    expect(mergeAnalysisOverrides(b, { prefilterEnabled: null })).toBeNull();
  });

  it('modo de análise e tamanho da foto: padrão full/1568 e valores válidos', () => {
    const d = defaultAnalysisSettings();
    expect(d.analysisMode).toBe('full');
    expect(d.imageMaxSide).toBe(1568);
    expect(resolveAnalysisSettings({ analysisMode: 'removal' }).analysisMode).toBe('removal');
    expect(AnalysisPatchSchema.safeParse({ analysisMode: 'removal' }).success).toBe(true);
    expect(AnalysisPatchSchema.safeParse({ analysisMode: 'outro' }).success).toBe(false);
    expect(AnalysisPatchSchema.safeParse({ imageMaxSide: 1024 }).success).toBe(true);
    expect(AnalysisPatchSchema.safeParse({ imageMaxSide: 300 }).success).toBe(false);
    expect(AnalysisPatchSchema.safeParse({ imageMaxSide: 1000.5 }).success).toBe(false);
  });

  it('valida limites e rejeita campos desconhecidos', () => {
    expect(AnalysisPatchSchema.safeParse({ sceneDiffMin: 0.5 }).success).toBe(false);
    expect(AnalysisPatchSchema.safeParse({ enterConsecutiveFrames: 2.5 }).success).toBe(false);
    expect(AnalysisPatchSchema.safeParse({ foo: 1 }).success).toBe(false);
    expect(AnalysisPatchSchema.safeParse({ sceneDiffMin: null, analysisFps: 2 }).success).toBe(
      true,
    );
  });
});
