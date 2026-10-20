import { getToken, setToken, withToken } from './auth-token';

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ??
  'http://localhost:3333';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Json = Record<string, unknown> | unknown[];

export async function apiFetch<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: Json } = {},
): Promise<T> {
  const { body, headers, ...rest } = init;
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar à API.', null);
  }
  // Sessão inválida/expirada: descarta o token; o app redireciona para o login.
  if (res.status === 401 && token && path !== '/auth/login') setToken(null);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : null) ?? `Erro ${res.status}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const fileUrl = (path: string | null | undefined) =>
  path ? (path.startsWith('http') ? path : withToken(`${API_URL}${path}`)) : undefined;

// ---------- Tipos da API ----------

export interface Health {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  db: boolean;
  mediamtx: boolean;
  detector: boolean;
  vision: { provider: string; model: string };
  time: string;
}

export type CameraStatus = 'pending' | 'online' | 'offline';
export type WorkerState =
  | 'OFFLINE'
  | 'DISABLED'
  | 'NO_BASELINE'
  | 'IDLE'
  | 'OCCUPIED'
  | 'WAITING_CLEAR'
  | 'WAITING_STABLE'
  | 'ANALYZING';
export type EventType = 'removed' | 'moved' | 'no_change' | 'analysis_failed';
export type Severity = 'alert' | 'attention' | 'info' | 'error';
export type CalibrationStage = 'capturing' | 'validating' | 'inventorying' | 'done' | 'failed';

export interface Point {
  x: number;
  y: number;
}
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneValidation {
  isShelfScene: boolean;
  viewAngle: 'top_down' | 'high_angle' | 'frontal' | 'other';
  productCountEstimate: number;
  issues: string[];
  validatedAt?: string;
  forced?: boolean;
  provider?: string;
  model?: string;
}

export interface InventoryItem {
  id: string;
  label: string;
  quantity: number;
  region: Region;
  shelfRow?: number | null;
}
export interface Inventory {
  items: InventoryItem[];
  updatedAt?: string;
}

export interface Change {
  itemId: string | null;
  label: string;
  change: 'removed' | 'moved' | 'added';
  quantity: number;
  beforeRegion: Region | null;
  afterRegion: Region | null;
  confidence: number;
}
export interface Comparison {
  changes: Change[];
  summary: string;
  overallConfidence: number;
}

export interface StreamInfo {
  ready: boolean;
  codecs: string[];
  videoCodec: string | null;
  isH265: boolean;
  readers: number;
}

export interface Snapshot {
  id: string;
  kind: 'baseline' | 'before' | 'after' | 'calibration';
  url: string;
  width: number;
  height: number;
  capturedAt: string;
}

export interface RtmpInfo {
  serverUrl: string;
  streamKey: string;
  fullUrl: string;
}

export interface AnalysisSettings {
  prefilterEnabled: boolean;
  sceneDiffMin: number;
  personConfidence: number;
  roiOverlapMin: number;
  enterConsecutiveFrames: number;
  clearSeconds: number;
  stableSeconds: number;
  stableDiffMax: number;
  stableMaxWaitSeconds: number;
  maxOcclusionSeconds: number;
  analysisFps: number;
}
export type AnalysisPatch = { [K in keyof AnalysisSettings]?: AnalysisSettings[K] | null };

export interface Camera {
  id: string;
  storeId: string;
  name: string;
  model: string | null;
  serial: string | null;
  qrRaw: string | null;
  status: CameraStatus;
  lastSeenAt: string | null;
  roi: Point[] | null;
  sceneValidation: SceneValidation | null;
  inventory: Inventory | null;
  baseline: Snapshot | null;
  monitoringEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  rtmp: RtmpInfo;
  playback: { whep: string; hls: string };
  stream: StreamInfo | null;
  worker: { state: WorkerState; since: string | null; queued?: boolean };
  analysis: {
    effective: AnalysisSettings;
    overrides: Partial<AnalysisSettings>;
    defaults: AnalysisSettings;
  };
}

export interface EventDetails {
  reason?: 'occlusion_timeout' | 'below_diff_threshold' | 'vision' | 'vision_error';
  comparison?: Comparison;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd?: number };
  roi?: Point[] | null;
  crop?: Region | null;
}

export interface SentinelaEvent {
  id: string;
  cameraId: string;
  type: EventType;
  severity: Severity;
  label: string;
  personEnteredAt: string | null;
  personLeftAt: string | null;
  durationSeconds: number | null;
  summary: string;
  details: EventDetails | null;
  sceneDiffScore: number | null;
  createdAt: string;
  before: Snapshot | null;
  after: Snapshot | null;
  /** Vídeo curto da passagem; fica pronto alguns segundos depois do evento. */
  clip: { url: string; durationSeconds: number | null; expiresAt: string | null } | null;
  /** Quando o vídeo foi apagado pela retenção. */
  clipDeletedAt: string | null;
}

export interface StoreCamera extends Camera {
  lastEvent: SentinelaEvent | null;
}

export interface Store {
  id: string;
  name: string;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  cameras: StoreCamera[];
  alerts24h: number;
}

export interface EventsPage {
  items: SentinelaEvent[];
  nextCursor: string | null;
}

export interface StoreInput {
  name: string;
  address?: string | null;
}
export interface CameraInput {
  name: string;
  model?: string | null;
  serial?: string | null;
  qrRaw?: string | null;
}
export interface CameraPatch {
  name?: string;
  model?: string | null;
  roi?: Point[] | null;
  monitoringEnabled?: boolean;
  analysisSettings?: AnalysisPatch;
}

export type VisionProviderId = 'anthropic' | 'openai' | 'google' | 'mock';
export type Effort = 'low' | 'medium' | 'high';

export interface ProviderInfo {
  id: VisionProviderId;
  label: string;
  configured: boolean;
  keyEnv: string | null;
  defaultModel: string;
  suggestedModels: string[];
}

export interface AppSettings {
  vision: {
    provider: VisionProviderId;
    model: string;
    effort: Effort;
    models: Partial<Record<VisionProviderId, string>>;
  };
  providers: ProviderInfo[];
}

export interface ModelList {
  models: string[];
  source: 'live' | 'suggested';
  error?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string | null;
}
export interface UserRow extends AuthUser {
  createdAt: string;
}
export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export const api = {
  health: () => apiFetch<Health>('/health'),

  login: (username: string, password: string) =>
    apiFetch<LoginResult>('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
  me: () => apiFetch<{ user: AuthUser }>('/auth/me'),
  listUsers: () => apiFetch<UserRow[]>('/users'),
  createUser: (body: { username: string; name?: string | null; password: string }) =>
    apiFetch<UserRow>('/users', { method: 'POST', body: { ...body } }),
  deleteUser: (id: string) => apiFetch<void>(`/users/${id}`, { method: 'DELETE' }),

  listStores: () => apiFetch<Store[]>('/stores'),
  getStore: (id: string) => apiFetch<Store>(`/stores/${id}`),
  createStore: (body: StoreInput) =>
    apiFetch<Store>('/stores', { method: 'POST', body: { ...body } }),
  updateStore: (id: string, body: StoreInput) =>
    apiFetch<Store>(`/stores/${id}`, { method: 'PATCH', body: { ...body } }),
  deleteStore: (id: string) => apiFetch<void>(`/stores/${id}`, { method: 'DELETE' }),

  createCamera: (storeId: string, body: CameraInput) =>
    apiFetch<{ camera: Camera; rtmp: RtmpInfo }>(`/stores/${storeId}/cameras`, {
      method: 'POST',
      body: { ...body },
    }),
  getCamera: (id: string) => apiFetch<Camera>(`/cameras/${id}`),
  updateCamera: (id: string, body: CameraPatch) =>
    apiFetch<Camera>(`/cameras/${id}`, { method: 'PATCH', body: { ...body } }),
  deleteCamera: (id: string) => apiFetch<void>(`/cameras/${id}`, { method: 'DELETE' }),
  regenerateKey: (id: string) =>
    apiFetch<{ camera: Camera; rtmp: RtmpInfo }>(`/cameras/${id}/regenerate-key`, {
      method: 'POST',
    }),
  calibrate: (id: string, opts: { force?: boolean } = {}) =>
    apiFetch<{ accepted: true }>(`/cameras/${id}/calibrate`, { method: 'POST', body: { ...opts } }),
  snapshotUrl: (id: string, bust?: number) =>
    withToken(`${API_URL}/cameras/${id}/snapshot${bust ? `?t=${bust}` : ''}`),

  listEvents: (cameraId: string, opts: { cursor?: string | null; types?: EventType[] } = {}) => {
    const q = new URLSearchParams({ limit: '20' });
    if (opts.cursor) q.set('cursor', opts.cursor);
    opts.types?.forEach((t) => q.append('type', t));
    return apiFetch<EventsPage>(`/cameras/${cameraId}/events?${q}`);
  },
  getEvent: (id: string) => apiFetch<SentinelaEvent>(`/events/${id}`),

  getSettings: () => apiFetch<AppSettings>('/settings'),
  updateSettings: (vision: { provider?: VisionProviderId; model?: string; effort?: Effort }) =>
    apiFetch<AppSettings>('/settings', { method: 'PATCH', body: { vision } }),
  listModels: (provider: VisionProviderId) =>
    apiFetch<ModelList>(`/settings/models?provider=${provider}`),
};

export const queryKeys = {
  stores: ['stores'] as const,
  store: (id: string) => ['stores', id] as const,
  camera: (id: string) => ['cameras', id] as const,
  events: (cameraId: string) => ['cameras', cameraId, 'events'] as const,
  event: (id: string) => ['events', id] as const,
  calibration: (cameraId: string) => ['cameras', cameraId, 'calibration'] as const,
  settings: ['settings'] as const,
  me: ['auth', 'me'] as const,
  users: ['users'] as const,
  models: (provider: string) => ['settings', 'models', provider] as const,
};
