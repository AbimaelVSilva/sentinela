import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida (confira o .env na raiz).');
  process.exit(1);
}

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const client = postgres(url, { max: 1 });

try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log('Migrations aplicadas.');
} catch (err) {
  console.error('Falha ao aplicar migrations:', err);
  process.exitCode = 1;
} finally {
  await client.end();
}
