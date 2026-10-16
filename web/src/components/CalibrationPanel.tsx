import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2Icon,
  LoaderCircleIcon,
  PackageIcon,
  ScanEyeIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isCalibrationRunning, useCalibrate, useCalibration } from '@/hooks/useCalibration';
import { type Camera, type SceneValidation, queryKeys } from '@/lib/api';
import type { CalibrationMsg } from '@/lib/sse';

const STAGE_LABEL: Record<CalibrationMsg['stage'], string> = {
  capturing: 'Capturando imagem…',
  validating: 'Validando enquadramento…',
  inventorying: 'Listando produtos…',
  done: 'Prateleira memorizada',
  failed: 'Falha na calibração',
};

const ANGLE_LABEL: Record<SceneValidation['viewAngle'], string> = {
  top_down: 'vista de cima',
  high_angle: 'ângulo superior',
  frontal: 'frontal',
  other: 'outro ângulo',
};

/** Resultado/progresso da calibração e validação de cena, em um Alert. */
export function CalibrationPanel({ camera }: { camera: Camera }) {
  const qc = useQueryClient();
  const calib = useCalibration(camera.id);
  const calibrate = useCalibrate(camera.id);
  const running = isCalibrationRunning(calib);
  const validation = calib?.sceneValidation ?? camera.sceneValidation;

  if (!calib && !camera.sceneValidation) return null;

  const dismiss = () => qc.setQueryData(queryKeys.calibration(camera.id), null);

  if (running) {
    return (
      <Alert>
        <LoaderCircleIcon className="animate-spin" />
        <AlertTitle>Memorizando prateleira — {STAGE_LABEL[calib!.stage]}</AlertTitle>
        <AlertDescription>
          <Steps stage={calib!.stage} />
        </AlertDescription>
      </Alert>
    );
  }

  const failed = calib?.stage === 'failed';
  const notShelf = failed && validation && !validation.isShelfScene;

  if (failed && !notShelf) {
    return (
      <Alert variant="destructive">
        <XCircleIcon />
        <AlertTitle>Falha ao memorizar a prateleira</AlertTitle>
        <AlertDescription>
          <p>{calib?.error ?? calib?.message}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => calibrate.mutate(false)}>
              Tentar de novo
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Fechar
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (!validation) return null;
  const ok = validation.isShelfScene;
  const count = calib?.inventory?.items.length ?? camera.inventory?.items.length;

  return (
    <Alert className={ok ? 'border-success/40' : 'border-severity-attention/50'}>
      {ok ? (
        <CheckCircle2Icon className="text-success" />
      ) : (
        <TriangleAlertIcon className="text-severity-attention" />
      )}
      <AlertTitle>
        {ok
          ? validation.forced
            ? 'Prateleira memorizada (validação ignorada)'
            : 'Cena validada: prateleira com produtos'
          : 'A imagem não parece uma prateleira com produtos'}
      </AlertTitle>
      <AlertDescription>
        <p>
          {ANGLE_LABEL[validation.viewAngle]} · ~{validation.productCountEstimate} produtos visíveis
          {count != null && ok && (
            <>
              {' '}
              · <PackageIcon className="inline size-3.5" /> {count} itens no inventário
            </>
          )}
        </p>
        {validation.issues.length > 0 && (
          <ul className="mt-1 list-disc pl-4">
            {validation.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        {notShelf && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => calibrate.mutate(true)} disabled={calibrate.isPending}>
              Usar mesmo assim
            </Button>
            <Button size="sm" variant="outline" onClick={() => calibrate.mutate(false)}>
              Validar de novo
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

function Steps({ stage }: { stage: CalibrationMsg['stage'] }) {
  const order: CalibrationMsg['stage'][] = ['capturing', 'validating', 'inventorying'];
  const idx = order.indexOf(stage);
  return (
    <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {order.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          {i < idx ? (
            <CheckCircle2Icon className="size-3.5 text-success" />
          ) : i === idx ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : (
            <ScanEyeIcon className="size-3.5 opacity-40" />
          )}
          {STAGE_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}
