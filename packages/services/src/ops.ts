import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { backupRuns, desc, eq, sql, type Db } from '@creatoros/db';
import { audit } from './audit';
import { badRequest, notFound, type Ctx, type ServiceEnv } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

// ------------------------------------------------------------- heartbeats

/** Background processes record liveness here so the UI can say "worker is running" truthfully. */
export async function recordHeartbeat(db: Db, name: string, detail: Record<string, unknown> = {}) {
  await db.execute(
    sql`delete from background_jobs where type = ${'heartbeat:' + name} and created_at < now() - interval '1 day'`,
  );
  await db.execute(
    sql`insert into background_jobs (type, status, finished_at, result) values (${'heartbeat:' + name}, 'SUCCEEDED', now(), ${JSON.stringify(detail)}::jsonb)`,
  );
}

export async function lastHeartbeat(
  db: Db,
  name: string,
): Promise<{ at: Date; detail: Record<string, unknown> } | null> {
  const r = rowsOf<{ at: Date; detail: Record<string, unknown> }>(
    await db.execute(
      sql`select finished_at as at, result as detail from background_jobs where type = ${'heartbeat:' + name} order by created_at desc limit 1`,
    ),
  )[0];
  return r ?? null;
}

// ------------------------------------------------------------------ health

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  checks: Record<string, { ok: boolean; detail?: string; value?: unknown }>;
}

async function diskFreeBytes(dir: string): Promise<number | null> {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const s = await fsp.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Readiness probe used by Docker healthchecks and the Settings > System page. */
export async function systemHealth(db: Db, env: ServiceEnv, now = new Date()): Promise<HealthReport> {
  const checks: HealthReport['checks'] = {};
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    checks.database = { ok: true, value: { latencyMs: Date.now() - t0 } };
  } catch (e) {
    checks.database = { ok: false, detail: (e as Error).message };
    return { status: 'down', checkedAt: now.toISOString(), checks };
  }
  const mig = rowsOf<{ n: number }>(
    await db
      .execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)
      .catch(() => ({ rows: [{ n: -1 }] })),
  )[0]!.n;
  checks.migrations = { ok: mig > 0, value: mig };
  const hb = await lastHeartbeat(db, 'worker');
  const age = hb ? (now.getTime() - new Date(hb.at).getTime()) / 1000 : null;
  checks.worker = {
    ok: age !== null && age < 180,
    detail: age === null ? 'no worker heartbeat recorded yet' : `last heartbeat ${Math.round(age)}s ago`,
    value: hb?.detail,
  };
  const ob = rowsOf<{ pending: number; failed: number }>(
    await db.execute(
      sql`select count(*) filter (where state='PENDING')::int as pending, count(*) filter (where state='FAILED')::int as failed from outbox_events`,
    ),
  )[0]!;
  checks.outbox = { ok: ob.pending < 1000 && ob.failed === 0, value: ob };
  const [bk] = await db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(1);
  const bkAge = bk?.finishedAt ? (now.getTime() - bk.finishedAt.getTime()) / 3_600_000 : null;
  checks.backup = {
    ok: bk?.state === 'SUCCEEDED' || bk?.state === 'VERIFIED' ? (bkAge ?? 999) < 48 : false,
    detail: bk ? `${bk.state} ${bkAge !== null ? Math.round(bkAge) + 'h ago' : ''}` : 'no backup has run yet',
    value: bk ? { state: bk.state, at: bk.finishedAt } : null,
  };
  const free = await diskFreeBytes(env.backupDir);
  checks.disk = {
    ok: free === null ? false : free > 2 * 1024 ** 3,
    detail: free === null ? 'cannot read backup volume' : undefined,
    value: { backupFreeBytes: free, previewFreeBytes: await diskFreeBytes(env.mediaPreviewDir) },
  };
  const dev = rowsOf<{ online: number; offline: number }>(
    await db.execute(
      sql`select count(*) filter (where state='ONLINE')::int as online, count(*) filter (where state='OFFLINE')::int as offline from devices where revoked_at is null`,
    ),
  )[0]!;
  checks.agents = {
    ok: dev.offline === 0,
    detail: dev.offline ? `${dev.offline} agent(s) offline` : undefined,
    value: dev,
  };
  const critical = ['database', 'migrations'];
  const hardFail = critical.some((k) => !checks[k]!.ok);
  const soft = Object.values(checks).some((c) => !c.ok);
  return { status: hardFail ? 'down' : soft ? 'degraded' : 'ok', checkedAt: now.toISOString(), checks };
}

// ------------------------------------------------------------------ backup

export interface RunOpts {
  env?: Record<string, string>;
  stdoutFile?: string;
  stdinFile?: string;
}
/** Injectable process runner (default spawns local binaries; tests can route through `docker exec`). */
export type Runner = (
  cmd: string,
  args: string[],
  opts?: RunOpts,
) => Promise<{ stdout: string; stderr: string }>;

export const localRunner: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env },
      stdio: [opts.stdinFile ? 'pipe' : 'ignore', opts.stdoutFile ? 'pipe' : 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    if (opts.stdoutFile) child.stdout!.pipe(fs.createWriteStream(opts.stdoutFile));
    else child.stdout!.on('data', (d) => (stdout += d));
    child.stderr!.on('data', (d) => (stderr += d));
    if (opts.stdinFile) fs.createReadStream(opts.stdinFile).pipe(child.stdin!);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(0, 800)}`)),
    );
  });

export function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    url: u,
  };
}

const pgArgs = (url: string) => {
  const p = parseDbUrl(url);
  return {
    args: ['-h', p.host, '-p', p.port, '-U', p.user],
    env: { PGPASSWORD: p.password },
    db: p.database,
  };
};

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((res, rej) =>
    fs
      .createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => res())
      .on('error', rej),
  );
  return h.digest('hex');
}

/**
 * Relationship fingerprint: counts of rows reachable through foreign keys. A restore that kept every table but lost or re-pointed
 * relationships would change these numbers even when plain row counts match.
 */
export const RELATION_SQL = `
  select 'asset_in_project' as t, count(*)::int as n from logical_assets a join creative_projects p on p.id = a.project_id
  union all select 'publication_variant_asset', count(*)::int from publication_records r join distribution_variants v on v.id = r.variant_id join logical_assets a on a.id = v.asset_id
  union all select 'publication_account_channel_brand', count(*)::int from publication_records r join social_accounts s on s.id = r.social_account_id join channels c on c.id = s.channel_id join brands b on b.id = c.brand_id
  union all select 'deliverable_in_deal', count(*)::int from deal_deliverables d join deals x on x.id = d.deal_id
  union all select 'publication_for_deliverable', count(*)::int from publication_records r join deal_deliverables d on d.id = r.deliverable_id
  union all select 'invoice_in_deal', count(*)::int from invoices i join deals d on d.id = i.deal_id
  union all select 'payment_on_invoice', count(*)::int from payments p join invoices i on i.id = p.invoice_id
  union all select 'file_in_version_asset', count(*)::int from asset_file_links l join asset_versions v on v.id = l.asset_version_id join logical_assets a on a.id = v.asset_id join file_instances f on f.id = l.file_instance_id
  union all select 'message_in_thread', count(*)::int from messages m join conversation_threads t on t.id = m.thread_id
  order by 1`;
export interface BackupManifest {
  app: 'creatoros';
  createdAt: string;
  kind: string;
  dumpFile: string;
  attachmentsArchive: string | null;
  checksumSha256: string;
  sizeBytes: number;
  migrations: number;
  rowCounts: Record<string, number>;
  /** Joined-relationship counts (project->asset->variant->publication, deal->deliverable->publication, file->version->asset...). */
  relationCounts?: Record<string, number>;
  note: string;
}

/** Custom-format pg_dump + attachments archive + checksum manifest. The preview cache is excluded on purpose (rebuildable). */
export async function createBackup(
  db: Db,
  env: ServiceEnv,
  opts: { kind?: 'manual' | 'scheduled' | 'pre_migration'; runner?: Runner } = {},
) {
  if (!env.databaseUrl) throw badRequest('DATABASE_URL is not available to the backup process');
  const run = opts.runner ?? localRunner;
  const kind = opts.kind ?? 'manual';
  await fsp.mkdir(env.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpFile = path.join(env.backupDir, `creatoros-${stamp}.dump`);
  const [row] = await db.insert(backupRuns).values({ kind, state: 'RUNNING', target: dumpFile }).returning();
  try {
    const pg = pgArgs(env.databaseUrl);
    await run('pg_dump', [...pg.args, '--format=custom', '--no-owner', '--dbname', pg.db], {
      env: pg.env,
      stdoutFile: dumpFile,
    });
    const size = (await fsp.stat(dumpFile)).size;
    if (size < 1024) throw new Error('Backup file is suspiciously small; refusing to mark it successful');
    const checksum = await sha256File(dumpFile);
    let attachmentsArchive: string | null = null;
    try {
      const files = await fsp.readdir(env.attachmentsDir);
      if (files.length) {
        attachmentsArchive = path.join(env.backupDir, `creatoros-${stamp}-attachments.tar.gz`);
        await run('tar', ['-czf', attachmentsArchive, '-C', env.attachmentsDir, '.']);
      }
    } catch {}
    const counts = rowsOf<{ t: string; n: number }>(
      await db.execute(
        sql`select 'users' as t, count(*)::int as n from users union all select 'file_instances', count(*)::int from file_instances union all select 'assets', count(*)::int from logical_assets union all select 'projects', count(*)::int from creative_projects union all select 'publications', count(*)::int from publication_records union all select 'deals', count(*)::int from deals union all select 'messages', count(*)::int from messages`,
      ),
    );
    const mig = rowsOf<{ n: number }>(
      await db
        .execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)
        .catch(() => ({ rows: [{ n: 0 }] })),
    )[0]!.n;
    const manifest: BackupManifest = {
      app: 'creatoros',
      createdAt: new Date().toISOString(),
      kind,
      dumpFile: path.basename(dumpFile),
      attachmentsArchive: attachmentsArchive ? path.basename(attachmentsArchive) : null,
      checksumSha256: checksum,
      sizeBytes: size,
      migrations: mig,
      rowCounts: Object.fromEntries(counts.map((c) => [c.t, c.n])),
      relationCounts: Object.fromEntries(
        rowsOf<{ t: string; n: number }>(await db.execute(sql.raw(RELATION_SQL))).map((c) => [c.t, c.n]),
      ),
      note: 'Preview cache excluded (rebuildable). Original media files are never part of the backup; they stay on their machines.',
    };
    await fsp.writeFile(dumpFile + '.manifest.json', JSON.stringify(manifest, null, 2));
    await db
      .update(backupRuns)
      .set({
        state: 'SUCCEEDED',
        checksumSha256: checksum,
        sizeBytes: size,
        manifest: manifest as any,
        finishedAt: new Date(),
      })
      .where(eq(backupRuns.id, row!.id));
    return { id: row!.id, file: dumpFile, manifest };
  } catch (e) {
    await fsp.rm(dumpFile, { force: true });
    await db
      .update(backupRuns)
      .set({ state: 'FAILED', error: (e as Error).message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(backupRuns.id, row!.id));
    throw e;
  }
}

/** Integrity check: checksum matches the manifest and pg_restore can read the archive's table of contents. */
export async function verifyBackup(
  db: Db,
  env: ServiceEnv,
  file: string,
  opts: { runner?: Runner; backupRunId?: string } = {},
) {
  const run = opts.runner ?? localRunner;
  const manifest = JSON.parse(await fsp.readFile(file + '.manifest.json', 'utf8')) as BackupManifest;
  const actual = await sha256File(file);
  if (actual !== manifest.checksumSha256)
    throw new Error('Checksum mismatch: the backup file is corrupted or was modified');
  const toc = await run('pg_restore', ['--list'], { stdinFile: file });
  if (!/TABLE DATA|TABLE public/.test(toc.stdout))
    throw new Error('pg_restore could not read any tables from this archive');
  if (opts.backupRunId)
    await db.update(backupRuns).set({ state: 'VERIFIED' }).where(eq(backupRuns.id, opts.backupRunId));
  return { ok: true, checksum: actual, tables: (toc.stdout.match(/TABLE DATA/g) ?? []).length };
}

/** Restores into a throw-away database on the same server, compares row counts with the manifest, then drops it. */
export async function restoreTest(
  db: Db,
  env: ServiceEnv,
  file: string,
  opts: { runner?: Runner; backupRunId?: string } = {},
) {
  if (!env.databaseUrl) throw badRequest('DATABASE_URL is required');
  const run = opts.runner ?? localRunner;
  const manifest = JSON.parse(await fsp.readFile(file + '.manifest.json', 'utf8')) as BackupManifest;
  const pg = pgArgs(env.databaseUrl);
  const tmp = `creatoros_restore_test_${Date.now()}`;
  await run('psql', [...pg.args, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${tmp}`], {
    env: pg.env,
  });
  try {
    await run('pg_restore', [...pg.args, '--no-owner', '--exit-on-error', '--dbname', tmp], {
      env: pg.env,
      stdinFile: file,
    });
    const counts: Record<string, number> = {};
    const tables: Record<string, string> = {
      users: 'users',
      file_instances: 'file_instances',
      assets: 'logical_assets',
      projects: 'creative_projects',
      publications: 'publication_records',
      deals: 'deals',
      messages: 'messages',
    };
    for (const [k, t] of Object.entries(tables)) {
      const out = await run('psql', [...pg.args, '-d', tmp, '-At', '-c', `select count(*) from ${t}`], {
        env: pg.env,
      });
      counts[k] = Number(out.stdout.trim());
    }
    const relOut = await run('psql', [...pg.args, '-d', tmp, '-At', '-F', '|', '-c', RELATION_SQL], {
      env: pg.env,
    });
    const relations: Record<string, number> = Object.fromEntries(
      relOut.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          const [k, n] = l.split('|');
          return [k!, Number(n)];
        }),
    );
    const relMismatches = Object.entries(manifest.relationCounts ?? {}).filter(
      ([k, n]) => relations[k] !== n,
    );
    if (relMismatches.length)
      throw new Error(
        `Relationships differ after restore: ${relMismatches.map(([k, n]) => `${k} expected ${n} got ${relations[k]}`).join('; ')}`,
      );
    const mismatches = Object.entries(manifest.rowCounts).filter(([k, n]) => counts[k] !== n);
    if (mismatches.length)
      throw new Error(
        `Row counts differ after restore: ${mismatches.map(([k, n]) => `${k} expected ${n} got ${counts[k]}`).join('; ')}`,
      );
    if (opts.backupRunId)
      await db
        .update(backupRuns)
        .set({ state: 'RESTORED_TEST', restoreTestRef: tmp })
        .where(eq(backupRuns.id, opts.backupRunId));
    return { ok: true, counts, relations };
  } finally {
    await run('psql', [...pg.args, '-d', 'postgres', '-c', `drop database if exists ${tmp} with (force)`], {
      env: pg.env,
    }).catch(() => {});
  }
}

/** Keep the newest `daily` backups, one per week for `weekly` weeks, one per month for `monthly` months. */
export async function pruneBackups(
  env: ServiceEnv,
  keep = { daily: 7, weekly: 4, monthly: 6 },
  now = new Date(),
) {
  let names: string[] = [];
  try {
    names = (await fsp.readdir(env.backupDir))
      .filter((n) => /^creatoros-.*\.dump$/.test(n))
      .sort()
      .reverse();
  } catch {
    return { removed: [] as string[], kept: [] as string[] };
  }
  const keepSet = new Set<string>();
  const weeks = new Set<string>();
  const months = new Set<string>();
  names.forEach((n, i) => {
    const t = new Date(n.slice(10, 29).replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3') + 'Z');
    const ageDays = (now.getTime() - t.getTime()) / 86400_000;
    const wk = `${t.getUTCFullYear()}-W${Math.floor(t.getTime() / (7 * 86400_000))}`;
    const mo = `${t.getUTCFullYear()}-${t.getUTCMonth()}`;
    if (i < keep.daily) keepSet.add(n);
    else if (ageDays <= keep.weekly * 7 && !weeks.has(wk)) {
      weeks.add(wk);
      keepSet.add(n);
    } else if (ageDays <= keep.monthly * 31 && !months.has(mo)) {
      months.add(mo);
      keepSet.add(n);
    }
  });
  const removed: string[] = [];
  for (const n of names) {
    if (keepSet.has(n)) continue;
    const base = path.join(env.backupDir, n);
    await fsp.rm(base, { force: true });
    await fsp.rm(base + '.manifest.json', { force: true });
    await fsp.rm(base.replace(/\.dump$/, '-attachments.tar.gz'), { force: true });
    removed.push(n);
  }
  return { removed, kept: [...keepSet] };
}

export async function listBackups(ctx: Ctx) {
  return ctx.db
    .select({
      id: backupRuns.id,
      kind: backupRuns.kind,
      state: backupRuns.state,
      target: backupRuns.target,
      sizeBytes: backupRuns.sizeBytes,
      checksumSha256: backupRuns.checksumSha256,
      error: backupRuns.error,
      startedAt: backupRuns.startedAt,
      finishedAt: backupRuns.finishedAt,
    })
    .from(backupRuns)
    .orderBy(desc(backupRuns.startedAt))
    .limit(50);
}

export async function requestBackup(ctx: Ctx, runner?: Runner) {
  const r = await createBackup(ctx.db, ctx.env, { kind: 'manual', runner });
  await audit(ctx, 'backup.create', { type: 'backup', id: r.id });
  return r;
}

export async function getBackup(ctx: Ctx, id: string) {
  const [b] = await ctx.db.select().from(backupRuns).where(eq(backupRuns.id, id));
  if (!b) throw notFound('Backup');
  return b;
}
