import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type AuthUser, userForToken } from './service';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    authToken: string | null;
  }
}

/** Rotas acessíveis sem login. */
const PUBLIC_ROUTES = new Set(['GET /health', 'POST /auth/login', 'POST /mediamtx/auth']);

export function isPublicRoute(method: string, path: string): boolean {
  if (method === 'OPTIONS') return true;
  return PUBLIC_ROUTES.has(`${method} ${path}`);
}

/**
 * Token do header `Authorization: Bearer <token>`. Em GETs que o navegador faz sem
 * poder enviar header (EventSource do SSE e <img> dos snapshots), aceita `?token=`.
 */
export function extractToken(
  req: Pick<FastifyRequest, 'headers' | 'method' | 'query'>,
): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  if (req.method === 'GET') {
    const q = (req.query ?? {}) as Record<string, unknown>;
    if (typeof q.token === 'string' && q.token) return q.token;
  }
  return null;
}

/** Hook global: exige sessão válida em tudo que não é público. */
export function registerAuthGuard(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('authToken', null);
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (isPublicRoute(req.method, path)) return;
    const token = extractToken(req);
    const user = token ? await userForToken(token) : null;
    if (!user) {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: token ? 'Sessão expirada. Faça login de novo.' : 'Faça login para continuar.',
      });
    }
    req.user = user;
    req.authToken = token;
  });
}
