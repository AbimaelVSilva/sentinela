import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon, ScanEyeIcon, SquareDashedIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, type Camera, queryKeys } from '@/lib/api';
import { isCalibrationRunning, useCalibrate, useCalibration } from '@/hooks/useCalibration';
import { RoiEditor } from './RoiEditor';

/** Barra de ações da câmera: monitoramento, calibração e área da prateleira. */
export function CameraActions({ camera }: { camera: Camera }) {
  const qc = useQueryClient();
  const [roiOpen, setRoiOpen] = useState(false);
  const calib = useCalibration(camera.id);
  const calibrate = useCalibrate(camera.id);
  const running = isCalibrationRunning(calib) || calibrate.isPending;
  const online = camera.status === 'online';

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.updateCamera(camera.id, { monitoringEnabled: enabled }),
    onMutate: (enabled) => {
      qc.setQueryData<Camera>(queryKeys.camera(camera.id), (c) =>
        c ? { ...c, monitoringEnabled: enabled } : c,
      );
    },
    onSuccess: (cam) => {
      qc.setQueryData(queryKeys.camera(camera.id), cam);
      void qc.invalidateQueries({ queryKey: queryKeys.stores });
    },
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: queryKeys.camera(camera.id) });
      toast.error('Não foi possível alterar o monitoramento', { description: err.message });
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Switch
          id="monitoring"
          checked={camera.monitoringEnabled}
          onCheckedChange={(v) => toggle.mutate(v)}
          disabled={toggle.isPending}
        />
        <Label htmlFor="monitoring" className="cursor-pointer">
          Monitoramento
        </Label>
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={online ? -1 : 0}>
              <Button variant="outline" onClick={() => setRoiOpen(true)} disabled={!online}>
                <SquareDashedIcon /> Editar área da prateleira
              </Button>
            </span>
          </TooltipTrigger>
          {!online && <TooltipContent>A câmera precisa estar online</TooltipContent>}
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={online ? -1 : 0}>
              <Button onClick={() => calibrate.mutate(false)} disabled={!online || running}>
                {running ? <LoaderCircleIcon className="animate-spin" /> : <ScanEyeIcon />}
                {camera.baseline ? 'Memorizar de novo' : 'Memorizar prateleira'}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {online
              ? 'Valida o enquadramento, lista os produtos e salva a imagem de referência'
              : 'A câmera precisa estar online'}
          </TooltipContent>
        </Tooltip>
      </div>
      <RoiEditor camera={camera} open={roiOpen} onOpenChange={setRoiOpen} />
    </div>
  );
}
