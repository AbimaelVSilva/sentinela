import { env } from '../../config/env';
import { defaultAnalysisSettings, resolveAnalysisSettings } from '../../domain/analysis-settings';
import type { Camera, Snapshot } from '../../db/schema';
import { serializeSnapshot } from '../events/serializer';
import { runtime } from './runtime';

export function rtmpInfo(streamKey: string) {
  const serverUrl = `${env.PUBLIC_RTMP_URL}/live`;
  return { serverUrl, streamKey, fullUrl: `${serverUrl}/${streamKey}` };
}

export function playbackUrls(streamKey: string) {
  return {
    whep: `${env.MEDIAMTX_WEBRTC_URL}/live/${streamKey}/whep`,
    hls: `${env.MEDIAMTX_HLS_URL}/live/${streamKey}/index.m3u8`,
  };
}

export function serializeCamera(c: Camera, baseline?: Snapshot | null) {
  const worker = runtime.getWorker(c.id);
  return {
    id: c.id,
    storeId: c.storeId,
    name: c.name,
    model: c.model,
    serial: c.serial,
    qrRaw: c.qrRaw,
    status: c.status,
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    roi: c.roi,
    sceneValidation: c.sceneValidation,
    inventory: c.inventory,
    baseline: serializeSnapshot(baseline),
    monitoringEnabled: c.monitoringEnabled,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    rtmp: rtmpInfo(c.streamKey),
    playback: playbackUrls(c.streamKey),
    stream: runtime.getStream(c.id),
    analysis: {
      /** Valores em vigor (personalizados + padrões). */
      effective: resolveAnalysisSettings(c.analysisSettings),
      /** Só o que foi personalizado nesta câmera. */
      overrides: c.analysisSettings ?? {},
      defaults: defaultAnalysisSettings(),
    },
    worker: worker ?? { state: c.status === 'online' ? 'DISABLED' : 'OFFLINE', since: null },
  };
}

export type CameraDto = ReturnType<typeof serializeCamera>;
