import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { isUniqueViolation } from '../../lib/pg-errors';
import { hashPassword } from './crypto';
import { login, logout, normalizeUsername, toAuthUser } from './service';

const Credentials = z.object({
  username: z.string().trim().min(1, 'Informe o usuário').max(60),
  password: z.string().min(1, 'Informe a senha').max(200),
});

const NewUser = z.object({
  username: z
    .string()
    .trim()
    .min(2, 'Mínimo de 2 caracteres')
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letras, números, ponto, hífen ou sublinhado'),
  name: z.string().trim().max(120).nullish(),
  password: z.string().min(4, 'A senha precisa ter pelo menos 4 caracteres').max(200),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/auth/login', { schema: { body: Credentials } }, async (req, reply) => {
    const session = await login(req.body.username, req.body.password);
    if (!session) {
      req.log.warn({ username: normalizeUsername(req.body.username) }, 'Login recusado');
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Usuário ou senha inválidos.',
      });
    }
    req.log.info({ userId: session.user.id }, 'Login');
    return { token: session.token, expiresAt: session.expiresAt.toISOString(), user: session.user };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.authToken) await logout(req.authToken);
    return reply.code(204).send();
  });

  app.get('/auth/me', async (req) => ({ user: req.user }));

  app.get('/users', async () => {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.username));
    return rows.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }));
  });

  app.post('/users', { schema: { body: NewUser } }, async (req, reply) => {
    try {
      const [row] = await db
        .insert(users)
        .values({
          username: normalizeUsername(req.body.username),
          name: req.body.name || null,
          passwordHash: await hashPassword(req.body.password),
        })
        .returning();
      req.log.info({ by: req.user?.id, userId: row!.id }, 'Usuário criado');
      return reply.code(201).send({ ...toAuthUser(row!), createdAt: row!.createdAt.toISOString() });
    } catch (err) {
      if (isUniqueViolation(err))
        throw app.httpErrors.conflict('Já existe um usuário com esse nome.');
      throw err;
    }
  });

  app.delete(
    '/users/:id',
    { schema: { params: z.object({ id: z.uuid() }) } },
    async (req, reply) => {
      if (req.params.id === req.user?.id) {
        throw app.httpErrors.badRequest('Você não pode remover o próprio usuário.');
      }
      const res = await db
        .delete(users)
        .where(eq(users.id, req.params.id))
        .returning({ id: users.id });
      if (res.length === 0) throw app.httpErrors.notFound('Usuário não encontrado');
      return reply.code(204).send();
    },
  );
};
