import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../../db/client';
import { sessions, type User, users } from '../../db/schema';
import { generateToken, hashPassword, hashToken, verifyPassword } from './crypto';

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export interface AuthUser {
  id: string;
  username: string;
  name: string | null;
}

export const toAuthUser = (u: Pick<User, 'id' | 'username' | 'name'>): AuthUser => ({
  id: u.id,
  username: u.username,
  name: u.name,
});

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

// Hash fixo para gastar o mesmo tempo quando o usuário não existe (evita enumeração por tempo).
const DUMMY_HASH = hashPassword('senha-que-nao-existe');

/** Valida usuário/senha e cria uma sessão; devolve null se inválido. */
export async function login(username: string, password: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.username, normalizeUsername(username)),
  });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !ok) return null;

  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt });
  // Limpeza oportunista de sessões vencidas.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt, user: toAuthUser(user) };
}

/** Usuário dono de um token válido (não expirado), ou null. */
export async function userForToken(token: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({ id: users.id, username: users.username, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function logout(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Cria o usuário se não existir (usado pelo seed). Devolve se criou. */
export async function ensureUser(
  username: string,
  password: string,
  name?: string,
): Promise<boolean> {
  const inserted = await db
    .insert(users)
    .values({
      username: normalizeUsername(username),
      name: name ?? null,
      passwordHash: await hashPassword(password),
    })
    .onConflictDoNothing({ target: users.username })
    .returning({ id: users.id });
  return inserted.length > 0;
}
