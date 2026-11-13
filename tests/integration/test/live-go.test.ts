import { afterAll, describe, expect, it } from 'vitest';
import { eq, liveSessions, providerConnections, socialAccounts, streamMachines } from '@creatoros/db';
import {
  advanceLiveSessions,
  agentJob,
  applyLiveEvent,
  createBrand,
  createChannel,
  createLiveSession,
  createSocialAccount,
  createStreamMachine,
  encryptJson,
  startLiveSession,
  stopLiveSession,
} from '@creatoros/services';
import { makeOrg, openDb } from '../src/helpers';

const h = openDb();
afterAll(() => h.close());

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function youtubeMock() {
  const calls: { method: string; path: string; part: string | null; body: any }[] = [];
  let life = 'ready';
  let streamStatus = 'inactive';
  let actualStart: string | null = null;
  let offerUpcoming = false;
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const part = u.searchParams.get('part');
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, part, body });
    if (u.pathname.endsWith('/liveBroadcasts') && method === 'GET' && u.searchParams.get('broadcastStatus') === 'upcoming') {
      if (u.searchParams.has('mine')) return json({ error: { errors: [{ reason: 'invalidFilters' }] } }, 400);
      return json({
        items: offerUpcoming
          ? [
              {
                id: 'bcast1',
                snippet: { title: 'Mehak Live' },
                status: { lifeCycleStatus: 'ready' },
                contentDetails: {},
              },
            ]
          : [],
      });
    }
    if (u.pathname.endsWith('/liveBroadcasts') && method === 'POST') {
      return json({ id: 'bcast1', status: { lifeCycleStatus: 'created' } });
    }
    if (u.pathname.endsWith('/liveBroadcasts') && method === 'PUT') {
      if (part !== 'monetizationDetails') return json({ error: { errors: [{ reason: 'unexpectedPart' }] } }, 400);
      if (body?.monetizationDetails?.adsMonetizationStatus === 'off' && body?.monetizationDetails?.cuepointSchedule) {
        return json({ error: { errors: [{ reason: 'invalidCuepointSchedule' }] } }, 400);
      }
      return json({ id: 'bcast1', monetizationDetails: body.monetizationDetails });
    }
    if (u.pathname.endsWith('/liveBroadcasts/bind')) return json({ id: 'bcast1' });
    if (u.pathname.endsWith('/liveBroadcasts/transition')) {
      life = 'live';
      actualStart = new Date().toISOString();
      return json({ status: { lifeCycleStatus: 'live' } });
    }
    if (u.pathname.endsWith('/liveBroadcasts') && method === 'GET') {
      return json({
        items: [
          {
            id: 'bcast1',
            status: { lifeCycleStatus: life },
            snippet: { actualStartTime: actualStart },
            contentDetails: { boundStreamId: 'stream1' },
          },
        ],
      });
    }
    if (u.pathname.endsWith('/liveStreams') && method === 'POST') {
      return json({
        id: 'stream1',
        cdn: { ingestionInfo: { ingestionAddress: 'rtmps://a.rtmps.youtube.com/live2', streamName: 'stream-key-1' } },
      });
    }
    if (u.pathname.endsWith('/liveStreams') && method === 'GET') {
      return json({ items: [{ status: { streamStatus } }] });
    }
    if (u.pathname.endsWith('/videos') && method === 'GET') {
      return json({
        items: [{ id: 'bcast1', snippet: { title: 'Mehak Live', categoryId: '10' }, status: { privacyStatus: 'public' } }],
      });
    }
    if (u.pathname.endsWith('/videos') && method === 'PUT') return json({ id: 'bcast1' });
    return json({ error: { message: `unmocked ${method} ${u.pathname}` } }, 404);
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    setStreamStatus: (value: string) => {
      streamStatus = value;
    },
    offerUpcoming: () => {
      offerUpcoming = true;
    },
    creates: () => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/liveBroadcasts')).length,
    transitions: () => calls.filter((c) => c.path.endsWith('/liveBroadcasts/transition')).length,
  };
}

describe('Go live dispatch', () => {
  it('reuses one Upcoming broadcast, gives the agent a stream job, and shows LIVE only after YouTube does', async () => {
    const org = await makeOrg(h);
    const machine = await createStreamMachine(org.ctx, { displayName: 'RTX 3060', os: 'windows' });
    await h.db
      .update(streamMachines)
      .set({
        ffmpeg: 'ffmpeg version 9',
        freeBytes: 100_000_000_000,
        totalBytes: 200_000_000_000,
        lastSeenAt: new Date(),
        browsePath: 'C:\\MehakLive',
        roots: ['C:\\MehakLive'],
      })
      .where(eq(streamMachines.id, machine.id));
    const brand = await createBrand(org.ctx, { name: 'Mehak' });
    const channel = await createChannel(org.ctx, { brandId: brand.id, name: 'Mehak' });
    const account = await createSocialAccount(org.ctx, { channelId: channel.id, platform: 'youtube', handle: '@mehak' });
    const [conn] = await h.db
      .insert(providerConnections)
      .values({
        orgId: org.orgId,
        provider: 'youtube',
        label: 'youtube',
        principalHint: 'mehak@example.com',
        state: 'ACTIVE',
        scopes: [SCOPE],
        encryptedTokenRef: encryptJson(
          { accessToken: 'ytok', expiresAt: 9e12, scopes: [SCOPE], principal: 'mehak@example.com' },
          org.env.encryptionKey,
        ),
      })
      .returning();
    await h.db.update(socialAccounts).set({ providerConnectionId: conn!.id }).where(eq(socialAccounts.id, account.id));

    const created = await createLiveSession(org.ctx, {
      machineId: machine.id,
      title: 'Mehak Live',
      items: [{ source: 'agent', name: 'clip.mp4' }],
      settings: { resolution: '1080p', loop: true, mode: 'youtube' },
    });
    const preparingJob = await agentJob(h.db, org.env, machine.token);
    expect(preparingJob).toMatchObject({ phase: 'prepare', sessionId: created.id });
    const [preparing] = await h.db.select().from(liveSessions).where(eq(liveSessions.id, created.id));
    await applyLiveEvent(h.db, org.env, preparing!, { event: 'master_ready', savedPath: 'C:\\MehakLive\\stream\\live.mp4' });
    const before = await agentJob(h.db, org.env, machine.token);
    expect(before).toMatchObject({ phase: 'hold', sessionId: created.id, masterPath: 'C:\\MehakLive\\stream\\live.mp4' });

    const yt = youtubeMock();
    const started = await startLiveSession(
      org.ctx,
      created.id,
      { socialAccountId: account.id, title: 'Mehak Live', settings: { resolution: '1080p', loop: true, mode: 'youtube' } },
      yt.fetchImpl,
    );
    expect(started.status).toBe('CONNECTING');
    expect(yt.creates()).toBe(1);
    expect(started.youtubeBroadcastId).toBe('bcast1');
    expect(yt.calls.some((c) => c.path.endsWith('/liveBroadcasts/bind'))).toBe(true);
    // Monetization defaults to ON for new YouTube sessions unless the user selected OFF.
    expect(yt.calls.some((c) => c.method === 'PUT' && c.path.endsWith('/liveBroadcasts') &&
      c.part === 'monetizationDetails' && c.body?.monetizationDetails?.adsMonetizationStatus === 'on' &&
      c.body?.monetizationDetails?.cuepointSchedule?.enabled === true)).toBe(true);
    expect(yt.calls.some((c) => c.path.endsWith('/liveBroadcasts') && c.method === 'GET' && c.part?.includes('id'))).toBe(true);

    const job = await agentJob(h.db, org.env, machine.token);
    expect(job).toMatchObject({
      phase: 'stream',
      sessionId: created.id,
      masterPath: 'C:\\MehakLive\\stream\\live.mp4',
      loop: true,
      ingest: { address: 'rtmps://a.rtmps.youtube.com/live2', name: 'stream-key-1' },
    });

    await h.db.update(streamMachines).set({ currentSessionId: null }).where(eq(streamMachines.id, machine.id));
    const recovered = await agentJob(h.db, org.env, machine.token);
    expect(recovered).toMatchObject({ phase: 'stream', sessionId: created.id });
    const [pinned] = await h.db.select().from(streamMachines).where(eq(streamMachines.id, machine.id));
    expect(pinned!.currentSessionId).toBe(created.id);

    await h.db.update(liveSessions).set({ status: 'READY' }).where(eq(liveSessions.id, created.id));
    await startLiveSession(
      org.ctx,
      created.id,
      { socialAccountId: account.id, title: 'Mehak Live', settings: { resolution: '1080p', loop: true, mode: 'youtube' } },
      yt.fetchImpl,
    );
    expect(yt.creates()).toBe(1);
    const [again] = await h.db.select().from(liveSessions).where(eq(liveSessions.id, created.id));
    expect(again!.status).toBe('CONNECTING');
    expect(again!.youtubeBroadcastId).toBe('bcast1');

    await h.db
      .update(liveSessions)
      .set({ status: 'READY', youtubeBroadcastId: null, youtubeStreamId: null, youtubeBound: false, ingestSecret: null })
      .where(eq(liveSessions.id, created.id));
    yt.offerUpcoming();
    const reused = await startLiveSession(
      org.ctx,
      created.id,
      { socialAccountId: account.id, title: 'Mehak Live', settings: { resolution: '1080p', loop: true, mode: 'youtube' } },
      yt.fetchImpl,
    );
    expect(yt.creates()).toBe(1);
    expect(reused.youtubeBroadcastId).toBe('bcast1');
    expect(reused.status).toBe('CONNECTING');

    yt.setStreamStatus('active');
    await advanceLiveSessions(h.db, org.env, new Date(), yt.fetchImpl);
    const [connecting] = await h.db.select().from(liveSessions).where(eq(liveSessions.id, created.id));
    expect(connecting!.status).toBe('CONNECTING');
    expect(yt.transitions()).toBe(1);

    await h.db.update(liveSessions).set({ youtubeCheckedAt: null }).where(eq(liveSessions.id, created.id));
    await advanceLiveSessions(h.db, org.env, new Date(), yt.fetchImpl);
    const [live] = await h.db.select().from(liveSessions).where(eq(liveSessions.id, created.id));
    expect(live!.status).toBe('LIVE');
    expect(live!.youtubeActualStartAt).toBeTruthy();
    const onAir = await agentJob(h.db, org.env, machine.token);
    expect(onAir?.phase).toBe('stream');
    expect(onAir && 'stopAt' in onAir && onAir.stopAt).toBeTruthy();
  });

  it('starts from a saved live.mp4 without preparing the clips again', async () => {
    const org = await makeOrg(h);
    const machine = await createStreamMachine(org.ctx, { displayName: 'RTX 3060', os: 'windows' });
    await h.db
      .update(streamMachines)
      .set({
        ffmpeg: 'ffmpeg version 9',
        freeBytes: 100_000_000_000,
        totalBytes: 200_000_000_000,
        lastSeenAt: new Date(),
        browsePath: 'C:\\MehakLive',
        browseListing: [{ name: 'live.mp4', relative: 'stream/live.mp4', kind: 'master', size: 10 }] as never,
      })
      .where(eq(streamMachines.id, machine.id));
    const brand = await createBrand(org.ctx, { name: 'Mehak' });
    const channel = await createChannel(org.ctx, { brandId: brand.id, name: 'Mehak' });
    const account = await createSocialAccount(org.ctx, { channelId: channel.id, platform: 'youtube', handle: '@mehak' });
    const [conn] = await h.db
      .insert(providerConnections)
      .values({
        orgId: org.orgId,
        provider: 'youtube',
        label: 'youtube',
        principalHint: 'mehak@example.com',
        state: 'ACTIVE',
        scopes: [SCOPE],
        encryptedTokenRef: encryptJson(
          { accessToken: 'ytok', expiresAt: 9e12, scopes: [SCOPE], principal: 'mehak@example.com' },
          org.env.encryptionKey,
        ),
      })
      .returning();
    await h.db.update(socialAccounts).set({ providerConnectionId: conn!.id }).where(eq(socialAccounts.id, account.id));
    const session = await createLiveSession(org.ctx, {
      machineId: machine.id,
      title: 'Mehak Live',
      items: [],
      useExistingMaster: true,
      settings: { resolution: '1080p', loop: true, mode: 'youtube' },
    });
    expect(session.status).toBe('READY');
    expect(session.progress).toMatchObject({ masterReady: true, savedPath: 'C:\\MehakLive\\stream\\live.mp4' });
    const waiting = await agentJob(h.db, org.env, machine.token);
    expect(waiting).toMatchObject({ phase: 'hold', masterPath: 'C:\\MehakLive\\stream\\live.mp4' });
    const yt = youtubeMock();
    const started = await startLiveSession(
      org.ctx,
      session.id,
      { socialAccountId: account.id, title: 'Mehak Live', settings: { resolution: '1080p', loop: true, mode: 'youtube' } },
      yt.fetchImpl,
    );
    expect(started.status).toBe('CONNECTING');
    const streaming = await agentJob(h.db, org.env, machine.token);
    expect(streaming).toMatchObject({ phase: 'stream', masterPath: 'C:\\MehakLive\\stream\\live.mp4', sessionId: session.id });
    await stopLiveSession(org.ctx, session.id, false);
    const stopping = await agentJob(h.db, org.env, machine.token);
    expect(stopping).toMatchObject({ phase: 'stop', sessionId: session.id });
    const [kept] = await h.db.select().from(liveSessions).where(eq(liveSessions.id, session.id));
    expect(kept!.progress).toMatchObject({ savedPath: 'C:\\MehakLive\\stream\\live.mp4' });
    await applyLiveEvent(h.db, org.env, kept!, { event: 'encoder_stopped' });
    await advanceLiveSessions(h.db, org.env, new Date(), yt.fetchImpl);
    const [ended] = await h.db.select().from(liveSessions).where(eq(liveSessions.id, session.id));
    expect(ended!.status).toBe('ENDED');
    expect(ended!.progress).toMatchObject({ savedPath: 'C:\\MehakLive\\stream\\live.mp4' });
    const again = await createLiveSession(org.ctx, {
      machineId: machine.id,
      title: 'Mehak Live',
      items: [],
      useExistingMaster: true,
      settings: { resolution: '1080p', loop: true, mode: 'youtube' },
    });
    const second = await agentJob(h.db, org.env, machine.token);
    expect(again.status).toBe('READY');
    expect(second).toMatchObject({ phase: 'hold', masterPath: 'C:\\MehakLive\\stream\\live.mp4' });
    await startLiveSession(
      org.ctx,
      again.id,
      { socialAccountId: account.id, title: 'Mehak Live', settings: { resolution: '1080p', loop: true, mode: 'youtube', ads: 'off' } },
      yt.fetchImpl,
    );
    const secondStream = await agentJob(h.db, org.env, machine.token);
    expect(secondStream).toMatchObject({ phase: 'stream', masterPath: 'C:\\MehakLive\\stream\\live.mp4' });
    expect(yt.calls.some((c) => c.method === 'PUT' && c.path.endsWith('/liveBroadcasts') &&
      c.part === 'monetizationDetails' && c.body?.monetizationDetails?.adsMonetizationStatus === 'off' &&
      !('cuepointSchedule' in c.body.monetizationDetails))).toBe(true);
  });
});
