import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, duplicateCandidates, eq, fileInstances, mediaObjects, scanRuns, storageRoots, type DbHandle } from '@creatoros/db';
import { detectNearDuplicates, processIngest, getHashRequests, type AuthedAgent, type Ctx } from '@creatoros/services';
import { makeOrg, makeRoot, openDb, pairTestDevice } from '../src/helpers';

let h: DbHandle;
beforeAll(() => {
  h = openDb();
});
afterAll(async () => {
  await h.close();
});

const T0 = 1_700_000_000_000;
let seq = 0;
const file = (path: string, over: Record<string, unknown> = {}) => ({
  eventId: `${randomUUID()}:${seq}`,
  seq: seq++,
  kind: 'file' as const,
  path,
  size: 1000,
  mtimeMs: T0,
  fileId: `id:${path}`,
  state: 'STABLE' as const,
  stableObservations: 2,
  quickSignature: `q:${path}`,
  ...over,
});

async function setup() {
  const org = await makeOrg(h);
  const dev = await pairTestDevice(org.ctx);
  const root = await makeRoot(org.ctx, dev.deviceId, 'D:\\Media');
  const agent = (await dev.authFor('{}')) as AuthedAgent;
  const send = (runId: string, phase: 'START' | 'PROGRESS' | 'END', observations: any[] = [], extra: Record<string, unknown> = {}) =>
    processIngest(h.db, org.env, agent, { rootId: root.id, runId, phase, observations, ...extra });
  return { org, dev, root, agent, send, ctx: org.ctx as Ctx };
}

const inst = async (rootId: string) => h.db.select().from(fileInstances).where(eq(fileInstances.rootId, rootId));

describe('agent ingest', () => {
  it('records files once and replays are idempotent (T11)', async () => {
    const { root, send } = await setup();
    const run = randomUUID();
    const obs = [file('D:\\Media\\a.mp4'), file('D:\\Media\\b.mp4')];
    const r1 = await send(run, 'START', obs);
    expect(r1.accepted).toBe(2);
    const r2 = await send(run, 'PROGRESS', obs);
    expect(r2.accepted).toBe(0);
    expect(r2.duplicates).toBe(2);
    expect((await inst(root.id)).length).toBe(2);
    const [r] = await h.db.select().from(scanRuns).where(eq(scanRuns.runId, run));
    expect(r!.newCount).toBe(2);
  });

  it('rejects paths outside the root (T12) and foreign roots', async () => {
    const { root, send, org } = await setup();
    const r = await send(randomUUID(), 'START', [file('C:\\Windows\\System32\\evil.dll'), file('D:\\Media\\..\\Secret\\x.mp4'), file('D:\\Media\\ok.mp4')]);
    expect(r.rejected).toBe(2);
    expect(r.accepted).toBe(1);
    expect((await inst(root.id)).map((x) => x.fileName)).toEqual(['ok.mp4']);
    const other = await setup();
    await expect(processIngest(h.db, org.env, other.agent, { rootId: root.id, runId: randomUUID(), phase: 'START', observations: [] })).rejects.toMatchObject({ status: 403 });
  });

  it('detects moves by file id instead of creating a new instance (T08)', async () => {
    const { root, send } = await setup();
    const run1 = randomUUID();
    await send(run1, 'START', [file('D:\\Media\\old.mp4', { fileId: 'FID1' })]);
    await send(run1, 'END', [], { complete: true });
    const [before] = await inst(root.id);
    const run2 = randomUUID();
    await send(run2, 'START', [file('D:\\Media\\sub\\renamed.mp4', { fileId: 'FID1' })]);
    await send(run2, 'END', [], { complete: true });
    const rows = await inst(root.id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(before!.id);
    expect(rows[0]!.fileName).toBe('renamed.mp4');
    expect(rows[0]!.availability).toBe('AVAILABLE');
  });

  it('marks missing only after complete scans and the grace period, and restores (T09)', async () => {
    const { root, send, org, agent } = await setup();
    const t = (n: number) => new Date(Date.now() + n * 3600_000);
    const keep = file('D:\\Media\\keep.mp4');
    const gone = file('D:\\Media\\gone.mp4');
    const r1 = randomUUID();
    await send(r1, 'START', [keep, gone]);
    await send(r1, 'END', [], { complete: true });
    // incomplete scan must never mark anything missing
    const r2 = randomUUID();
    await send(r2, 'START', [file('D:\\Media\\keep.mp4', { eventId: randomUUID() })]);
    await send(r2, 'END', [], { complete: false });
    expect((await inst(root.id)).every((x) => x.availability === 'AVAILABLE')).toBe(true);
    // complete scan 1 without 'gone'
    const r3 = randomUUID();
    await send(r3, 'START', [file('D:\\Media\\keep.mp4', { eventId: randomUUID() })]);
    await send(r3, 'END', [], { complete: true });
    let g = (await inst(root.id)).find((x) => x.fileName === 'gone.mp4')!;
    expect(g.availability).toBe('MISSING_CANDIDATE');
    // complete scan 2 (grace 0h so confirmation is immediate on the 2nd miss)
    const r4 = randomUUID();
    await processIngest(h.db, org.env, agent, { rootId: root.id, runId: r4, phase: 'START', observations: [file('D:\\Media\\keep.mp4', { eventId: randomUUID() })] }, { missingGraceHours: 0, now: t(1) });
    await processIngest(h.db, org.env, agent, { rootId: root.id, runId: r4, phase: 'END', complete: true, observations: [] }, { missingGraceHours: 0, now: t(1) });
    g = (await inst(root.id)).find((x) => x.fileName === 'gone.mp4')!;
    expect(g.availability).toBe('CONFIRMED_MISSING');
    // the file comes back
    const r5 = randomUUID();
    await send(r5, 'START', [file('D:\\Media\\gone.mp4', { eventId: randomUUID() }), file('D:\\Media\\keep.mp4', { eventId: randomUUID() })]);
    g = (await inst(root.id)).find((x) => x.fileName === 'gone.mp4')!;
    expect(g.availability).toBe('AVAILABLE');
    expect(g.missingChecks).toBe(0);
  });

  it('an empty "complete" scan of a previously populated root is treated as unreachable, not mass-missing', async () => {
    const { root, send } = await setup();
    const r1 = randomUUID();
    await send(r1, 'START', [file('D:\\Media\\a.mp4'), file('D:\\Media\\b.mp4')]);
    await send(r1, 'END', [], { complete: true });
    const r2 = randomUUID();
    await send(r2, 'START', []);
    await send(r2, 'END', [], { complete: true });
    expect((await inst(root.id)).every((x) => x.availability === 'AVAILABLE')).toBe(true);
    const [rt] = await h.db.select().from(storageRoots).where(eq(storageRoots.id, root.id));
    expect(rt!.state).toBe('UNREACHABLE');
  });

  it('links identical content to one media object and never trusts stale or still-writing hashes (T04/T10)', async () => {
    const { root, send } = await setup();
    const HASH = 'a'.repeat(64);
    const run = randomUUID();
    await send(run, 'START', [file('D:\\Media\\x.mp4'), file('D:\\Media\\copy\\x2.mp4', { fileId: 'other' }), file('D:\\Media\\wip.mp4', { state: 'STILL_WRITING' })]);
    await send(run, 'PROGRESS', [
      { eventId: randomUUID(), seq: seq++, kind: 'hash', path: 'D:\\Media\\x.mp4', size: 1000, mtimeMs: T0, fullHash: HASH },
      { eventId: randomUUID(), seq: seq++, kind: 'hash', path: 'D:\\Media\\copy\\x2.mp4', size: 1000, mtimeMs: T0, fullHash: HASH },
      { eventId: randomUUID(), seq: seq++, kind: 'hash', path: 'D:\\Media\\wip.mp4', size: 1000, mtimeMs: T0, fullHash: 'b'.repeat(64) },
    ]);
    const rows = await inst(root.id);
    const x = rows.find((r) => r.fileName === 'x.mp4')!;
    const x2 = rows.find((r) => r.fileName === 'x2.mp4')!;
    const wip = rows.find((r) => r.fileName === 'wip.mp4')!;
    expect(x.mediaObjectId).toBeTruthy();
    expect(x.mediaObjectId).toBe(x2.mediaObjectId);
    expect(wip.fullHash).toBeNull();
    // stale hash (size changed since hashing) is rejected
    await send(run, 'PROGRESS', [{ eventId: randomUUID(), seq: seq++, kind: 'hash', path: 'D:\\Media\\x.mp4', size: 999, mtimeMs: T0, fullHash: 'c'.repeat(64) }]);
    const [after] = await h.db.select().from(fileInstances).where(eq(fileInstances.id, x.id));
    expect(after!.fullHash).toBe(HASH);
    const mos = await h.db.select().from(mediaObjects).where(eq(mediaObjects.exactHash, HASH));
    expect(mos.length).toBe(1);
  });

  it('a modified file drops its old hash and identity', async () => {
    const { root, send } = await setup();
    const run = randomUUID();
    await send(run, 'START', [file('D:\\Media\\v.mp4')]);
    await send(run, 'PROGRESS', [{ eventId: randomUUID(), seq: seq++, kind: 'hash', path: 'D:\\Media\\v.mp4', size: 1000, mtimeMs: T0, fullHash: 'd'.repeat(64) }]);
    const r2 = randomUUID();
    await send(r2, 'START', [file('D:\\Media\\v.mp4', { size: 5000, mtimeMs: T0 + 60_000 })]);
    const [row] = await inst(root.id);
    expect(row!.fullHash).toBeNull();
    expect(row!.mediaObjectId).toBeNull();
    expect(row!.size).toBe(5000);
  });

  it('hash candidates mode only requests files sharing size + quick signature', async () => {
    const org = await makeOrg(h);
    const dev = await pairTestDevice(org.ctx);
    const root = await makeRoot(org.ctx, dev.deviceId, 'E:\\Work', { hashMode: 'candidates' });
    const agent = await dev.authFor('{}');
    const run = randomUUID();
    const res = await processIngest(h.db, org.env, agent, {
      rootId: root.id,
      runId: run,
      phase: 'START',
      observations: [
        file('E:\\Work\\one.mov', { quickSignature: 'same', size: 77 }),
        file('E:\\Work\\two.mov', { quickSignature: 'same', size: 77, fileId: 'z' }),
        file('E:\\Work\\unique.mov', { quickSignature: 'uniq', size: 78, fileId: 'y' }),
      ],
    });
    expect(res.wantHash.map((w) => w.path).sort()).toEqual(['E:\\Work\\one.mov', 'E:\\Work\\two.mov']);
    expect((await getHashRequests(h.db, agent)).length).toBe(2);
  });

  it('skips alias roots for the same physical share', async () => {
    const { root, send } = await setup();
    await send(randomUUID(), 'START', [file('D:\\Media\\a.mp4')]);
    expect((await inst(root.id)).length).toBe(1);
  });
});

describe('near-duplicate detection', () => {
  it('flags similar names with similar duration, ignores unrelated files, is repeatable (T14)', async () => {
    const { root, dev, ctx } = await setup();
    const mk = async (name: string, hash: string, size: number, durationMs: number) => {
      const [mo] = await h.db
        .insert(mediaObjects)
        .values({ orgId: ctx.orgId, exactHash: hash.repeat(64).slice(0, 64), size, kind: 'VIDEO', tech: { durationMs, width: 1920, height: 1080 } })
        .returning();
      await h.db.insert(fileInstances).values({ orgId: ctx.orgId, rootId: root.id, deviceId: dev.deviceId, canonicalPath: `d:/media/${name}`, displayPath: `D:\\Media\\${name}`, fileName: name, ext: 'mp4', size, mediaObjectId: mo!.id, fileType: 'VIDEO', fullHash: mo!.exactHash });
      return mo!;
    };
    const a = await mk('rooftop_session_final.mp4', 'a', 5_000_000, 180_000);
    const b = await mk('rooftop_session_final_v2.mp4', 'b', 5_100_000, 180_400);
    await mk('completely different thing.mp4', 'c', 9_000_000, 30_000);

    const first = await detectNearDuplicates(ctx);
    expect(first.suggested).toBe(1);
    const second = await detectNearDuplicates(ctx);
    expect(second.suggested).toBe(0);
    const rows = await h.db.select().from(duplicateCandidates).where(eq(duplicateCandidates.orgId, ctx.orgId));
    expect(rows.length).toBe(1);
    expect([rows[0]!.mediaAId, rows[0]!.mediaBId].sort()).toEqual([a.id, b.id].sort());
  });
});

void and;
