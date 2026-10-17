import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql, devices } from '@creatoros/db';
import {
  JOB_TABLE,
  jobActions,
  jobBackup,
  jobEvents,
  jobHeartbeat,
  jobMaintenance,
  jobRestoreTest,
  jobSync,
  type WorkerDeps,
} from '@creatoros/worker';
import {
  completeAction,
  createInvoice,
  ingestMessage,
  issueInvoice,
  listActions,
  listNotifications,
  recordPayment,
  systemHealth,
  createDeal,
  pruneBackups,
  listBackups,
  requestBackup,
} from '@creatoros/services';
import { dockerRunner, makeOrg, openDb, pairTestDevice, testEnv } from '../src/helpers';

const h = openDb();
afterAll(() => h.close());
const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;
const HOUR = 3600_000;

const deps = (env = testEnv()): WorkerDeps => ({ db: h.db, env, runner: dockerRunner() });

describe('worker jobs (T27-T32)', () => {
  it('actions engine: unanswered inbound creates ONE action, never recreates a closed one (T27)', async () => {
    const org = await makeOrg(h);
    const d = deps(org.env);
    await ingestMessage(org.ctx, {
      source: 'MANUAL',
      direction: 'INBOUND',
      receivedAt: new Date(Date.now() - 50 * HOUR),
      fromEmail: 'pr@brand.test',
      fromName: 'Brand',
      subject: 'Collab proposal',
      body: 'We would love to work with you. Budget 1000 USD.',
    });
    await jobActions(d);
    await jobActions(d); // second run must not duplicate
    const open = (await listActions(org.ctx, { state: 'OPEN' })).filter((a: any) =>
      /Collab proposal/.test(a.title),
    );
    expect(open).toHaveLength(1);
    await completeAction(org.ctx, open[0]!.id, 'replied by email');
    await jobActions(d);
    const again = (await listActions(org.ctx, {})).filter(
      (a: any) => /Collab proposal/.test(a.title) && a.state === 'OPEN',
    );
    expect(again).toHaveLength(0);
  });

  it('actions engine resolves actions whose condition cleared by itself (reply logged) (T28)', async () => {
    const org = await makeOrg(h);
    const d = deps(org.env);
    await ingestMessage(org.ctx, {
      source: 'MANUAL',
      direction: 'INBOUND',
      receivedAt: new Date(Date.now() - 40 * HOUR),
      fromEmail: 'x@brand.test',
      subject: 'Please reply',
      providerThreadId: 'thr-28',
      body: 'We would love to work with you on a sponsored video. Budget 1000 USD.',
    });
    await jobActions(d);
    expect(
      (await listActions(org.ctx, { state: 'OPEN' })).some((a: any) => /Please reply/.test(a.title)),
    ).toBe(true);
    await ingestMessage(org.ctx, {
      source: 'MANUAL',
      direction: 'OUTBOUND',
      receivedAt: new Date(),
      subject: 'Re: Please reply',
      body: 'Yes, happy to!',
      providerThreadId: 'thr-28',
    });
    await jobActions(d);
    expect(
      (await listActions(org.ctx, { state: 'OPEN' })).some((a: any) => /Please reply/.test(a.title)),
    ).toBe(false);
  });

  it('overdue invoices are refreshed and notified once; payment emits invoice.paid (T29)', async () => {
    const org = await makeOrg(h);
    const d = deps(org.env);
    const deal = await createDeal(org.ctx, { title: 'Overdue deal', currency: 'CAD' } as any);
    const inv = await createInvoice(org.ctx, {
      dealId: deal.id,
      amountMinor: 50000,
      currency: 'CAD',
      draft: true,
    });
    await issueInvoice(org.ctx, inv.id, new Date(Date.now() - 3 * 86400_000));
    await jobActions(d);
    await jobEvents(d);
    await jobActions(d);
    await jobEvents(d);
    const st = rows<{ status: string }>(
      await h.db.execute(sql`select status from invoices where id = ${inv.id}`),
    )[0]!.status;
    expect(st).toBe('OVERDUE');
    const overdue = (await listNotifications(org.ctx, {})).filter((n: any) => n.type === 'invoice.overdue');
    expect(overdue.length).toBe(1);
    await recordPayment(org.ctx, inv.id, { amountMinor: 50000 });
    await jobEvents(d);
    expect((await listNotifications(org.ctx, {})).some((n: any) => n.type === 'invoice.paid')).toBe(true);
  });

  it('stale devices are marked OFFLINE with one notification, not MISSING (T30)', async () => {
    const org = await makeOrg(h);
    const dev = await pairTestDevice(org.ctx);
    await h.db
      .update(devices)
      .set({ state: 'ONLINE', lastSeenAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(devices.id, dev.deviceId));
    const d = deps(org.env);
    const out = await jobEvents(d);
    expect(out.devicesMarkedOffline).toBeGreaterThanOrEqual(1);
    await jobEvents(d);
    await jobEvents(d);
    const [row] = await h.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, dev.deviceId)));
    expect(row!.state).toBe('OFFLINE');
    const n = (await listNotifications(org.ctx, {})).filter((x: any) => x.type === 'agent.offline');
    expect(n).toHaveLength(1);
  });

  it('heartbeat makes system health report the worker as alive (T31)', async () => {
    const d = deps();
    await jobHeartbeat(d);
    const health = await systemHealth(h.db, d.env);
    expect(health.checks.worker!.ok).toBe(true);
    expect(health.checks.database!.ok).toBe(true);
  });

  it('sync with nothing configured is a no-op, and maintenance runs cleanly (T32)', async () => {
    const d = deps();
    const s = await jobSync(d, 'all');
    expect(s.failed).toBe(0);
    await jobMaintenance(d);
    expect(Object.keys(JOB_TABLE)).toEqual(
      expect.arrayContaining(['events', 'actions', 'backup', 'restore-test']),
    );
  });
});

describe('backup and restore (T33)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'creatoros-bk-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it.skipIf(!process.env.TEST_PG_CONTAINER)(
    'creates a verified backup, restores it into a scratch database and prunes by retention',
    async () => {
      const org = await makeOrg(h);
      await createDeal(org.ctx, { title: 'Backup canary deal' } as any);
      const env = testEnv({
        backupDir: path.join(tmp, 'backups'),
        attachmentsDir: path.join(tmp, 'attachments'),
      });
      fs.mkdirSync(env.attachmentsDir, { recursive: true });
      fs.writeFileSync(path.join(env.attachmentsDir, 'note.txt'), 'attachment');
      const d = deps(env);
      const out = await jobBackup(d, 'manual');
      expect(out.verified).toBe(true);
      const files = fs.readdirSync(env.backupDir);
      expect(files.some((f) => f.endsWith('.dump'))).toBe(true);
      expect(files.some((f) => f.endsWith('.manifest.json'))).toBe(true);
      expect(files.some((f) => f.endsWith('attachments.tar.gz'))).toBe(true);
      const rt = (await jobRestoreTest(d)) as any;
      expect(rt.ok).toBe(true);
      expect(rt.counts.deals?.restored ?? rt.counts.deals).toBeTruthy();
      // corruption is detected
      const dump = path.join(
        env.backupDir,
        files.find((f) => f.endsWith('.dump'))!,
      );
      const bytes = fs.readFileSync(dump);
      bytes[bytes.length - 10] ^= 0xff;
      fs.writeFileSync(dump, bytes);
      const { verifyBackup } = await import('@creatoros/services');
      await expect(verifyBackup(h.db, env, dump, { runner: dockerRunner() })).rejects.toThrow(
        /Checksum mismatch/,
      );
      // retention keeps 7 daily / 4 weekly / 6 monthly
      const base = Date.now();
      for (let i = 0; i < 12; i++) {
        const f = path.join(env.backupDir, `creatoros-fake-${i}.dump`);
        fs.writeFileSync(f, 'x'.repeat(2000));
        fs.writeFileSync(f + '.manifest.json', '{}');
        const t = new Date(base - i * 86400_000 * 3);
        fs.utimesSync(f, t, t);
      }
      const pruned = await pruneBackups(env, { daily: 7, weekly: 4, monthly: 6 });
      expect(pruned.kept.length).toBeLessThan(13);
      expect(pruned.removed.length).toBeGreaterThan(0);
      expect((await listBackups(org.ctx)).length).toBeGreaterThan(0);
      void requestBackup;
    },
  );
});
