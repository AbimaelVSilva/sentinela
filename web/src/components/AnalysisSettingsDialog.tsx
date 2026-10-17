import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon, RotateCcwIcon, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { InfoTip } from '@/components/InfoTip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type AnalysisPatch, type AnalysisSettings, api, type Camera, queryKeys } from '@/lib/api';
import { cn } from '@/lib/utils';

type NumKey = Exclude<keyof AnalysisSettings, 'prefilterEnabled'>;

interface FieldDef {
  key: NumKey;
  label: string;
  help: string;
  /** percent: o valor salvo é fração 0..1 e a tela mostra em %. */
  kind: 'percent' | 'int' | 'seconds' | 'fps';
  min: number;
  max: number;
  step: number;
}

const DETECTION: FieldDef[] = [
  {
    key: 'personConfidence',
    label: 'Confiança mínima da pessoa',
    help: 'Abaixo disso a detecção é ignorada. Menor = detecta mais, com mais falsos alarmes.',
    kind: 'percent',
    min: 10,
    max: 95,
    step: 5,
  },
  {
    key: 'roiOverlapMin',
    label: 'Sobreposição mínima com a área',
    help: 'Quanto do corpo da pessoa precisa estar sobre a área da prateleira.',
    kind: 'percent',
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'enterConsecutiveFrames',
    label: 'Frames seguidos para ocupar',
    help: 'Quantos frames seguidos com pessoa para começar uma ocupação.',
    kind: 'int',
    min: 1,
    max: 20,
    step: 1,
  },
  {
    key: 'analysisFps',
    label: 'Frames analisados por segundo',
    help: 'Mais frames reagem mais rápido, mas usam mais CPU do servidor.',
    kind: 'fps',
    min: 1,
    max: 10,
    step: 1,
  },
];

const TIMING: FieldDef[] = [
  {
    key: 'clearSeconds',
    label: 'Tempo para considerar a saída',
    help: 'Tempo contínuo sem pessoa na área para considerar que ela saiu.',
    kind: 'seconds',
    min: 0.5,
    max: 30,
    step: 0.5,
  },
  {
    key: 'stableSeconds',
    label: 'Tempo de cena parada',
    help: 'A foto "depois" só é tirada após a cena ficar parada por esse tempo.',
    kind: 'seconds',
    min: 0.25,
    max: 30,
    step: 0.25,
  },
  {
    key: 'stableDiffMax',
    label: 'Variação máxima da cena parada',
    help: 'Diferença máxima entre frames seguidos para considerar a cena parada.',
    kind: 'percent',
    min: 0.1,
    max: 20,
    step: 0.1,
  },
  {
    key: 'stableMaxWaitSeconds',
    label: 'Espera máxima pela cena parada',
    help: 'Se a cena nunca parar, a foto "depois" é tirada mesmo assim após esse tempo.',
    kind: 'seconds',
    min: 1,
    max: 120,
    step: 1,
  },
  {
    key: 'maxOcclusionSeconds',
    label: 'Oclusão prolongada',
    help: 'Pessoa parada na frente da prateleira por mais tempo gera um evento de oclusão.',
    kind: 'seconds',
    min: 30,
    max: 7200,
    step: 30,
  },
];

const PREFILTER_FIELD: FieldDef = {
  key: 'sceneDiffMin',
  label: 'Limiar de mudança',
  help: 'Se menos que isso da área da prateleira mudar, a passagem é registrada como "sem alteração" sem chamar a IA. Menor = mais sensível (mais chamadas à IA).',
  kind: 'percent',
  min: 0,
  max: 20,
  step: 0.1,
};

const ALL_FIELDS = [PREFILTER_FIELD, ...DETECTION, ...TIMING];
const UNIT: Record<FieldDef['kind'], string> = { percent: '%', int: '', seconds: 's', fps: 'fps' };

const toDisplay = (f: FieldDef, v: number) =>
  f.kind === 'percent' ? String(Number((v * 100).toFixed(2))) : String(v);
const fromDisplay = (f: FieldDef, s: string) => {
  const n = Number(s.replace(',', '.'));
  return f.kind === 'percent' ? n / 100 : n;
};
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Engrenagem na tela da câmera: abre as configurações da análise desta câmera. */
export function AnalysisSettingsButton({ camera }: { camera: Camera }) {
  const [open, setOpen] = useState(false);
  const customized = Object.keys(camera.analysis.overrides).length;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Configurações da análise"
            onClick={() => setOpen(true)}
            className="relative"
          >
            <SettingsIcon />
            {customized > 0 && (
              <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-severity-attention ring-2 ring-background" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Configurações da análise{customized > 0 && ` (${customized} personalizada(s))`}
        </TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[92svh] overflow-y-auto sm:max-w-2xl"
          // Sem foco automático: senão o primeiro ícone de info abre o tooltip ao abrir o modal.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Configurações da análise</DialogTitle>
            <DialogDescription>
              Ajustes desta câmera. Valem imediatamente; o que não for alterado segue o padrão do
              servidor.
            </DialogDescription>
          </DialogHeader>
          {open && <AnalysisForm camera={camera} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AnalysisForm({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const qc = useQueryClient();
  const { effective, defaults } = camera.analysis;
  const [prefilter, setPrefilter] = useState(effective.prefilterEnabled);
  const [values, setValues] = useState<Record<NumKey, string>>(
    () =>
      Object.fromEntries(ALL_FIELDS.map((f) => [f.key, toDisplay(f, effective[f.key])])) as Record<
        NumKey,
        string
      >,
  );

  const errors: Partial<Record<NumKey, string>> = {};
  for (const f of ALL_FIELDS) {
    const raw = values[f.key].trim();
    const n = Number(raw.replace(',', '.'));
    if (raw === '' || Number.isNaN(n)) errors[f.key] = 'Informe um número';
    else if (n < f.min || n > f.max) errors[f.key] = `Entre ${f.min} e ${f.max}${UNIT[f.kind]}`;
    else if (f.kind === 'int' && !Number.isInteger(n)) errors[f.key] = 'Use um número inteiro';
  }
  const hasErrors = Object.keys(errors).length > 0;

  /** Monta o PATCH: igual ao padrão → null (remove personalização). */
  const buildPatch = (): AnalysisPatch => {
    const patch: AnalysisPatch = {};
    patch.prefilterEnabled = prefilter === defaults.prefilterEnabled ? null : prefilter;
    for (const f of ALL_FIELDS) {
      const v = fromDisplay(f, values[f.key]);
      patch[f.key] = same(v, defaults[f.key]) ? null : v;
    }
    return patch;
  };

  const save = useMutation({
    mutationFn: () => api.updateCamera(camera.id, { analysisSettings: buildPatch() }),
    onSuccess: (cam) => {
      qc.setQueryData(queryKeys.camera(camera.id), cam);
      toast.success('Configurações da análise salvas', {
        description: cam.analysis.effective.prefilterEnabled
          ? undefined
          : 'Pré-filtro desligado: toda passagem será analisada pela IA.',
      });
      onClose();
    },
    onError: (err) => toast.error('Não foi possível salvar', { description: err.message }),
  });

  const resetAll = () => {
    setPrefilter(defaults.prefilterEnabled);
    setValues(
      Object.fromEntries(ALL_FIELDS.map((f) => [f.key, toDisplay(f, defaults[f.key])])) as Record<
        NumKey,
        string
      >,
    );
  };

  const field = (f: FieldDef, disabled = false) => {
    const isDefault = !errors[f.key] && same(fromDisplay(f, values[f.key]), defaults[f.key]);
    return (
      <div key={f.key} className={cn('grid gap-1.5', disabled && 'opacity-50')}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`as-${f.key}`}>{f.label}</Label>
            <InfoTip label={`Sobre: ${f.label}`}>{f.help}</InfoTip>
          </div>
          {isDefault ? (
            <span className="text-xs text-muted-foreground">padrão</span>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-severity-attention hover:underline"
              onClick={() => setValues((v) => ({ ...v, [f.key]: toDisplay(f, defaults[f.key]) }))}
              disabled={disabled}
            >
              <RotateCcwIcon className="size-3" /> padrão: {toDisplay(f, defaults[f.key])}
              {UNIT[f.kind]}
            </button>
          )}
        </div>
        <div className="relative">
          <Input
            id={`as-${f.key}`}
            type="number"
            inputMode="decimal"
            min={f.min}
            max={f.max}
            step={f.step}
            value={values[f.key]}
            disabled={disabled}
            aria-invalid={!!errors[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className="pr-10"
          />
          {UNIT[f.kind] && (
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
              {UNIT[f.kind]}
            </span>
          )}
        </div>
        {errors[f.key] && <p className="text-xs text-destructive">{errors[f.key]}</p>}
      </div>
    );
  };

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="as-prefilter" className="text-sm">
              Pré-filtro de diferença
            </Label>
            <InfoTip label="Sobre: Pré-filtro de diferença">
              Compara antes/depois e só chama a IA se a prateleira mudou. Desligado, toda passagem é
              analisada pela IA (mais preciso para itens pequenos, mais caro).
            </InfoTip>
          </div>
          <div className="flex items-center gap-2">
            {prefilter !== defaults.prefilterEnabled && (
              <Badge variant="outline">personalizado</Badge>
            )}
            <Switch id="as-prefilter" checked={prefilter} onCheckedChange={setPrefilter} />
          </div>
        </div>
        {field(PREFILTER_FIELD, !prefilter)}
      </section>

      <section className="grid gap-3">
        <h3 className="text-sm font-medium">Detecção de pessoa</h3>
        <div className="grid gap-4 sm:grid-cols-2">{DETECTION.map((f) => field(f))}</div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-sm font-medium">Tempos</h3>
        <div className="grid gap-4 sm:grid-cols-2">{TIMING.map((f) => field(f))}</div>
      </section>

      <Separator />
      <DialogFooter className="flex-row flex-wrap items-center sm:justify-between">
        <Button variant="ghost" onClick={resetAll}>
          <RotateCcwIcon /> Restaurar padrões
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={hasErrors || save.isPending}>
            {save.isPending && <LoaderCircleIcon className="animate-spin" />} Salvar
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}
