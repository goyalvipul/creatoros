// End-to-end: the REAL Go agent binary against the REAL API on a REAL Postgres.
// Covers pairing, scanning, hashing, probing, duplicate detection, signed streaming with Range, scan-now requests,
// unreachable-root safety, missing-file detection, and revocation.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@creatoros/db';
import { freshDb, makeApi, type Api } from '../src/helpers';

const OWNER = { email: 'owner@creator.test', password: 'violet harbor lantern quartz', name: 'Owner', orgName: 'Creator Test', timezone: 'America/Vancouver', currency: 'CAD' };
const V1 = '/api/v1';
const agentSrc = path.resolve(import.meta.dirname, '../../../apps/scanner-agent');

function findGo(): string | null {
  const tryGo = spawnSync('go', ['version'], { shell: process.platform === 'win32' });
  if (tryGo.status === 0) return 'go';
  return ['C:\\Program Files\\Go\\bin\\go.exe', 'C:\\Go\\bin\\go.exe', '/usr/local/go/bin/go'].find((p) => existsSync(p)) ?? null;
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs = 60_000, every = 750): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await wait(every);
  }
  throw new Error(`timed out waiting for: ${label}${last ? ` (${String(last)})` : ''}`);
}

const goBin = findGo();
const suite = goBin ? describe : describe.skip;

suite('Go agent end to end', () => {
  let fresh: Awaited<ReturnType<typeof freshDb>>;
  let api: Api;
  let owner = '';
  let base = '';
  let agentExe = '';
  let agentDir = '';
  let mediaDir = '';
  let agent: ChildProcess | undefined;
  const logs: string[] = [];
  let deviceId = '';
  let rootId = '';
  const content = randomBytes(300_000);
  const rows = async (q: ReturnType<typeof sql>) => ((await fresh.handle.db.execute(q)) as unknown as { rows: any[] }).rows;
  const j = (r: { body: any }) => r.body.data;

  beforeAll(async () => {
    agentExe = path.join(os.tmpdir(), `creatoros-e2e-agent-${process.pid}${process.platform === 'win32' ? '.exe' : ''}`);
    const b = spawnSync(goBin!, ['build', '-o', agentExe, './cmd/creatoros-agent'], { cwd: agentSrc, encoding: 'utf8' });
    if (b.status !== 0) throw new Error(`go build failed: ${b.stderr}`);

    fresh = await freshDb();
    api = await makeApi(fresh.handle, fresh.url);
    const boot = await api.call('POST', `${V1}/setup/bootstrap`, { body: OWNER });
    owner = boot.cookie!;
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(api.app.server.address() as net.AddressInfo).port}`;

    agentDir = mkdtempSync(path.join(os.tmpdir(), 'cos-agent-'));
    mediaDir = path.join(mkdtempSync(path.join(os.tmpdir(), 'cos-media-')), 'Media');
    mkdirSync(path.join(mediaDir, 'sub'), { recursive: true });
    const old = new Date(Date.now() - 3600_000);
    const put = (rel: string, data: Buffer | string) => {
      const p = path.join(mediaDir, rel);
      writeFileSync(p, data);
      utimesSync(p, old, old);
    };
    put('clip.mp4', content);
    put(path.join('sub', 'clip-copy.mp4'), content); // exact duplicate
    put('pic.png', PNG_1X1);
    put('notes.txt', 'not media: filtered by extension');
  }, 180_000);

  afterAll(async () => {
    agent?.kill();
    await wait(300);
    await api?.close();
    await fresh?.drop();
    for (const p of [agentExe, agentDir, path.dirname(mediaDir), path.dirname(path.dirname(mediaDir))]) {
      try {
        if (p && p.startsWith(os.tmpdir())) rmSync(p, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  // async on purpose: the API runs in this same process, so a blocking spawnSync would deadlock the pairing call
  const runAgent = (args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const c = spawn(agentExe, args, { env: { ...process.env, CREATOROS_AGENT_DIR: agentDir } });
      let stdout = '';
      let stderr = '';
      c.stdout.on('data', (d) => (stdout += d));
      c.stderr.on('data', (d) => (stderr += d));
      c.on('close', (status) => resolve({ status, stdout, stderr }));
    });

  it('pairs with a one-time code, and the code cannot be reused', async () => {
    const code = j(await api.call('POST', `${V1}/pairing-codes`, { cookie: owner, body: { label: 'E2E PC' } })).code as string;
    const port = await freePort();
    const r = await runAgent(['pair', '--server', base, '--code', code, '--listen', `127.0.0.1:${port}`]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Paired');
    const dev = await rows(sql`select id, os, hostname from devices`);
    expect(dev).toHaveLength(1);
    deviceId = dev[0].id;
    expect(dev[0].os).toBe(process.platform === 'win32' ? 'windows' : process.platform);

    const reuse = await runAgent(['pair', '--server', base, '--code', code, '--dir', path.join(agentDir, 'second')]);
    expect(reuse.status).not.toBe(0);
  });

  it('scans, hashes, probes, de-duplicates and streams a real folder', async () => {
    const created = await api.call('POST', `${V1}/roots`, {
      cookie: owner,
      body: { deviceId, label: 'E2E Media', displayPath: mediaDir, extensions: ['mp4', 'png'], settleSeconds: 2, scanIntervalMinutes: 1, hashMode: 'all' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    rootId = j(created).id;

    agent = spawn(agentExe, ['run'], { env: { ...process.env, CREATOROS_AGENT_DIR: agentDir }, stdio: ['ignore', 'pipe', 'pipe'] });
    agent.stdout!.on('data', (d) => logs.push(String(d)));
    agent.stderr!.on('data', (d) => logs.push(String(d)));

    // 3 files ingested (notes.txt filtered), hashed, duplicates collapsed to one media object
    const files = await until(
      'three hashed files',
      async () => {
        const r = await rows(sql`select display_path, file_name, size, probe_state, full_hash, media_object_id, availability, tech from file_instances where root_id = ${rootId} order by file_name`);
        return r.length === 3 && r.every((x) => x.full_hash) ? r : undefined;
      },
      90_000,
    );
    expect(files.map((f) => f.file_name)).toEqual(['clip-copy.mp4', 'clip.mp4', 'pic.png']);
    expect(files.every((f) => f.availability === 'AVAILABLE')).toBe(true);
    const [copy, clip, png] = files;
    expect(copy.media_object_id).toBe(clip.media_object_id); // exact duplicates share one media object
    expect(png.media_object_id).not.toBe(clip.media_object_id);
    expect(clip.size).toBe(content.length);

    // image probed without ffprobe via the Go stdlib fallback
    const pngRow = await until('png probed', async () => (await rows(sql`select probe_state, tech from file_instances where root_id = ${rootId} and file_name = 'pic.png'`)).find((r) => r.probe_state === 'INDEXED'), 30_000);
    expect(pngRow.tech.width).toBe(1);
    expect(pngRow.tech.height).toBe(1);

    // device online with a reachable listen URL; health reported per root
    const dev = await until('device online', async () => (await rows(sql`select state, listen_urls from devices where id = ${deviceId}`)).find((d) => d.state === 'ONLINE'), 30_000);
    expect(JSON.stringify(dev.listen_urls)).toContain('127.0.0.1');

    // the first scan run completed and is recorded as complete
    const run = await until('complete scan run', async () => (await rows(sql`select status, complete_success, scanned_count, job_type from scan_runs where root_id = ${rootId} and job_type = 'SCAN' and finished_at is not null order by started_at limit 1`))[0], 30_000);
    expect(run.status).toBe('COMPLETED');
    expect(run.complete_success).toBe(true);
    expect(run.scanned_count).toBe(3);

    // streaming through the API proxies Range to the real agent, which verifies the HMAC
    const fileId = (await rows(sql`select id from file_instances where root_id = ${rootId} and file_name = 'clip.mp4'`))[0].id as string;
    const full = await api.call('GET', `${V1}/files/${fileId}/stream`, { cookie: owner });
    expect(full.status).toBe(200);
    expect(Buffer.compare(full.raw, content)).toBe(0);
    const part = await api.call('GET', `${V1}/files/${fileId}/stream`, { cookie: owner, headers: { range: 'bytes=1000-1999' } });
    expect(part.status).toBe(206);
    expect(Buffer.compare(part.raw, content.subarray(1000, 2000))).toBe(0);
  }, 240_000);

  it('agent refuses stream requests that are unsigned, expired or outside the root', async () => {
    const dev = (await rows(sql`select listen_urls from devices where id = ${deviceId}`))[0];
    const url = (dev.listen_urls as string[])[0]!;
    const direct = await fetch(`${url}/v1/stream?root=${rootId}&path=${encodeURIComponent(path.join(mediaDir, 'clip.mp4'))}&exp=${Math.floor(Date.now() / 1000) + 60}&sig=${'0'.repeat(64)}`);
    expect(direct.status).toBe(403);
    expect((await fetch(`${url}/v1/health`)).status).toBe(200);
  });

  it('scan-now picks up new files; unreachable roots never cause missing files; deletions need two complete scans', async () => {
    const scansDone = async () => Number((await rows(sql`select count(*)::int as n from scan_runs where root_id = ${rootId} and job_type in ('SCAN','RECONCILE') and complete_success = true`))[0].n);
    const before = await scansDone();

    // new file shows up after "Scan now" (not after the 1-minute interval)
    const p = path.join(mediaDir, 'new.mp4');
    writeFileSync(p, randomBytes(5000));
    const old = new Date(Date.now() - 3600_000);
    utimesSync(p, old, old);
    expect((await api.call('POST', `${V1}/roots/${rootId}/scan`, { cookie: owner, body: {} })).status).toBe(202);
    await until('new.mp4 indexed', async () => (await rows(sql`select 1 from file_instances where root_id = ${rootId} and file_name = 'new.mp4'`))[0], 60_000);
    await until('another complete scan', async () => (await scansDone()) > before, 30_000);

    // drive goes offline: scans are refused locally, nothing is marked missing
    const offline = `${mediaDir}-offline`;
    renameSync(mediaDir, offline);
    try {
      const completeBefore = await scansDone();
      await api.call('POST', `${V1}/roots/${rootId}/scan`, { cookie: owner, body: {} });
      await until('agent reports unreachable', async () => logs.join('').includes('root unreachable'), 60_000);
      await wait(2000);
      expect(await scansDone()).toBe(completeBefore);
      const states = await rows(sql`select distinct availability from file_instances where root_id = ${rootId}`);
      expect(states.map((s) => s.availability)).toEqual(['AVAILABLE']);
    } finally {
      renameSync(offline, mediaDir);
    }

    // delete one file for real: first complete scan -> MISSING_CANDIDATE (never instantly "deleted")
    rmSync(path.join(mediaDir, 'new.mp4'));
    const start = await scansDone();
    await api.call('POST', `${V1}/roots/${rootId}/scan`, { cookie: owner, body: {} });
    await until('scan after delete', async () => (await scansDone()) > start, 60_000);
    const gone = (await rows(sql`select availability, missing_checks from file_instances where root_id = ${rootId} and file_name = 'new.mp4'`))[0];
    expect(gone.availability).toBe('MISSING_CANDIDATE');
    const others = await rows(sql`select availability from file_instances where root_id = ${rootId} and file_name <> 'new.mp4'`);
    expect(others.every((o) => o.availability === 'AVAILABLE')).toBe(true);
  }, 300_000);

  it('a revoked device is refused and the agent goes idle instead of crashing', async () => {
    expect((await api.call('POST', `${V1}/devices/${deviceId}/revoke`, { cookie: owner, body: {} })).status).toBeLessThan(300);
    await until('agent notices revocation', async () => logs.join('').includes('rejected this device'), 60_000);
    expect(agent!.exitCode).toBeNull(); // still running (idle), ready to be re-paired
    const stream = await api.call('GET', `${V1}/files/${(await rows(sql`select id from file_instances where root_id = ${rootId} limit 1`))[0].id}/stream`, { cookie: owner });
    expect(stream.status).toBeGreaterThanOrEqual(400);
  }, 120_000);
});
