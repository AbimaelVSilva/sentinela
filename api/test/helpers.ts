import type { FastifyBaseLogger } from 'fastify';

/** Logger silencioso para testes. */
export const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => silentLog,
  level: 'silent',
} as unknown as FastifyBaseLogger;
