import { backupRuns, desc, eq, organizations, publishDrafts, sql, type Db } from '@creatoros/db';
import {
  createBackup,
  detectNearDuplicates,
  executePublish,
  evictPreviews,
  linkPendingGenerationOutputs,
  listConnectionsForSync,
  markStaleDevicesOffline,
  notify,
  processFacebookWebhookEvents,
  processMetaWebhookEvents,
  processOutbox,
  pruneBackups,
  recordHeartbeat,
  refreshInvoiceStatuses,
  renewInstagramTokens,
  restoreTest,
  runActionsEngine,
  runSync,
  snapshotAnalytics,
  reconcileWorkspaceTasks,
  syncDueTaskLinks,
  syncSocialAccount,
  systemCtx,
  verifyBackup,
  type ConnectorOverrides,
  type Runner,
  type ServiceEnv,
} from '@creatoros/services';

export interface WorkerDeps {
  db: Db;
  env: ServiceEnv;
  now?: () => Date;
  overrides?: ConnectorOverrides;
  /** Injectable process runner (tests route pg_dump through `docker exec`). */
  runner?: Runner;
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
}

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const nowOf = (d: WorkerDeps) => (d.now ?? (() => new Date()))();
const log = (
  d: WorkerDeps,
  level: 'info' | 'warn' | 'error',
  msg: string,
  extra: Record<string, unknown> = {},
) => (d.log ?? (() => {}))(level, msg, extra);

export async function orgIds(db: Db): Promise<string[]> {
  return (await db.select({ id: organizations.id }).from(organizations)).map((o) => o.id);
}

/** Each job isolates failures per organization / connection so one bad record never stalls the rest. */
async function each<T>(d: WorkerDeps, items: T[], name: string, fn: (item: T) => Promise<unknown>) {
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await fn(item);
      ok++;
    } catch (e) {
      failed++;
      log(d, 'error', `${name} failed`, {
        err: String(e),
        item: typeof item === 'string' ? item : undefined,
      });
    }
  }
  return { ok, failed };
}

export async function jobHeartbeat(d: WorkerDeps) {
  await recordHeartbeat(d.db, 'worker', {
    pid: process.pid,
    uptimeS: Math.round(process.uptime()),
    node: process.version,
  });
  return { ok: true };
}

/** Outbox delivery + device liveness: the "something changed" loop. Runs every ~15s. */
export async function jobEvents(d: WorkerDeps) {
  const now = nowOf(d);
  const outbox = await processOutbox(d.db, { now });
  const offline = await markStaleDevicesOffline(d.db, d.env, now);
  return { outbox, devicesMarkedOffline: offline.length };
}

/** Follow-up rules, invoice status, generation output linking. Runs every minute. */
export async function jobActions(d: WorkerDeps) {
  const now = nowOf(d);
  const ids = await orgIds(d.db);
  let created = 0;
  let resolved = 0;
  const r = await each(d, ids, 'actions engine', async (orgId) => {
    await refreshInvoiceStatuses(d.db, orgId, now);
    const out = await runActionsEngine(d.db, orgId, now);
    created += out.created;
    resolved += out.resolved;
    await linkPendingGenerationOutputs(d.db, orgId);
  });
  return { orgs: ids.length, created, resolved, ...r };
}

/** Provider syncs. `fast` = mailbox/Todo (every 5 minutes), `slow` = platform imports (every 30 minutes). */
export async function jobSync(d: WorkerDeps, scope: 'fast' | 'slow' | 'all' = 'all') {
  if (scope !== 'fast')
    await renewInstagramTokens(d.db, d.env, d.overrides).catch((e) =>
      log(d, 'error', 'instagram token renewal failed', { err: String(e) }),
    );
  const conns = await listConnectionsForSync(d.db);
  const fastProviders = new Set(['gmail']);
  const picked = conns.filter((c) =>
    scope === 'all'
      ? true
      : scope === 'fast'
        ? fastProviders.has(c.provider)
        : !fastProviders.has(c.provider),
  );
  const r = await each(d, picked, 'connection sync', (c) => runSync(d.db, d.env, c.id, {}, d.overrides));
  let todo: unknown = null;
  if (scope !== 'slow')
    todo = await syncDueTaskLinks(d.db, d.env, { now: nowOf(d), overrides: d.overrides })
      .then(async (pushed) => ({ ...pushed, ...(await reconcileWorkspaceTasks(d.db, d.env, d.overrides)) }))
      .catch((e) => {
      log(d, 'error', 'todo sync failed', { err: String(e) });
      return null;
    });
  return { connections: picked.length, ...r, todo };
}

/** Once a day at 03:15 America/Vancouver. A second scheduled run the same day is skipped. */
export async function jobBackup(d: WorkerDeps, kind: 'manual' | 'scheduled' = 'scheduled') {
  if (kind === 'scheduled') {
    const recent = (
      await d.db.execute(sql`
        select 1 as n from backup_runs
        where kind = 'scheduled'
          and state in ('SUCCEEDED', 'VERIFIED', 'RESTORED_TEST')
          and started_at > now() - interval '20 hours'
        limit 1`)
    ) as { rows: { n: number }[] };
    if (recent.rows.length) {
      log(d, 'info', 'scheduled backup skipped; one already succeeded in the last 20 hours');
      return { skipped: true };
    }
  }
  const b = await createBackup(d.db, d.env, { kind, runner: d.runner });
  const v = await verifyBackup(d.db, d.env, b.file, { runner: d.runner, backupRunId: b.id });
  const pruned = await pruneBackups(d.env);
  log(d, 'info', 'backup complete', { file: b.file, verified: v.ok, removed: pruned.removed.length });
  return { file: b.file, verified: v.ok, pruned: pruned.removed.length };
}

/**
 * Weekly (and on demand): restore the newest backup into a throw-away database and compare rows + relationships.
 * The outcome is recorded on the backup run and a failure raises a CRITICAL notification, so a backup that cannot be
 * restored never goes unnoticed.
 */
export async function jobRestoreTest(d: WorkerDeps) {
  const { listBackupFiles } = await import('./backupFiles');
  const latest = await listBackupFiles(d.env.backupDir);
  if (!latest.length) return { skipped: 'no backups yet' };
  const file = latest[0]!;
  const [run] = await d.db
    .select({ id: backupRuns.id })
    .from(backupRuns)
    .where(eq(backupRuns.target, file))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1);
  try {
    const out = await restoreTest(d.db, d.env, file, { runner: d.runner, backupRunId: run?.id });
    return { file, ...out };
  } catch (e) {
    const message = `Restore test failed: ${(e as Error).message}`.slice(0, 1000);
    if (run) await d.db.update(backupRuns).set({ error: message }).where(eq(backupRuns.id, run.id));
    await each(d, await orgIds(d.db), 'restore-test notification', (orgId) =>
      notify(d.db, {
        orgId,
        type: 'backup.restore_test.failed',
        dedupeKey: `restore-test:${file}`,
        title: 'A backup could not be restored',
        body: message,
        severity: 'CRITICAL',
        deepLink: '/settings?tab=backups',
      }),
    );
    throw e;
  }
}

/** Housekeeping: preview cache LRU, expired rows, daily analytics snapshot and near-duplicate scan. */
export async function jobMaintenance(d: WorkerDeps) {
  const evicted = await evictPreviews(d.db, d.env);
  await d.db.execute(sql`delete from api_idempotency_keys where expires_at < now()`);
  await d.db.execute(sql`delete from oauth_states where expires_at < now() - interval '1 day'`);
  await d.db.execute(
    sql`delete from sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '30 days'`,
  );
  await d.db.execute(sql`delete from webhook_receipts where received_at < now() - interval '30 days'`);
  await d.db
    .execute(
      sql`delete from background_jobs where type not like 'heartbeat:%' and created_at < now() - interval '60 days'`,
    )
    .catch(() => null);
  const ids = await orgIds(d.db);
  const now = nowOf(d);
  await each(d, ids, 'analytics snapshot', (orgId) => snapshotAnalytics(d.db, orgId, now));
  await each(d, ids, 'near duplicates', (orgId) =>
    detectNearDuplicates({ ...systemCtx({ db: d.db, env: d.env }, orgId), now: () => now }),
  );
  return { evicted };
}

/** Incremental, read-only Instagram sync for every healthy account. Historical imports never trigger workflows. */
export async function jobSocialSync(d: WorkerDeps) {
  const rows = rowsOf<{ id: string; org_id: string }>(
    await d.db.execute(
      sql`select id, org_id from provider_connections where provider in ('instagram','facebook','youtube') and state in ('ACTIVE','PARTIAL_SYNC') and encrypted_token_ref is not null and (provider <> 'youtube' or 'https://www.googleapis.com/auth/youtube.force-ssl' = any(scopes))`,
    ),
  );
  const out = { accounts: rows.length, ok: 0, failed: 0 };
  for (const r of rows) {
    try {
      await syncSocialAccount(systemCtx({ db: d.db, env: d.env }, r.org_id), r.id, d.overrides);
      out.ok += 1;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}

/** One explicit Publish. The draft row is claimed from QUEUED, so a second delivery does not upload again. */
export async function jobPublish(d: WorkerDeps, draftId: string) {
  const [row] = await d.db
    .select({ orgId: publishDrafts.orgId })
    .from(publishDrafts)
    .where(eq(publishDrafts.id, draftId));
  if (!row) return { skipped: true };
  return executePublish(systemCtx({ db: d.db, env: d.env }, row.orgId), draftId, {
    fetch: d.overrides?.fetch as typeof fetch | undefined,
  });
}

export const JOB_TABLE = {
  heartbeat: jobHeartbeat,
  events: jobEvents,
  actions: jobActions,
  'social-sync': jobSocialSync,
  'social-events': async (d: WorkerDeps) => ({
    instagram: await processMetaWebhookEvents(d.db, d.env, d.overrides),
    facebook: await processFacebookWebhookEvents(d.db, d.env, d.overrides),
  }),
  'sync-fast': (d: WorkerDeps) => jobSync(d, 'fast'),
  'sync-slow': (d: WorkerDeps) => jobSync(d, 'slow'),
  backup: (d: WorkerDeps) => jobBackup(d, 'scheduled'),
  'restore-test': jobRestoreTest,
  maintenance: jobMaintenance,
} as const;
export type JobName = keyof typeof JOB_TABLE;

void rowsOf;
