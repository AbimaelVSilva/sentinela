import { buildApp } from './app';
import { env } from './config/env';
import { sqlClient } from './db/client';
import { StatusPoller } from './modules/mediamtx/status-poller';

const app = await buildApp();
const poller = new StatusPoller(app.log.child({ module: 'status-poller' }));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Encerrando API');
  try {
    poller.stop();
    await app.close();
    await sqlClient.end({ timeout: 5 });
  } finally {
    process.exit(0);
  }
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

// Erros inesperados de um worker nunca devem derrubar a API.
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandledRejection');
});

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  poller.start();
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
