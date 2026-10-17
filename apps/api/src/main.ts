import { createDb, sql } from '@creatoros/db';
import { loadConfig } from '@creatoros/services';
import { buildApp } from './app';

async function main() {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl, { max: 12, applicationName: 'creatoros-api' });
  // Fail fast with a clear message if the database is not reachable or migrations have not run.
  try {
    await handle.db.execute(sql`select 1 from organizations limit 1`);
  } catch (e) {
    console.error(JSON.stringify({ level: 'fatal', msg: 'Database not ready. Run `pnpm db:migrate` (or start the migrate service).', err: String(e) }));
    process.exit(1);
  }
  const app = await buildApp({ db: handle.db, config });
  await app.listen({ host: config.host, port: config.port });

  const stop = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
