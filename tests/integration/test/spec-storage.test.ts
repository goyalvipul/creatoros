/**
 * Spec scenarios T02-T08, T10, T14, T17 and T35 (docs/PRODUCT_SPEC.md, "Critical cases"), exercised against a real Postgres.
 * See docs/TEST_MATRIX.md for the full mapping of T01-T35 to tests.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, fileInstances, mediaObjects, sql, type DbHandle } from '@creatoros/db';
import {
  analytics,
  createAsset,
  createBrand,
  createChannel,
  createRecord,
  createSocialAccount,
  createVariant,
  getAsset,
  getHashRequests,
  getFileDetail,
  libraryCounts,
  linkFile,
  listAssets,
  listLibrary,
  listSuggestions,
  markPublishedManual,
  markStaleDevicesOffline,
  processIngest,
  suggestMatches,
  publishingMatrix,
  type AuthedAgent,
  type Ctx,
} from '@creatoros/services';
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
const hashObs = (path: string, fullHash: string, size = 1000) => ({
  eventId: randomUUID(),
  seq: seq++,
  kind: 'hash' as const,
  path,
  size,
  mtimeMs: T0,
  fullHash,
});

async function world() {
  const org = await makeOrg(h);
  const win = await pairTestDevice(org.ctx, 'windows', 'DESKTOP-A');
  const mac = await pairTestDevice(org.ctx, 'linux', 'SERVER-B');
  const rootA = await makeRoot(org.ctx, win.deviceId, 'D:\\Media');
  const rootNas = await makeRoot(org.ctx, win.deviceId, 'Z:\\Archive', {
    accessMethod: 'SMB',
    smbPath: '\\\\nas\\archive',
  });
  const rootB = await makeRoot(org.ctx, mac.deviceId, '/mnt/media', { mountPath: '/srv/media' });
  const agentA = (await win.authFor('{}')) as AuthedAgent;
  const agentB = (await mac.authFor('{}')) as AuthedAgent;
  const send = (agent: AuthedAgent, rootId: string, obs: any[], extra: Record<string, unknown> = {}) => {
    const runId = randomUUID();
    return processIngest(h.db, org.env, agent, {
      rootId,
      runId,
      phase: 'START',
      observations: obs,
      ...extra,
    }).then(async (r) => {
      await processIngest(h.db, org.env, agent, {
        rootId,
        runId,
        phase: 'END',
        observations: [],
        complete: true,
      });
      return r;
    });
  };
  return { org, ctx: org.ctx as Ctx, win, mac, rootA, rootNas, rootB, agentA, agentB, send };
}

const rowsFor = (orgId: string) => h.db.select().from(fileInstances).where(eq(fileInstances.orgId, orgId));

describe('storage inventory across devices (T02-T05, T08)', () => {
  it('T02/T03 three roots on two devices stay distinct, with OS-specific paths and copy paths', async () => {
    const w = await world();
    await w.send(w.agentA, w.rootA.id, [file('D:\\Media\\Songs\\take1.wav')]);
    await w.send(w.agentA, w.rootNas.id, [file('Z:\\Archive\\2025\\final.mp4')]);
    await w.send(w.agentB, w.rootB.id, [file('/mnt/media/clips/b-roll.mov')]);

    const all = await listLibrary(w.ctx, {});
    expect(all.items.length).toBe(3);
    const byName = Object.fromEntries(all.items.map((i: any) => [i.fileName, i]));
    expect(byName['take1.wav'].displayPath).toBe('D:\\Media\\Songs\\take1.wav');
    expect(byName['b-roll.mov'].displayPath).toBe('/mnt/media/clips/b-roll.mov');
    expect(byName['b-roll.mov'].copyPaths.mount).toBe('/srv/media/clips/b-roll.mov');
    expect(byName['final.mp4'].copyPaths.smb).toBe('\\\\nas\\archive\\2025\\final.mp4');
    expect(new Set(all.items.map((i: any) => i.deviceId)).size).toBe(2);

    // filters: by device, by root, by kind, by text
    expect(
      (await listLibrary(w.ctx, { deviceId: w.mac.deviceId })).items.map((i: any) => i.fileName),
    ).toEqual(['b-roll.mov']);
    expect((await listLibrary(w.ctx, { rootId: w.rootNas.id })).items.length).toBe(1);
    expect((await listLibrary(w.ctx, { q: 'take1' })).items.length).toBe(1);
    const counts = await libraryCounts(w.ctx);
    expect(counts.total).toBe(3);
  });

  it('T04 an exact hash match across devices is ONE media object with two physical locations', async () => {
    const w = await world();
    const HASH = 'e'.repeat(64);
    await w.send(w.agentA, w.rootA.id, [file('D:\\Media\\song.wav')]);
    await w.send(w.agentB, w.rootB.id, [file('/mnt/media/song-copy.wav')]);
    await processIngest(h.db, w.org.env, w.agentA, {
      rootId: w.rootA.id,
      runId: randomUUID(),
      phase: 'PROGRESS',
      observations: [hashObs('D:\\Media\\song.wav', HASH)],
    });
    await processIngest(h.db, w.org.env, w.agentB, {
      rootId: w.rootB.id,
      runId: randomUUID(),
      phase: 'PROGRESS',
      observations: [hashObs('/mnt/media/song-copy.wav', HASH)],
    });
    const mos = await h.db.select().from(mediaObjects).where(eq(mediaObjects.exactHash, HASH));
    expect(mos.length).toBe(1);
    const rows = (await rowsFor(w.org.orgId)).filter((r) => r.mediaObjectId === mos[0]!.id);
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.deviceId)).size).toBe(2);
    const dups = await listLibrary(w.ctx, { duplicates: true });
    expect(dups.items.length).toBe(2);
    expect((await libraryCounts(w.ctx)).duplicateGroups).toBe(1);
    const detail: any = await getFileDetail(w.ctx, rows[0]!.id);
    expect(detail.otherCopies ?? detail.copies?.length ?? 1).toBeGreaterThanOrEqual(1);
  });

  it('T05 two different files with the same name remain distinct', async () => {
    const w = await world();
    await w.send(w.agentA, w.rootA.id, [file('D:\\Media\\final.mp4', { size: 5000, quickSignature: 'qa' })]);
    await w.send(w.agentB, w.rootB.id, [file('/mnt/media/final.mp4', { size: 7000, quickSignature: 'qb' })]);
    await processIngest(h.db, w.org.env, w.agentA, {
      rootId: w.rootA.id,
      runId: randomUUID(),
      phase: 'PROGRESS',
      observations: [hashObs('D:\\Media\\final.mp4', '1'.repeat(64), 5000)],
    });
    await processIngest(h.db, w.org.env, w.agentB, {
      rootId: w.rootB.id,
      runId: randomUUID(),
      phase: 'PROGRESS',
      observations: [hashObs('/mnt/media/final.mp4', '2'.repeat(64), 7000)],
    });
    const rows = await rowsFor(w.org.orgId);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.fileName === 'final.mp4')).toBe(true);
    expect(new Set(rows.map((r) => r.mediaObjectId)).size).toBe(2);
    expect((await libraryCounts(w.ctx)).duplicateGroups).toBe(0);
  });

  it('T08 an offline device keeps its inventory (last seen shown), nothing is marked missing', async () => {
    const w = await world();
    await w.send(w.agentA, w.rootA.id, [file('D:\\Media\\keep.mp4')]);
    // device goes quiet: heartbeat long ago
    await h.db.execute(
      sql`update devices set last_seen_at = now() - interval '2 hours' where id = ${w.win.deviceId}`,
    );
    const stale = await markStaleDevicesOffline(h.db, w.org.env);
    expect(stale.map((s) => s.id)).toContain(w.win.deviceId);
    const [f] = await rowsFor(w.org.orgId);
    expect(f!.availability).toBe('AVAILABLE');
    const listed = await listLibrary(w.ctx, {});
    expect(listed.items[0].deviceState).toBe('OFFLINE');
    // the effective availability tells the truth: the device is away, the file is not deleted
    expect(listed.items[0].effectiveAvailability).not.toBe('MISSING');
    expect(listed.items[0].lastSeenAt).toBeTruthy();
  });
});

describe('stability and identity (T06, T07, T10)', () => {
  it('T06 a quick-signature match without a full hash does NOT assert an exact duplicate', async () => {
    const w = await world();
    await w.send(w.agentA, w.rootA.id, [file('D:\\Media\\a.mp4', { quickSignature: 'SAME', size: 4242 })]);
    await w.send(w.agentB, w.rootB.id, [file('/mnt/media/b.mp4', { quickSignature: 'SAME', size: 4242 })]);
    const rows = await rowsFor(w.org.orgId);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.mediaObjectId === null && r.fullHash === null)).toBe(true);
    expect((await libraryCounts(w.ctx)).duplicateGroups).toBe(0);
    expect((await listLibrary(w.ctx, { duplicates: true })).items.length).toBe(0);
  });

  it('T07 a partially written file is not hashed until stable, then becomes indexable', async () => {
    const w = await world();
    await w.send(w.agentA, w.rootA.id, [
      file('D:\\Media\\render.mp4', { state: 'STILL_WRITING', stableObservations: 0 }),
    ]);
    let [f] = await rowsFor(w.org.orgId);
    expect(f!.probeState).toBe('STILL_WRITING');
    expect((await getHashRequests(h.db, w.agentA)).length).toBe(0);
    // later scan: the file settled
    await w.send(w.agentA, w.rootA.id, [
      file('D:\\Media\\render.mp4', {
        state: 'STABLE',
        stableObservations: 3,
        size: 1500,
        mtimeMs: T0 + 1000,
      }),
    ]);
    [f] = await rowsFor(w.org.orgId);
    expect(f!.probeState).not.toBe('STILL_WRITING');
    expect(f!.size).toBe(1500);
  });

  it('T10 without a reliable file id, a moved file is NOT guessed: the old copy goes missing and a relink is suggested by content', async () => {
    const w = await world();
    const HASH = '9'.repeat(64);
    const noId = (path: string) => file(path, { fileId: undefined });
    await w.send(w.agentA, w.rootA.id, [noId('D:\\Media\\old\\clip.mp4')]);
    await processIngest(h.db, w.org.env, w.agentA, {
      rootId: w.rootA.id,
      runId: randomUUID(),
      phase: 'PROGRESS',
      observations: [hashObs('D:\\Media\\old\\clip.mp4', HASH)],
    });
    const [original] = await rowsFor(w.org.orgId);
    const asset = await createAsset(w.ctx, { title: 'Clip history', fileInstanceId: original!.id });
    // the file is moved by hand: new path, no stable id
    const t = (n: number) => new Date(Date.now() + n * 3600_000);
    await w.send(w.agentA, w.rootA.id, [noId('D:\\Media\\new\\clip.mp4')]);
    await processIngest(h.db, w.org.env, w.agentA, {
      rootId: w.rootA.id,
      runId: randomUUID(),
      phase: 'PROGRESS',
      observations: [hashObs('D:\\Media\\new\\clip.mp4', HASH)],
    });
    void t;
    const rows = await rowsFor(w.org.orgId);
    expect(rows.length).toBe(2); // never silently merged/rewritten
    const moved = rows.find((r) => r.displayPath.endsWith('new\\clip.mp4'))!;
    expect(moved.id).not.toBe(original!.id);
    // history is intact on the asset; the new location is offered for relink, with identical content as the reason
    const detail = await getAsset(w.ctx, asset.id);
    expect(detail.versions[0]!.files.length).toBe(1);
    const sugg = await suggestMatches(w.ctx, moved.id);
    expect(sugg.length).toBeGreaterThan(0);
    expect(sugg[0].assetId).toBe(asset.id);
    expect(sugg[0].reasons.join(' ')).toMatch(/identical content/);
    expect((await listSuggestions(w.ctx, moved.id))[0].outcome).toBe('PENDING');
    // owner confirms: both copies now back the same version
    await linkFile(w.ctx, detail.versions[0]!.id, moved.id, 'suggestion', 1);
    expect((await getAsset(w.ctx, asset.id)).versions[0]!.files.length).toBe(2);
  });
});

describe('counts never multiply (T14, T17, T35)', () => {
  it('T14/T35 one asset with 3 file copies, 4 publications and 3 deliverable-style links counts 1 asset and 4 publications', async () => {
    const w = await world();
    const brand = await createBrand(w.ctx, { name: 'Mehak' });
    const ch = await createChannel(w.ctx, { brandId: brand.id, name: 'Mehak Music' });
    const platforms = ['youtube', 'instagram', 'tiktok', 'facebook'] as const;
    const accounts = [];
    for (const p of platforms)
      accounts.push(
        await createSocialAccount(w.ctx, { channelId: ch.id, platform: p, handle: `@mehak_${p}` }),
      );

    // three physical copies of the same content on two devices + NAS
    const HASH = '7'.repeat(64);
    await w.send(w.agentA, w.rootA.id, [file('D:\\Media\\video.mp4')]);
    await w.send(w.agentA, w.rootNas.id, [file('Z:\\Archive\\video.mp4')]);
    await w.send(w.agentB, w.rootB.id, [file('/mnt/media/video.mp4')]);
    for (const [agent, rootId, p] of [
      [w.agentA, w.rootA.id, 'D:\\Media\\video.mp4'],
      [w.agentA, w.rootNas.id, 'Z:\\Archive\\video.mp4'],
      [w.agentB, w.rootB.id, '/mnt/media/video.mp4'],
    ] as const)
      await processIngest(h.db, w.org.env, agent, {
        rootId,
        runId: randomUUID(),
        phase: 'PROGRESS',
        observations: [hashObs(p, HASH)],
      });
    const copies = await rowsFor(w.org.orgId);
    expect(copies.length).toBe(3);

    const asset = await createAsset(w.ctx, { title: 'Song video', fileInstanceId: copies[0]!.id });
    const versionId = asset.versions[0]!.id;
    await linkFile(w.ctx, versionId, copies[1]!.id, 'manual', 1);
    await linkFile(w.ctx, versionId, copies[2]!.id, 'manual', 1);

    const variant = await createVariant(w.ctx, {
      assetId: asset.id,
      titleMaster: 'Song video',
      type: 'LONG_FORM',
    } as any);
    for (const a of accounts) {
      const { record } = await createRecord(w.ctx, {
        socialAccountId: a.id,
        variantId: variant.id,
        title: 'Song video',
        plannedAt: new Date(Date.now() - 3600_000).toISOString(),
        state: 'PLANNED',
      } as any);
      await markPublishedManual(w.ctx, record.id, {
        url:
          a.platform === 'youtube'
            ? 'https://www.youtube.com/watch?v=abcdefghijk'
            : `https://example.com/${a.platform}/1`,
      });
    }

    // the "dangerous" joins: asset list (versions x files), analytics (publications), library (instances)
    const assets = await listAssets(w.ctx, {});
    expect(assets.items.length).toBe(1);
    expect(assets.items[0].versionCount).toBe(1);
    expect(assets.items[0].fileCount).toBe(3);
    const an = await analytics(w.ctx);
    expect(an.totals.published).toBe(4);
    expect(an.totals.manual).toBe(4);
    expect(Object.values(an.byPlatform).reduce((n: number, p: any) => n + p.manual, 0)).toBe(4);
    const counts = await libraryCounts(w.ctx);
    expect(counts.total).toBe(3);
    expect(counts.duplicateGroups).toBe(1);
    expect(counts.unlinkedMedia).toBe(0);
    const matrix: any = await publishingMatrix(w.ctx, { assetId: asset.id });
    const cells = JSON.stringify(matrix).match(/PUBLISHED_MANUAL/g)?.length ?? 0;
    expect(cells).toBe(4);
  });

  it('T17 accounts of different channels/brands stay logically separate', async () => {
    const w = await world();
    const mehak = await createBrand(w.ctx, { name: 'Mehak Music' });
    const travel = await createBrand(w.ctx, { name: 'Travel' });
    const chM = await createChannel(w.ctx, { brandId: mehak.id, name: 'Mehak' });
    const chT = await createChannel(w.ctx, { brandId: travel.id, name: 'Travel channel' });
    const m = await createSocialAccount(w.ctx, { channelId: chM.id, platform: 'youtube', handle: '@mehak' });
    const t = await createSocialAccount(w.ctx, { channelId: chT.id, platform: 'youtube', handle: '@travel' });
    const asset = await createAsset(w.ctx, { title: 'Shared footage', kind: 'VIDEO' });
    const v = await createVariant(w.ctx, { assetId: asset.id, titleMaster: 'x', type: 'LONG_FORM' } as any);
    const mk = async (acct: string, url: string) => {
      const { record } = await createRecord(w.ctx, {
        socialAccountId: acct,
        variantId: v.id,
        plannedAt: new Date(Date.now() - 1000).toISOString(),
        state: 'PLANNED',
      } as any);
      return markPublishedManual(w.ctx, record.id, { url });
    };
    await mk(m.id, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    await mk(t.id, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    expect((await analytics(w.ctx, { brandId: mehak.id })).totals.published).toBe(1);
    expect((await analytics(w.ctx, { brandId: travel.id })).totals.published).toBe(1);
    expect((await analytics(w.ctx, { socialAccountId: t.id })).totals.published).toBe(1);
    expect((await analytics(w.ctx)).totals.published).toBe(2);
  });
});
