import { beforeEach, describe, expect, it } from 'vitest';
import type { Detection } from '../src/pipeline/person-detector';
import {
  type AnalysisRequest,
  CameraStateMachine,
  type MachineParams,
  type MachineState,
} from '../src/pipeline/state-machine';
import { silentLog } from './helpers';

const PARAMS: MachineParams = {
  personConfidence: 0.45,
  enterFrames: 3,
  clearMs: 2500,
  stableMs: 1500,
  stableDiffMax: 0.01,
  overlapMin: 0.15,
  maxOcclusionMs: 600_000,
  stableMaxWaitMs: 15_000,
};
const FRAME_MS = 250; // 4 fps
const ROI = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];
const PERSON_IN: Detection = { bbox: { x: 0.3, y: 0.1, w: 0.3, h: 0.8 }, confidence: 0.9 };
const PERSON_OUTSIDE: Detection = { bbox: { x: 0.85, y: 0.1, w: 0.14, h: 0.8 }, confidence: 0.9 };

function setup(params: Partial<MachineParams> = {}) {
  let now = 1_000_000;
  let detections: Detection[] = [];
  let diffValue = 0;
  let resolveAnalysis: (() => void) | null = null;
  const states: MachineState[] = [];
  const analyses: AnalysisRequest[] = [];
  const occlusions: number[] = [];

  const machine = new CameraStateMachine(
    { ...PARAMS, ...params },
    {
      detector: { detect: async () => detections },
      diff: async () => diffValue,
      now: () => now,
      log: silentLog,
      onState: (s) => states.push(s),
      analyze: (req) => {
        analyses.push(req);
        return new Promise<void>((r) => (resolveAnalysis = r));
      },
      occlusionTimeout: async ({ personEnteredAt }) => {
        occlusions.push(personEnteredAt);
      },
    },
  );

  const frame = Buffer.from('jpeg');
  return {
    machine,
    states,
    analyses,
    occlusions,
    get now() {
      return now;
    },
    /** Avança o relógio e processa `n` frames com as detecções dadas. */
    async frames(n: number, dets: Detection[], diff = 0) {
      detections = dets;
      diffValue = diff;
      for (let i = 0; i < n; i++) {
        now += FRAME_MS;
        await machine.processFrame(frame);
      }
    },
    finishAnalysis: async () => {
      resolveAnalysis?.();
      await machine.pendingAnalysis;
    },
  };
}

describe('CameraStateMachine', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.machine.configure({ monitoringEnabled: true, hasBaseline: true, roi: ROI });
  });

  it('DISABLED e NO_BASELINE não processam frames', async () => {
    const s = setup();
    s.machine.configure({ monitoringEnabled: false, hasBaseline: true, roi: ROI });
    expect(s.machine.state).toBe('DISABLED');
    s.machine.configure({ monitoringEnabled: true, hasBaseline: false, roi: ROI });
    expect(s.machine.state).toBe('NO_BASELINE');
    await s.frames(10, [PERSON_IN]);
    expect(s.machine.state).toBe('NO_BASELINE');
    expect(s.states).toEqual(['NO_BASELINE']);
  });

  it('entra em OCCUPIED só após N frames consecutivos com pessoa na ROI', async () => {
    expect(t.machine.state).toBe('IDLE');
    await t.frames(2, [PERSON_IN]);
    await t.frames(1, []); // quebra a sequência
    await t.frames(2, [PERSON_IN]);
    expect(t.machine.state).toBe('IDLE');
    await t.frames(1, [PERSON_IN]);
    expect(t.machine.state).toBe('OCCUPIED');
  });

  it('ignora detecções abaixo da confiança mínima da câmera', async () => {
    await t.frames(5, [{ ...PERSON_IN, confidence: 0.3 }]);
    expect(t.machine.state).toBe('IDLE');
    t.machine.setParams({ ...PARAMS, personConfidence: 0.25 });
    await t.frames(3, [{ ...PERSON_IN, confidence: 0.3 }]);
    expect(t.machine.state).toBe('OCCUPIED');
  });

  it('ignora pessoas fora da ROI', async () => {
    await t.frames(10, [PERSON_OUTSIDE]);
    expect(t.machine.state).toBe('IDLE');
  });

  it('fluxo completo OCCUPIED → WAITING_CLEAR → WAITING_STABLE → ANALYZING → IDLE', async () => {
    const enteredAt = t.now + FRAME_MS;
    await t.frames(3, [PERSON_IN]);
    expect(t.machine.state).toBe('OCCUPIED');
    await t.frames(8, [PERSON_IN]);

    await t.frames(1, []);
    expect(t.machine.state).toBe('WAITING_CLEAR');
    const leftAt = t.now;

    // pessoa reaparece antes de CLEAR_SECONDS → volta para OCCUPIED
    await t.frames(4, []);
    await t.frames(1, [PERSON_IN]);
    expect(t.machine.state).toBe('OCCUPIED');

    await t.frames(1, []);
    const clearAt = t.now;
    await t.frames(10, []); // 2.5 s
    expect(t.machine.state).toBe('WAITING_STABLE');

    // cena instável (diff alto) mantém a espera
    await t.frames(8, [], 0.05);
    expect(t.machine.state).toBe('WAITING_STABLE');

    // estável por 1.5 s → captura e analisa
    await t.frames(7, [], 0.001);
    expect(t.machine.state).toBe('ANALYZING');
    expect(t.analyses).toHaveLength(1);
    expect(t.analyses[0]!.personEnteredAt).toBe(enteredAt);
    expect(t.analyses[0]!.personLeftAt).toBe(clearAt);
    expect(clearAt).toBeGreaterThan(leftAt);

    await t.finishAnalysis();
    expect(t.machine.state).toBe('IDLE');
    expect(t.states).toEqual([
      'IDLE',
      'OCCUPIED',
      'WAITING_CLEAR',
      'OCCUPIED',
      'WAITING_CLEAR',
      'WAITING_STABLE',
      'ANALYZING',
      'IDLE',
    ]);
  });

  it('pessoa durante a análise é enfileirada e a ocupação começa ao terminar', async () => {
    await t.frames(3, [PERSON_IN]);
    await t.frames(11, []);
    await t.frames(8, [], 0);
    expect(t.machine.state).toBe('ANALYZING');

    await t.frames(3, [PERSON_IN]);
    expect(t.machine.state).toBe('ANALYZING');
    await t.finishAnalysis();
    expect(t.machine.state).toBe('OCCUPIED');
    expect(t.analyses).toHaveLength(1);
  });

  it('captura mesmo sem estabilizar após STABLE_MAX_WAIT', async () => {
    await t.frames(3, [PERSON_IN]);
    await t.frames(11, []);
    expect(t.machine.state).toBe('WAITING_STABLE');
    await t.frames(59, [], 0.5);
    expect(t.machine.state).toBe('WAITING_STABLE');
    await t.frames(2, [], 0.5);
    expect(t.machine.state).toBe('ANALYZING');
  });

  it('registra oclusão prolongada uma única vez', async () => {
    const s = setup({ maxOcclusionMs: 5000 });
    s.machine.configure({ monitoringEnabled: true, hasBaseline: true, roi: ROI });
    await s.frames(3, [PERSON_IN]);
    await s.frames(30, [PERSON_IN]);
    expect(s.occlusions).toHaveLength(1);
    expect(s.machine.state).toBe('OCCUPIED');
  });

  it('desligar o monitoramento interrompe a ocupação', async () => {
    await t.frames(3, [PERSON_IN]);
    t.machine.configure({ monitoringEnabled: false, hasBaseline: true, roi: ROI });
    expect(t.machine.state).toBe('DISABLED');
    await t.frames(5, []);
    expect(t.machine.state).toBe('DISABLED');
  });

  it('sem ROI, qualquer pessoa no frame ocupa', async () => {
    const s = setup();
    s.machine.configure({ monitoringEnabled: true, hasBaseline: true, roi: null });
    await s.frames(3, [PERSON_OUTSIDE]);
    expect(s.machine.state).toBe('OCCUPIED');
  });
});
