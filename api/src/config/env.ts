import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Raiz do workspace `api/` — caminhos relativos do env são resolvidos a partir daqui. */
export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const num = (def: number) => z.coerce.number().finite().default(def);
/** Número opcional: string vazia no .env conta como ausente. */
const optionalNum = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().positive().optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3333),
  API_HOST: z.string().default('0.0.0.0'),
  PUBLIC_RTMP_URL: z.string().min(1),
  MEDIAMTX_API_URL: z.string().url().default('http://localhost:9997'),
  MEDIAMTX_RTSP_URL: z.string().default('rtsp://localhost:8554'),
  MEDIAMTX_WEBRTC_URL: z.string().url().default('http://localhost:8889'),
  MEDIAMTX_HLS_URL: z.string().url().default('http://localhost:8888'),
  MEDIAMTX_PLAYBACK_URL: z.string().url().default('http://localhost:9996'),
  CLIP_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  CLIP_PRE_SECONDS: num(3),
  CLIP_POST_SECONDS: num(2),
  CLIP_MAX_SECONDS: num(60),
  /** Vídeos de passagens "sem alteração" são apagados depois de N horas. */
  CLIP_RETENTION_NO_CHANGE_HOURS: num(24),
  /** Intervalo do job de retenção dos vídeos (minutos). */
  CLIP_CLEANUP_INTERVAL_MINUTES: num(60),
  STORAGE_DIR: z.string().default('./storage'),
  YOLO_MODEL_PATH: z.string().default('./models/yolo.onnx'),
  VISION_PROVIDER: z.enum(['anthropic', 'openai', 'google', 'mock']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  VISION_MODEL: z.string().default('claude-sonnet-5-5'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-5.1'),
  OPENAI_BASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  GOOGLE_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  GOOGLE_MODEL: z.string().default('gemini-flash-latest'),
  VISION_PRICE_INPUT_PER_MTOK: optionalNum(),
  VISION_PRICE_OUTPUT_PER_MTOK: optionalNum(),
  VISION_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
  INVENTORY_REFRESH_EVERY: z.coerce.number().int().positive().default(20),
  ANALYSIS_FPS: num(4),
  PERSON_CONFIDENCE: num(0.45),
  ROI_OVERLAP_MIN: num(0.15),
  ENTER_CONSECUTIVE_FRAMES: z.coerce.number().int().positive().default(3),
  CLEAR_SECONDS: num(2.5),
  STABLE_SECONDS: num(1.5),
  STABLE_DIFF_MAX: num(0.01),
  SCENE_DIFF_MIN: num(0.004),
  MAX_OCCLUSION_SECONDS: num(600),
  STABLE_MAX_WAIT_SECONDS: num(15),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Variáveis de ambiente inválidas:\n' + z.prettifyError(parsed.error));
    process.exit(1);
  }
  const env = parsed.data;
  return {
    ...env,
    PUBLIC_RTMP_URL: env.PUBLIC_RTMP_URL.replace(/\/+$/, ''),
    STORAGE_DIR: path.resolve(API_ROOT, env.STORAGE_DIR),
    YOLO_MODEL_PATH: path.resolve(API_ROOT, env.YOLO_MODEL_PATH),
  };
}

export const env = loadEnv();
