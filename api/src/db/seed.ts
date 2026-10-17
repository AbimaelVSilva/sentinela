/**
 * Seed idempotente: cria o usuário inicial se ele ainda não existir.
 * Uso: npm run db:seed   (também roda no início do container no servidor)
 * Usuário/senha padrão: dev / 2306 — troque com SEED_USERNAME / SEED_PASSWORD.
 */
import { ensureUser } from '../modules/auth/service';
import { sqlClient } from './client';

const username = process.env.SEED_USERNAME || 'dev';
const password = process.env.SEED_PASSWORD || '2306';

try {
  const created = await ensureUser(username, password, 'Desenvolvedor');
  console.log(
    created ? `Usuário inicial "${username}" criado.` : `Usuário "${username}" já existe.`,
  );
} catch (err) {
  console.error('Falha no seed:', err);
  process.exitCode = 1;
} finally {
  await sqlClient.end({ timeout: 5 });
}
