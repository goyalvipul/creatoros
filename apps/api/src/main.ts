import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb, sql } from '@creatoros/db';
import { AppError, loadConfig } from '@creatoros/services';
import { buildApp } from './app';

async function main() {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl, { max: 12, applicationName: 'creatoros-api' });
  // Fail fast with a clear message if the database is not reachable or migrations have not run.
  try {
    await handle.db.execute(sql`select 1 from organizations limit 1`);
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'fatal',
        msg: 'Database not ready. Run `pnpm db:migrate` (or start the migrate service).',
        err: String(e),
      }),
    );
    process.exit(1);
  }
  // Producer-side queue for on-demand work (sync now, backup now). Fails fast when Redis is down instead of hanging a request.
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  redis.on('error', () => {});
  const requests = new Queue('requests', { connection: redis });
  const enqueue = async (_queue: string, name: string, data: Record<string, unknown>) => {
    try {
      await requests.add(name === 'connection' ? 'sync' : name, data, {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
    } catch {
      throw new AppError(
        503,
        'QUEUE_UNAVAILABLE',
        'The background worker queue (Redis) is not reachable right now. Try again shortly.',
      );
    }
  };
  const app = await buildApp({ db: handle.db, config, enqueue });
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
