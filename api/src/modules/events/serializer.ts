import { env } from '../../config/env';
import type { EventRow, EventSeverity, EventType, Snapshot } from '../../db/schema';
import { eventMeta } from '../../domain/classification';
import type { PurchaseCheck } from '../../domain/types';
import { fileUrl } from '../../storage';

export interface SnapshotDto {
  id: string;
  kind: Snapshot['kind'];
  url: string;
  width: number;
  height: number;
  capturedAt: string;
}

export interface EventDto {
  id: string;
  cameraId: string;
  type: EventType;
  severity: EventSeverity;
  label: string;
  personEnteredAt: string | null;
  personLeftAt: string | null;
  durationSeconds: number | null;
  summary: string;
  details: EventRow['details'];
  sceneDiffScore: number | null;
  createdAt: string;
  before: SnapshotDto | null;
  after: SnapshotDto | null;
  /** Vídeo curto da passagem (gerado alguns segundos depois do evento). */
  clip: { url: string; durationSeconds: number | null; expiresAt: string | null } | null;
  /** Quando o vídeo foi apagado pela retenção (null se nunca foi). */
  clipDeletedAt: string | null;
  /** Compras na loja durante a passagem (null = loja sem integração com a Klavi). */
  purchase: PurchaseCheck | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function serializeSnapshot(s: Snapshot | null | undefined): SnapshotDto | null {
  if (!s) return null;
  return {
    id: s.id,
    kind: s.kind,
    url: fileUrl(s.filePath),
    width: s.width,
    height: s.height,
    capturedAt: s.capturedAt.toISOString(),
  };
}

export function serializeEvent(
  e: EventRow,
  before?: Snapshot | null,
  after?: Snapshot | null,
): EventDto {
  const duration =
    e.personEnteredAt && e.personLeftAt
      ? Math.max(0, Math.round((e.personLeftAt.getTime() - e.personEnteredAt.getTime()) / 1000))
      : null;
  return {
    id: e.id,
    cameraId: e.cameraId,
    type: e.type,
    severity: e.severity,
    label: eventMeta(e.type, e.purchase).label,
    personEnteredAt: iso(e.personEnteredAt),
    personLeftAt: iso(e.personLeftAt),
    durationSeconds: duration,
    summary: e.summary,
    details: e.details,
    sceneDiffScore: e.sceneDiffScore,
    createdAt: e.createdAt.toISOString(),
    before: serializeSnapshot(before),
    after: serializeSnapshot(after),
    clip: e.clipPath
      ? {
          url: fileUrl(e.clipPath),
          durationSeconds: e.clipDuration,
          // Só passagens "sem alteração" têm prazo (retenção); as demais ficam guardadas.
          expiresAt:
            e.type === 'no_change'
              ? new Date(
                  e.createdAt.getTime() + env.CLIP_RETENTION_NO_CHANGE_HOURS * 3600 * 1000,
                ).toISOString()
              : null,
        }
      : null,
    clipDeletedAt: iso(e.clipDeletedAt),
    purchase: e.purchase ?? null,
  };
}
