import { bus, type StreamInfo, type WorkerState } from '../../lib/bus';

/**
 * Estado em memória por câmera (não persistido): info do stream vinda do MediaMTX
 * e estado atual do worker de análise.
 */
const streams = new Map<string, StreamInfo>();
const workerStates = new Map<string, { state: WorkerState; since: string; queued?: boolean }>();

bus.on('camera.state', ({ cameraId, state, since, queued }) => {
  workerStates.set(cameraId, { state, since, queued });
});
bus.on('camera.deleted', ({ cameraId }) => {
  streams.delete(cameraId);
  workerStates.delete(cameraId);
});

export const runtime = {
  getStream: (cameraId: string) => streams.get(cameraId) ?? null,
  setStream: (cameraId: string, info: StreamInfo | null) => {
    if (info) streams.set(cameraId, info);
    else streams.delete(cameraId);
  },
  getWorker: (cameraId: string) => workerStates.get(cameraId) ?? null,
};
