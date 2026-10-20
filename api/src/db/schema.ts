import { sql } from 'drizzle-orm';
import type { AnalysisOverrides } from '../domain/analysis-settings';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Comparison, Inventory, RoiPolygon, SceneValidationResult } from '../domain/types';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const cameraStatusEnum = pgEnum('camera_status', ['pending', 'online', 'offline']);
export const snapshotKindEnum = pgEnum('snapshot_kind', [
  'baseline',
  'before',
  'after',
  'calibration',
]);
export const eventTypeEnum = pgEnum('event_type', [
  'removed',
  'moved',
  'no_change',
  'analysis_failed',
]);
export const eventSeverityEnum = pgEnum('event_severity', ['alert', 'attention', 'info', 'error']);

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address: text('address'),
  ...timestamps,
});

export const cameras = pgTable('cameras', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Protótipo: 1 câmera por loja. Para liberar N câmeras, basta remover `.unique()`
  // e gerar uma nova migration — nada mais depende dessa restrição.
  storeId: uuid('store_id')
    .notNull()
    .unique('cameras_store_id_unique')
    .references(() => stores.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  model: text('model'),
  serial: text('serial'),
  qrRaw: text('qr_raw'),
  streamKey: text('stream_key').notNull().unique(),
  status: cameraStatusEnum('status').notNull().default('pending'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  roi: jsonb('roi').$type<RoiPolygon>(),
  sceneValidation: jsonb('scene_validation').$type<SceneValidationResult>(),
  inventory: jsonb('inventory').$type<Inventory>(),
  baselineSnapshotId: uuid('baseline_snapshot_id').references((): AnyPgColumn => snapshots.id, {
    onDelete: 'set null',
  }),
  monitoringEnabled: boolean('monitoring_enabled').notNull().default(false),
  /** Parâmetros de análise personalizados (null = padrões do .env). */
  analysisSettings: jsonb('analysis_settings').$type<AnalysisOverrides>(),
  eventsSinceInventory: integer('events_since_inventory').notNull().default(0),
  ...timestamps,
});

export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cameraId: uuid('camera_id')
      .notNull()
      .references((): AnyPgColumn => cameras.id, { onDelete: 'cascade' }),
    kind: snapshotKindEnum('kind').notNull(),
    filePath: text('file_path').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('snapshots_camera_idx').on(t.cameraId, t.capturedAt)],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cameraId: uuid('camera_id')
      .notNull()
      .references(() => cameras.id, { onDelete: 'cascade' }),
    type: eventTypeEnum('type').notNull(),
    severity: eventSeverityEnum('severity').notNull(),
    personEnteredAt: timestamp('person_entered_at', { withTimezone: true }),
    personLeftAt: timestamp('person_left_at', { withTimezone: true }),
    beforeSnapshotId: uuid('before_snapshot_id').references(() => snapshots.id, {
      onDelete: 'set null',
    }),
    afterSnapshotId: uuid('after_snapshot_id').references(() => snapshots.id, {
      onDelete: 'set null',
    }),
    summary: text('summary').notNull().default(''),
    details: jsonb('details').$type<EventDetails>(),
    sceneDiffScore: real('scene_diff_score'),
    /** Vídeo curto da passagem (mp4 no storage), recortado das gravações do MediaMTX. */
    clipPath: text('clip_path'),
    clipDuration: real('clip_duration'),
    /** Quando o vídeo foi apagado pela retenção (ex.: "sem alteração" após 24 h). */
    clipDeletedAt: timestamp('clip_deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_camera_created_idx').on(t.cameraId, sql`${t.createdAt} desc`)],
);

export interface EventDetails {
  reason?: 'occlusion_timeout' | 'below_diff_threshold' | 'vision' | 'vision_error';
  comparison?: Comparison;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd?: number };
  roi?: RoiPolygon | null;
  crop?: { x: number; y: number; w: number; h: number } | null;
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Sempre em minúsculas. */
  username: text('username').notNull().unique(),
  name: text('name'),
  /** scrypt: `scrypt$<salt hex>$<hash hex>`. */
  passwordHash: text('password_hash').notNull(),
  ...timestamps,
});

/** Sessões de login: o token só existe no cliente; aqui fica o SHA-256 dele. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export type User = typeof users.$inferSelect;

/** Configurações globais editáveis pelo painel (uma linha, id = 'default'). */
export const appSettings = pgTable('app_settings', {
  id: text('id').primaryKey(),
  vision: jsonb('vision').$type<VisionSettings>(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type VisionProviderId = 'anthropic' | 'openai' | 'google' | 'mock';

export interface VisionSettings {
  provider: VisionProviderId;
  /** Modelo escolhido para cada provider (lembrado ao alternar). */
  models: Partial<Record<VisionProviderId, string>>;
  effort: 'low' | 'medium' | 'high';
}

export type Store = typeof stores.$inferSelect;
export type Camera = typeof cameras.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type CameraStatus = (typeof cameraStatusEnum.enumValues)[number];
export type EventType = (typeof eventTypeEnum.enumValues)[number];
export type EventSeverity = (typeof eventSeverityEnum.enumValues)[number];
