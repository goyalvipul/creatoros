import { Socket } from 'node:net';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb, sql } from '@creatoros/db';
import { loadConfig } from '@creatoros/services';
import { JOB_TABLE, jobBackup, jobPublish, jobRestoreTest, jobSync, type JobName, type WorkerDeps } from './jobs';

/**
 * Scheduler + processor. Repeatable jobs are registered with deterministic scheduler ids, so restarting the worker
 * never duplicates them. All jobs are idempotent (they read "what is due" from the database), so at-least-once
 * delivery after a crash is safe.
 */
const SCHEDULE: { name: JobName; every?: number; pattern?: string; tz?: string }[] = [
  { name: 'heartbeat', every: 30_000 },
  { name: 'ltx', every: 15_000 },
  { name: 'events', every: 15_000 },
  { name: 'actions', every: 60_000 },
  { name: 'social-events', every: 10_000 },
  { name: 'social-sync', every: 15 * 60_000 },
  { name: 'sync-fast', every: 5 * 60_000 },
  { name: 'sync-slow', every: 30 * 60_000 },
  { name: 'maintenance', every: 60 * 60_000 },
  { name: 'backup', pattern: '15 3 * * *', tz: 'America/Vancouver' },
  { name: 'restore-test', pattern: '45 3 * * 0', tz: 'America/Vancouver' },
];

/**
 * A peer closing a socket emits `error` on it. With no listener, Node exits. That was killing the worker about
 * once a minute and leaving a publish stuck on UPLOADING, so the button spun forever.
 */
function ignoreDeadSocket(log: WorkerDeps['log']) {
  const emit = Socket.prototype.emit;
  Socket.prototype.emit = function (this: Socket, event: string | symbol, ...args: unknown[]) {
    if (event === 'error' && this.listenerCount('error') === 0) {
      const err = args[0] as NodeJS.ErrnoException | undefined;
      log?.('error', 'socket closed during a write', {
        code: err?.code,
        err: err?.message,
        remote: `${this.remoteAddress ?? ''}:${this.remotePort ?? ''}`,
      });
      if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET' || err?.code === 'ECONNABORTED') return true;
    }
    return emit.apply(this, [event, ...args] as never);
  };
}

async function main() {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl, { max: 6, applicationName: 'creatoros-worker' });
  const log: WorkerDeps['log'] = (level, msg, extra) =>
    console[level === 'error' ? 'error' : 'log'](
      JSON.stringify({ level, msg, ...extra, at: new Date().toISOString() }),
    );
  const deps: WorkerDeps = { db: handle.db, env: config.env, log };
  ignoreDeadSocket(log);
  // The previous process died mid-upload. Nothing is sending those files now, so the owner can press Try again.
  await handle.db.execute(sql`
    update publish_drafts
    set upload_state = 'FAILED',
        error = 'The upload stopped before it finished. Press Try again.',
        updated_at = now()
    where upload_state = 'UPLOADING'
  `);

  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (e) => log('error', 'redis error', { err: String(e) }));
  const jobsQ = new Queue('jobs', { connection });
  const requestsQ = new Queue('requests', { connection });

  for (const s of SCHEDULE) {
    await jobsQ.upsertJobScheduler(
      `sched:${s.name}`,
      s.pattern ? { pattern: s.pattern, ...(s.tz ? { tz: s.tz } : {}) } : { every: s.every! },
      { name: s.name, opts: { removeOnComplete: 20, removeOnFail: 100, attempts: 1 } },
    );
  }

  const jobsWorker = new Worker(
    'jobs',
    async (job: Job) => {
      const fn = JOB_TABLE[job.name as JobName];
      if (!fn) throw new Error(`Unknown job ${job.name}`);
      const started = Date.now();
      const out = await fn(deps);
      if (job.name !== 'heartbeat' && job.name !== 'events' && job.name !== 'ltx')
        log('info', `job ${job.name} done`, {
          ms: Date.now() - started,
          out: JSON.stringify(out).slice(0, 400),
        });
      return out as object;
    },
    { connection, concurrency: 2 },
  );

  // On-demand requests coming from the API (sync now, backup now).
  const requestsWorker = new Worker(
    'requests',
    async (job: Job) => {
      if (job.name === 'backup') return jobBackup(deps, 'manual');
      if (job.name === 'restore-test') return jobRestoreTest(deps) as Promise<object>;
      if (job.name === 'publish') return jobPublish(deps, String(job.data.draftId)) as Promise<object>;
      if (job.name === 'ltx') {
        const { submitLtxJob } = await import('@creatoros/services');
        return submitLtxJob(deps.db, deps.env, String(job.data.jobId)) as Promise<object>;
      }
      if (job.name === 'sync') {
        const { runSync } = await import('@creatoros/services');
        return runSync(handle.db, config.env, String(job.data.connectionId), {
          full: Boolean(job.data.full),
        });
      }
      void jobSync;
      throw new Error(`Unknown request ${job.name}`);
    },
    { connection, concurrency: 1 },
  );

  for (const w of [jobsWorker, requestsWorker])
    w.on('failed', (job, err) => log('error', `job failed: ${job?.name}`, { err: String(err) }));
  log('info', 'worker started', { jobs: SCHEDULE.map((s) => s.name) });

  const stop = async () => {
    await Promise.allSettled([jobsWorker.close(), requestsWorker.close(), jobsQ.close(), requestsQ.close()]);
    connection.disconnect();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
