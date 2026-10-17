// The real Go agent scanning a generated fixture library with real media (ffmpeg test patterns).
// Covers: exact duplicates under different names/folders/Unicode paths (T04), same-name different-content files (T05),
// similar re-encode is not an exact duplicate (T06), late-written file is held back until it settles (T07),
// truncated/corrupt media is still indexed with a visible probe failure, hidden files, extension filtering, real probing.
// Skipped when Go or ffmpeg is not installed.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@creatoros/db';
import { FIXTURE_EXTENSIONS, findFfmpeg, generateFixtureLibrary } from '../../fixtures/generate';
import { freshDb, makeApi, type Api } from '../src/helpers';

const V1 = '/api/v1';
const OWNER = {
  email: 'owner@creator.test',
  password: 'violet harbor lantern quartz',
  name: 'Owner',
  orgName: 'Creator Test',
  timezone: 'America/Vancouver',
  currency: 'CAD',
};
const agentSrc = path.resolve(import.meta.dirname, '../../../apps/scanner-agent');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findGo(): string | null {
  if (spawnSync('go', ['version'], { shell: process.platform === 'win32' }).status === 0) return 'go';
  return (
    ['C:\\Program Files\\Go\\bin\\go.exe', 'C:\\Go\\bin\\go.exe', '/usr/local/go/bin/go'].find((p) =>
      existsSync(p),
    ) ?? null
  );
}
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
async function until<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await wait(750);
  }
  throw new Error(`timed out waiting for: ${label}${last ? ` (${String(last)})` : ''}`);
}

const goBin = findGo();
const ffmpeg = findFfmpeg();
const suite = goBin && ffmpeg ? describe : describe.skip;

suite('fixture library through the real agent', () => {
  let fresh: Awaited<ReturnType<typeof freshDb>>;
  let api: Api;
  let owner = '';
  let base = '';
  let tmp = '';
  let agentExe = '';
  let agentDir = '';
  let lib = '';
  let finalCut = '';
  let agent: ChildProcess | undefined;
  let rootId = '';
  const j = (r: { body: any }) => r.body.data;
  const rows = async (q: ReturnType<typeof sql>) =>
    ((await fresh.handle.db.execute(q)) as unknown as { rows: any[] }).rows;
  const runAgent = (args: string[]) =>
    new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const c = spawn(agentExe, args, { env: { ...process.env, CREATOROS_AGENT_DIR: agentDir } });
      let stderr = '';
      c.stderr.on('data', (d) => (stderr += d));
      c.on('close', (status) => resolve({ status, stderr }));
    });
  const scanNow = async () =>
    expect((await api.call('POST', `${V1}/roots/${rootId}/scan`, { cookie: owner, body: {} })).status).toBe(
      202,
    );

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cos-fixture-'));
    agentExe = path.join(tmp, `agent${process.platform === 'win32' ? '.exe' : ''}`);
    const b = spawnSync(goBin!, ['build', '-o', agentExe, './cmd/creatoros-agent'], {
      cwd: agentSrc,
      encoding: 'utf8',
    });
    if (b.status !== 0) throw new Error(`go build failed: ${b.stderr}`);
    lib = path.join(tmp, 'Library');
    finalCut = generateFixtureLibrary(lib, ffmpeg!).finalCut;
    agentDir = path.join(tmp, 'agent-state');

    fresh = await freshDb();
    api = await makeApi(fresh.handle, fresh.url);
    owner = (await api.call('POST', `${V1}/setup/bootstrap`, { body: OWNER })).cookie!;
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(api.app.server.address() as net.AddressInfo).port}`;

    const code = j(
      await api.call('POST', `${V1}/pairing-codes`, { cookie: owner, body: { label: 'Fixture PC' } }),
    ).code;
    const paired = await runAgent([
      'pair',
      '--server',
      base,
      '--code',
      code,
      '--listen',
      `127.0.0.1:${await freePort()}`,
    ]);
    expect(paired.status, paired.stderr).toBe(0);
    const deviceId = (await rows(sql`select id from devices`))[0].id as string;
    const created = await api.call('POST', `${V1}/roots`, {
      cookie: owner,
      body: {
        deviceId,
        label: 'Fixture Library',
        displayPath: lib,
        extensions: FIXTURE_EXTENSIONS,
        settleSeconds: 20,
        scanIntervalMinutes: 1,
        hashMode: 'all',
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    rootId = j(created).id;
    agent = spawn(agentExe, ['run'], {
      env: { ...process.env, CREATOROS_AGENT_DIR: agentDir },
      stdio: 'ignore',
    });
  }, 240_000);

  afterAll(async () => {
    agent?.kill();
    await wait(300);
    await api?.close();
    await fresh?.drop();
    try {
      if (tmp.startsWith(os.tmpdir())) rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  const byName = (all: any[], rel: string) =>
    all.find((r) => r.display_path.endsWith(rel.replaceAll('/', path.sep)));

  it('indexes, hashes and probes the whole library; extension filter and hidden files behave', async () => {
    const all = await until(
      'ten hashed, probed files',
      async () => {
        const r = await rows(
          sql`select display_path, file_name, size, probe_state, full_hash, media_object_id, file_type, availability, tech from file_instances where root_id = ${rootId} order by display_path`,
        );
        return r.length === 10 &&
          r.every((x) => x.full_hash && x.probe_state !== 'PENDING' && x.probe_state !== 'NONE')
          ? r
          : undefined;
      },
      120_000,
    );
    expect(all.some((r) => r.file_name === 'readme.txt')).toBe(false); // extension filter
    expect(all.every((r) => r.availability === 'AVAILABLE')).toBe(true);
    expect(all.some((r) => r.file_name === '.hidden-song.wav')).toBe(true); // hidden dot-files are ordinary files

    // real probing of generated media
    const fc = byName(all, 'video/final cut.mp4');
    expect(fc.file_type).toBe('VIDEO');
    expect(fc.probe_state).toBe('INDEXED');
    expect(fc.tech).toMatchObject({ width: 320, height: 240, hasAudio: true, codec: 'h264' });
    expect(fc.tech.durationMs).toBeGreaterThan(1500);
    expect(fc.tech.durationMs).toBeLessThan(2600);
    const song = byName(all, 'audio/song.wav');
    expect(song.file_type).toBe('AUDIO');
    expect(song.tech.durationMs).toBeGreaterThan(1200);
    expect(byName(all, 'images/cover.png').tech).toMatchObject({ width: 64, height: 64 });

    // Unicode and spaces survive end to end, byte for byte
    expect(byName(all, 'archive/Été à Paris/clip 日本語.mp4')).toBeTruthy();
    expect(byName(all, 'video/copy of final cut.mp4')).toBeTruthy();

    // T04: three exact copies (different names/folders) = one media object, three locations
    const copies = [
      fc,
      byName(all, 'video/copy of final cut.mp4'),
      byName(all, 'archive/Été à Paris/clip 日本語.mp4'),
    ];
    expect(new Set(copies.map((c) => c.media_object_id)).size).toBe(1);
    expect(new Set(copies.map((c) => c.full_hash)).size).toBe(1);
    // the hidden copy of the song is the same media object as the song
    expect(byName(all, 'audio/.hidden-song.wav').media_object_id).toBe(song.media_object_id);

    // T06: a similar re-encode is NOT an exact duplicate
    const re = byName(all, 'video/final cut (re-encode).mp4');
    expect(re.media_object_id).not.toBe(fc.media_object_id);
    expect(re.full_hash).not.toBe(fc.full_hash);

    // T05: same filename, different content stay distinct
    const takes = all.filter((r) => r.file_name === 'take.mp4');
    expect(takes).toHaveLength(2);
    expect(new Set(takes.map((t) => t.media_object_id)).size).toBe(2);

    // corrupt/truncated media is indexed and honest about it, never silently dropped
    const bad = byName(all, 'video/truncated.mp4');
    expect(bad.probe_state).toBe('PROBE_FAILED');
    expect(bad.availability).toBe('AVAILABLE');

    // the API library agrees (and the exact-duplicate view lists the 3-copy group)
    const dups = j(await api.call('GET', `${V1}/duplicates/exact`, { cookie: owner }));
    const group = dups.find((g: any) => g.copies === 3);
    expect(group, JSON.stringify(dups)).toBeTruthy();
    const counts = j(await api.call('GET', `${V1}/library/counts`, { cookie: owner }));
    expect(counts.total).toBe(10);
  }, 240_000);

  it('a file that is still being written is held back until it settles, then hashed', async () => {
    const growing = path.join(lib, 'video', 'growing.mp4');
    writeFileSync(growing, readFileSync(finalCut)); // a fresh mtime (a plain copy can keep the source's timestamps): the agent cannot know the writer is finished
    await scanNow();
    const early = await until('growing.mp4 reported', async () => {
      const r = await rows(
        sql`select probe_state, full_hash, availability from file_instances where root_id = ${rootId} and file_name = 'growing.mp4'`,
      );
      return r[0];
    });
    expect(early.full_hash).toBeNull();
    expect(early.probe_state).toBe('STILL_WRITING');

    // after the settle window the next scans confirm it is stable and it gets hashed
    await wait(21_000);
    await scanNow();
    await wait(1500);
    await scanNow();
    const settled = await until(
      'growing.mp4 hashed after settling',
      async () => {
        const r = await rows(
          sql`select probe_state, full_hash from file_instances where root_id = ${rootId} and file_name = 'growing.mp4'`,
        );
        return r[0]?.full_hash ? r[0] : undefined;
      },
      90_000,
    );
    expect(settled.probe_state).not.toBe('STILL_WRITING');
    const fcRow = (
      await rows(
        sql`select full_hash from file_instances where root_id = ${rootId} and file_name = 'final cut.mp4'`,
      )
    )[0];
    expect(settled.full_hash).toBe(fcRow.full_hash); // it is a byte-identical copy of the original
  }, 240_000);
});
