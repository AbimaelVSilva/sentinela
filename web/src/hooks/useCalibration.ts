import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, queryKeys } from '@/lib/api';
import type { CalibrationMsg } from '@/lib/sse';

/** Último progresso de calibração recebido por SSE (fica no cache do TanStack Query). */
export function useCalibration(cameraId: string) {
  return useQuery<CalibrationMsg | null>({
    queryKey: queryKeys.calibration(cameraId),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
    initialData: null,
  }).data;
}

export function useCalibrate(cameraId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) => api.calibrate(cameraId, { force }),
    onMutate: () => {
      qc.setQueryData<CalibrationMsg>(queryKeys.calibration(cameraId), {
        cameraId,
        stage: 'capturing',
        message: 'Iniciando…',
      });
    },
    onError: (err) => {
      qc.setQueryData(queryKeys.calibration(cameraId), null);
      toast.error('Não foi possível iniciar a calibração', { description: err.message });
    },
  });
}

export const isCalibrationRunning = (c: CalibrationMsg | null) =>
  !!c && c.stage !== 'done' && c.stage !== 'failed';
