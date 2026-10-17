/**
 * Spec scenarios T15, T16, T19-T26, T29, T32 and T34 (docs/PRODUCT_SPEC.md, "Critical cases").
 * Connectors run against in-process fakes of the remote APIs (Gmail, YouTube, the owner's Todo app): no network, no real accounts.
 * See docs/TEST_MATRIX.md for the full mapping of T01-T35 to tests.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  conversationThreads,
  eq,
  internalActions,
  opportunities,
  providerConnections,
  publicationRecords,
  sql,
  syncCursors,
  taskLinks,
  type DbHandle,
} from '@creatoros/db';
import {
  addDeliverable,
  analytics,
  briefing,
  convertOpportunityToDeal,
  createAction,
  createAsset,
  createBrand,
  createChannel,
  createInvoice,
  createRecord,
  createSocialAccount,
  createVariant,
  encryptJson,
  getDeal,
  getInvoice,
  ingestMessage,
  issueInvoice,
  linkActionToTodo,
  linkSocialAccountToConnection,
  listActions,
  listIntegrations,
  listTaskLinks,
  listThreads,
  listUnmatchedPublications,
  manualIntake,
  markPublishedManual,
  recordExistingPost,
  recordPayment,
  runSync,
  saveKeyConnection,
  setDeliverableStatus,
  syncDueTaskLinks,
  syncTaskLink,
  testConnection,
  todoStatus,
  triageThread,
  type Ctx,
} from '@creatoros/services';
import { utcToZonedParts } from '@creatoros/domain';
import { makeOrg, openDb } from '../src/helpers';

let h: DbHandle;
beforeAll(() => {
  h = openDb();
});
afterAll(async () => {
  await h.close();
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const hdr = (init: RequestInit | undefined, name: string): string | undefined => {
  const hs = init?.headers as any;
  if (!hs) return undefined;
  if (typeof hs.get === 'function') return hs.get(name) ?? undefined;
  const k = Object.keys(hs).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? hs[k] : undefined;
};
const noSleep = { sleep: async () => {} };

// --------------------------------------------------------------- fake Todo app (the owner's PWA)
interface RemoteTodo {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: number | string | null;
  completed: boolean;
  completed_at: string | null;
  updated_at: string;
  external_ref: string | null;
}
function fakeTodo() {
  const tasks = new Map<string, RemoteTodo>();
  const keys = new Map<string, string>();
  let rev = 1;
  let n = 1;
  const state = {
    offline: false,
    dropPostResponses: false,
    posts: 0,
    ifMatchSeen: [] as (string | undefined)[],
  };
  const touch = (t: RemoteTodo) => {
    t.updated_at = String(++rev);
    return t;
  };
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (state.offline) throw new TypeError('fetch failed (todo offline)');
    const u = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = u.pathname.replace(/^\/api/, '');
    if (path === '/health') return json({ ok: true });
    if (method === 'GET' && path === '/tasks') {
      const ref = u.searchParams.get('external_ref');
      return json({ data: [...tasks.values()].filter((t) => !ref || t.external_ref === ref) });
    }
    if (method === 'POST' && path === '/tasks') {
      state.posts += 1;
      const key = hdr(init, 'idempotency-key') ?? '';
      let id = keys.get(key);
      if (!id) {
        const b = JSON.parse(String(init!.body));
        id = `t${n++}`;
        tasks.set(id, {
          id,
          title: b.title,
          description: b.description ?? null,
          due_at: b.due_at ?? null,
          priority: b.priority ?? null,
          completed: Boolean(b.completed),
          completed_at: null,
          updated_at: String(++rev),
          external_ref: b.external_ref ?? null,
        });
        if (key) keys.set(key, id);
      }
      if (state.dropPostResponses) throw new TypeError('connection reset after create');
      return json({ data: tasks.get(id)! }, 201);
    }
    const m = /^\/tasks\/([^/]+)$/.exec(path);
    if (m) {
      const t = tasks.get(decodeURIComponent(m[1]!));
      if (!t) return json({ error: 'not found' }, 404);
      if (method === 'GET') return json({ data: t });
      if (method === 'PATCH') {
        const im = hdr(init, 'if-match');
        state.ifMatchSeen.push(im);
        if (im && im !== t.updated_at) return json({ error: 'stale' }, 412);
        const b = JSON.parse(String(init!.body));
        for (const k of ['title', 'description', 'due_at', 'priority', 'completed'] as const)
          if (k in b) (t as any)[k] = b[k];
        return json({ data: touch(t) });
      }
    }
    return json({ error: 'unknown route' }, 404);
  };
  return { fetch, tasks, state, touch };
}

async function todoWorld() {
  const org = await makeOrg(h);
  const todo = fakeTodo();
  await saveKeyConnection(org.ctx, 'todo', {
    apiKey: 'todo-token',
    config: { baseUrl: 'https://todo.test/api', authScheme: 'bearer' },
  });
  const overrides = { fetch: todo.fetch, ...noSleep } as const;
  return { org, ctx: org.ctx as Ctx, todo, overrides };
}

const linkRow = async (id: string) => (await h.db.select().from(taskLinks).where(eq(taskLinks.id, id)))[0]!;
const actionRow = async (id: string) =>
  (await h.db.select().from(internalActions).where(eq(internalActions.id, id)))[0]!;

// ------------------------------------------------------------------- Todo (T24-T26)
describe('Todo sync (T24-T26)', () => {
  it('is refused until the connection test passes (nothing pretends to be connected)', async () => {
    const { ctx } = await todoWorld();
    const a = await createAction(ctx, { title: 'Send invoice to Acme' });
    await expect(linkActionToTodo(ctx, a.id)).rejects.toMatchObject({ code: 'TODO_NOT_READY' });
    expect((await todoStatus(ctx)).enabled).toBe(false);
  });

  it('T24 creates ONE remote task with a stable idempotency key; retries and lost responses never duplicate it', async () => {
    const { ctx, todo, overrides, org } = await todoWorld();
    expect((await testConnection(ctx, 'todo', overrides)).ok).toBe(true);
    const a = await createAction(ctx, {
      title: 'Reply to Acme',
      dueAt: '2030-01-10T17:00:00Z',
      priority: 'HIGH',
    });
    const link = await linkActionToTodo(ctx, a.id);
    expect(link.idempotencyKey).toBe(`creatoros:${org.orgId}:${a.id}`);
    expect((await linkActionToTodo(ctx, a.id)).id).toBe(link.id); // one link per action

    // first attempt: the remote creates the task but the response is lost
    todo.state.dropPostResponses = true;
    const failed = await syncTaskLink(h.db, org.env, link.id, overrides);
    expect(failed.syncState).toBe('PENDING');
    expect(failed.remoteTaskId).toBeNull();
    expect(todo.tasks.size).toBe(1);

    // recovery: the stable external reference finds the task that already exists
    todo.state.dropPostResponses = false;
    const ok = await syncTaskLink(h.db, org.env, link.id, overrides);
    expect(ok.syncState).toBe('SYNCED');
    expect(ok.remoteTaskId).toBe([...todo.tasks.keys()][0]);
    expect(todo.tasks.size).toBe(1);
    expect((ok.syncLog as any[]).map((e) => e.event)).toContain('adopted_existing');

    // repeated syncs stay a single remote task
    await syncTaskLink(h.db, org.env, link.id, overrides);
    await syncTaskLink(h.db, org.env, link.id, overrides);
    expect(todo.tasks.size).toBe(1);
    const remote = [...todo.tasks.values()][0]!;
    expect(remote.external_ref).toBe(`creatoros:action:${a.id}`);
    expect(remote.title).toBe('Reply to Acme');
  });

  it('T25 completion and due date made in the Todo app are reconciled without touching unrelated fields', async () => {
    const { ctx, todo, overrides, org } = await todoWorld();
    await testConnection(ctx, 'todo', overrides);
    const a = await createAction(ctx, {
      title: 'Edit the reel',
      description: 'Cut to 30s',
      priority: 'URGENT',
      pinned: true,
      deepLink: '/production/abc',
      dueAt: '2030-02-01T17:00:00Z',
    });
    const link = await linkActionToTodo(ctx, a.id);
    await syncTaskLink(h.db, org.env, link.id, overrides);
    const remote = [...todo.tasks.values()][0]!;

    // the owner ticks it off in the Todo app and moves the due date
    remote.completed = true;
    remote.completed_at = '2030-01-20T10:00:00Z';
    remote.due_at = '2030-02-05T17:00:00Z';
    todo.touch(remote);
    await syncTaskLink(h.db, org.env, link.id, overrides);

    const after = await actionRow(a.id);
    expect(after.state).toBe('DONE');
    expect(after.completionEvidence).toMatch(/Todo app/);
    expect(after.dueAt?.toISOString()).toBe('2030-02-05T17:00:00.000Z');
    // everything Creator OS owns is unchanged
    expect(after.title).toBe('Edit the reel');
    expect(after.description).toBe('Cut to 30s');
    expect(after.priority).toBe('URGENT');
    expect(after.pinned).toBe(true);
    expect(after.deepLink).toBe('/production/abc');
    expect((await linkRow(link.id)).syncState).toBe('SYNCED');
    // and the title we own was not overwritten on the remote side
    expect(remote.title).toBe('Edit the reel');
  });

  it('T25 a Creator OS edit is pushed with If-Match and a concurrent remote edit becomes a visible CONFLICT, not an overwrite', async () => {
    const { ctx, todo, overrides, org } = await todoWorld();
    await testConnection(ctx, 'todo', overrides);
    const a = await createAction(ctx, { title: 'Draft contract' });
    const link = await linkActionToTodo(ctx, a.id);
    await syncTaskLink(h.db, org.env, link.id, overrides);
    const remote = [...todo.tasks.values()][0]!;

    await h.db
      .update(internalActions)
      .set({ title: 'Draft contract v2' })
      .where(eq(internalActions.id, a.id));
    await syncTaskLink(h.db, org.env, link.id, overrides);
    expect(remote.title).toBe('Draft contract v2');
    expect(todo.state.ifMatchSeen.some((v) => v && v.length > 0)).toBe(true);

    // both sides change; the remote revision moves between our read and our write
    await h.db
      .update(internalActions)
      .set({ title: 'Draft contract v3' })
      .where(eq(internalActions.id, a.id));
    const realFetch = todo.fetch;
    let bumped = false;
    const racing = async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'PATCH' && !bumped) {
        bumped = true;
        todo.touch(remote); // someone edited remotely right now
      }
      return realFetch(url, init);
    };
    const res = await syncTaskLink(h.db, org.env, link.id, { fetch: racing, ...noSleep });
    expect(res.syncState).toBe('CONFLICT');
    expect(res.lastError).toMatch(/changed while syncing/i);
    expect(remote.title).toBe('Draft contract v2'); // nothing was overwritten
  });

  it('T26 when Todo is offline the task stays PENDING and visible locally, and is never reported as synced', async () => {
    const { ctx, todo, overrides, org } = await todoWorld();
    await testConnection(ctx, 'todo', overrides);
    const a = await createAction(ctx, { title: 'Pitch brand' });
    const link = await linkActionToTodo(ctx, a.id);

    todo.state.offline = true;
    const r = await syncTaskLink(h.db, org.env, link.id, overrides);
    expect(r.syncState).toBe('PENDING');
    expect(r.attempts).toBe(1);
    expect(r.lastError).toBeTruthy();
    expect(r.nextAttemptAt).toBeTruthy();
    expect(r.lastSyncAt).toBeNull();
    // still there locally
    expect((await listActions(ctx)).map((x) => x.id)).toContain(a.id);
    const shown = (await listTaskLinks(ctx)).find((l) => l.id === link.id);
    expect(shown.syncState).toBe('PENDING');
    expect(shown.lastError).toBeTruthy();
    const status = await todoStatus(ctx);
    expect(status.links.SYNCED ?? 0).toBe(0);
    expect(status.links.PENDING).toBe(1);
    expect(status.lastError).toBeTruthy();
    expect(todo.tasks.size).toBe(0);

    // the worker does not hammer a dead server: not due yet
    await syncDueTaskLinks(h.db, org.env, { overrides }); // (the worker is global: other orgs' links may be processed too)
    expect((await linkRow(link.id)).attempts).toBe(1);

    // Todo comes back; once the backoff elapsed the worker delivers
    todo.state.offline = false;
    const later = await syncDueTaskLinks(h.db, org.env, {
      now: new Date(Date.now() + 24 * 3600_000),
      overrides,
    });
    expect(later.ok).toBeGreaterThanOrEqual(1);
    expect((await linkRow(link.id)).syncState).toBe('SYNCED');
    expect(
      [...todo.tasks.values()].filter((x) => x.external_ref === `creatoros:action:${a.id}`),
    ).toHaveLength(1);
  });

  it('T26 a permanently failing remote ends in a visible dead letter, not an endless loop', async () => {
    const { ctx, todo, overrides, org } = await todoWorld();
    await testConnection(ctx, 'todo', overrides);
    const a = await createAction(ctx, { title: 'Will never sync' });
    const link = await linkActionToTodo(ctx, a.id);
    todo.state.offline = true;
    let last = link as typeof link;
    for (let i = 0; i < 8; i++) last = await syncTaskLink(h.db, org.env, link.id, overrides);
    expect(last.syncState).toBe('DEAD_LETTER');
    expect(last.nextAttemptAt).toBeNull();
    expect((await todoStatus(ctx)).links.DEAD_LETTER).toBe(1);
  });
});

// -------------------------------------------------------- YouTube import (T15, T16, T34)
const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

async function connect(ctx: Ctx, provider: 'youtube' | 'gmail', principal: string) {
  const [c] = await h.db
    .insert(providerConnections)
    .values({
      orgId: ctx.orgId,
      provider,
      label: provider,
      principalHint: principal,
      state: 'ACTIVE',
      scopes: [provider === 'youtube' ? YT_SCOPE : GMAIL_SCOPE],
      encryptedTokenRef: encryptJson(
        {
          accessToken: 'tok',
          expiresAt: 9e12,
          scopes: [provider === 'youtube' ? YT_SCOPE : GMAIL_SCOPE],
          principal,
        },
        ctx.env.encryptionKey,
      ),
    })
    .returning();
  return c!;
}

const ytVideo = (id: string, title: string, publishedAt: string, views = '1200') => ({
  id,
  snippet: { title, description: 'd', publishedAt, channelId: 'UC1', thumbnails: {} },
  contentDetails: { duration: 'PT3M10S' },
  statistics: { viewCount: views },
  status: { privacyStatus: 'public', uploadStatus: 'processed' },
});
function fakeYouTube(videos: ReturnType<typeof ytVideo>[]) {
  const state = { rateLimited: 0, calls: 0 };
  const fetch = async (url: string): Promise<Response> => {
    state.calls += 1;
    if (state.rateLimited > 0) {
      state.rateLimited -= 1;
      return json({ error: { message: 'quota' } }, 429, { 'retry-after': '1' });
    }
    if (url.includes('/channels'))
      return json({
        items: [
          {
            id: 'UC1',
            snippet: { title: 'Mehak' },
            contentDetails: { relatedPlaylists: { uploads: 'UU1' } },
          },
        ],
      });
    if (url.includes('/playlistItems'))
      return json({
        items: videos.map((v) => ({
          contentDetails: { videoId: v.id, videoPublishedAt: v.snippet.publishedAt },
        })),
      });
    if (url.includes('/videos')) return json({ items: videos });
    return json({}, 404);
  };
  return { fetch, state };
}

async function youtubeWorld(videos: ReturnType<typeof ytVideo>[]) {
  const org = await makeOrg(h);
  const ctx = org.ctx as Ctx;
  const brand = await createBrand(ctx, { name: 'Mehak' });
  const ch = await createChannel(ctx, { brandId: brand.id, name: 'Mehak Music' });
  const acct = await createSocialAccount(ctx, { channelId: ch.id, platform: 'youtube', handle: '@mehak' });
  const conn = await connect(ctx, 'youtube', 'mehak@example.com');
  await linkSocialAccountToConnection(ctx, acct.id, conn.id);
  const yt = fakeYouTube(videos);
  return { org, ctx, acct, conn, yt, overrides: { fetch: yt.fetch, ...noSleep } as const };
}

describe('publishing records and imports (T15, T16)', () => {
  it('T15 a pasted link is USER_ENTERED manual evidence, never VERIFIED_PLATFORM, and cannot be forged', async () => {
    const { ctx, acct } = await youtubeWorld([]);
    const rec = await recordExistingPost(ctx, {
      socialAccountId: acct.id,
      url: 'https://youtu.be/abcdefghijk',
      title: 'Pasted',
    });
    expect(rec.state).toBe('PUBLISHED_MANUAL');
    expect(rec.stateProvenance).toBe('USER_ENTERED');
    expect(rec.externalPostId).toBe('abcdefghijk');
    await expect(
      createRecord(ctx, { socialAccountId: acct.id, state: 'PUBLISHED_VERIFIED' } as any),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      recordExistingPost(ctx, { socialAccountId: acct.id, url: 'https://www.instagram.com/p/xyz/' }),
    ).rejects.toMatchObject({ status: 400 }); // wrong platform for the account
    const an = await analytics(ctx);
    expect(an.totals).toMatchObject({ verified: 0, manual: 1 });
  });

  it('T15 the platform later confirms the same post: it is upgraded to VERIFIED, not duplicated', async () => {
    const { ctx, acct, conn, org, overrides } = await youtubeWorld([
      ytVideo('abcdefghijk', 'Pasted', new Date(Date.now() - 86400_000).toISOString()),
    ]);
    await recordExistingPost(ctx, {
      socialAccountId: acct.id,
      url: 'https://youtu.be/abcdefghijk',
      title: 'Pasted',
    });
    const s = await runSync(h.db, org.env, conn.id, { full: true }, overrides);
    expect(s).toMatchObject({ provider: 'youtube', created: 0, updated: 1 });
    const rows = await h.db.select().from(publicationRecords).where(eq(publicationRecords.orgId, ctx.orgId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.state).toBe('PUBLISHED_VERIFIED');
    expect(rows[0]!.stateProvenance).toBe('VERIFIED_PLATFORM');
  });

  it('T16 an imported post with no confirmed local match stays unattached pending review (suggestions only)', async () => {
    const { ctx, conn, org, overrides } = await youtubeWorld([
      ytVideo(
        'vidAAAAAAAA',
        'Midnight Song (Official Video)',
        new Date(Date.now() - 2 * 86400_000).toISOString(),
      ),
      ytVideo('vidBBBBBBBB', 'Totally unrelated vlog', new Date(Date.now() - 86400_000).toISOString(), '55'),
    ]);
    const asset = await createAsset(ctx, { title: 'Midnight Song Official Video', kind: 'VIDEO' });
    const s = await runSync(h.db, org.env, conn.id, {}, overrides);
    expect(s).toMatchObject({ created: 2, updated: 0 });

    const unmatched = await listUnmatchedPublications(ctx);
    expect(unmatched.length).toBe(2);
    const midnight = unmatched.find((u) => /Midnight/.test(u.title))!;
    expect(midnight.suggestions[0].assetId).toBe(asset.id); // suggested…
    const rec = (
      await h.db.select().from(publicationRecords).where(eq(publicationRecords.id, midnight.id))
    )[0]!;
    expect(rec.variantId).toBeNull(); // …but never auto-attached
    expect(rec.unmatchedImport).toBe(true);
    expect(rec.state).toBe('PUBLISHED_VERIFIED');
    expect(unmatched.find((u) => /unrelated/.test(u.title))!.suggestions).toEqual([]);

    // idempotent: syncing again creates nothing new
    const again = await runSync(h.db, org.env, conn.id, { full: true }, overrides);
    expect(again).toMatchObject({ created: 0, updated: 2 });
    expect((await listUnmatchedPublications(ctx)).length).toBe(2);
    expect((await analytics(ctx)).totals.verified).toBe(2);
  });
});

// ----------------------------------------------------------- Gmail / opportunities (T19, T20)
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const gmailMsg = (id: string, threadId: string, from: string, subject: string, body: string, ms: number) => ({
  id,
  threadId,
  labelIds: ['INBOX'],
  snippet: body.slice(0, 80),
  internalDate: String(ms),
  payload: {
    mimeType: 'text/plain',
    headers: [
      { name: 'From', value: from },
      { name: 'To', value: 'owner@creator.test' },
      { name: 'Subject', value: subject },
    ],
    body: { data: b64(body) },
  },
});
function fakeGmail(messages: ReturnType<typeof gmailMsg>[]) {
  const state = { historyExpired: false, historyId: '500' };
  const fetch = async (url: string): Promise<Response> => {
    if (url.includes('/history')) {
      return state.historyExpired
        ? json({ error: { message: 'startHistoryId too old' } }, 404)
        : json({ history: [], historyId: state.historyId });
    }
    if (url.endsWith('/profile') || url.includes('/profile?'))
      return json({ historyId: state.historyId, emailAddress: 'owner@creator.test' });
    if (/\/messages\?/.test(url)) return json({ messages: messages.map((m) => ({ id: m.id })) });
    const m = /\/messages\/([^/?]+)/.exec(url);
    if (m) {
      const found = messages.find((x) => x.id === m[1]);
      return found ? json(found) : json({}, 404);
    }
    return json({}, 404);
  };
  return { fetch, state };
}

describe('Gmail intake and triage (T19, T20)', () => {
  const now = Date.now();
  const inquiry = gmailMsg(
    'g1',
    'th1',
    'Sam Lee <sam@acme-brand.com>',
    'Paid collaboration with Acme — budget $2,000',
    'Hi! We would love to partner with you on a sponsored reel. Our budget is $2,000 USD for one video. Are you available next month?',
    now - 3600_000,
  );
  const newsletter = gmailMsg(
    'g2',
    'th2',
    'News <digest@random-news.test>',
    'Your weekly digest',
    'Here is what happened this week in gardening. Unsubscribe any time.',
    now - 7200_000,
  );

  it('T19/T20 a collaboration email becomes a triage item (never an automatic deal); unrelated mail can be dismissed; re-sync never duplicates', async () => {
    const org = await makeOrg(h);
    const ctx = org.ctx as Ctx;
    const conn = await connect(ctx, 'gmail', 'owner@creator.test');
    const gm = fakeGmail([inquiry, newsletter]);
    const overrides = { fetch: gm.fetch, ...noSleep } as const;

    const first = await runSync(h.db, org.env, conn.id, {}, overrides);
    expect(first).toMatchObject({ provider: 'gmail', mode: 'full', imported: 2, duplicates: 0 });
    let threads = await listThreads(ctx);
    expect(threads.length).toBe(2);
    const collab = threads.find((t) => t.subject?.includes('Acme'))!;
    const news = threads.find((t) => t.subject?.includes('digest'))!;
    expect(collab.triageState).toBe('POSSIBLE'); // a suggestion for the owner, nothing else
    expect(collab.category).toBe('COLLABORATION');
    expect(collab.state).toBe('NEED_REPLY');
    expect(collab.opportunityId).toBeNull();
    expect((await h.db.select().from(opportunities).where(eq(opportunities.orgId, ctx.orgId))).length).toBe(
      0,
    );
    expect(news.category).not.toBe('COLLABORATION');

    // T20: the same events again (full resync and a replay with the cursor reset) add nothing
    const again = await runSync(h.db, org.env, conn.id, { full: true }, overrides);
    expect(again).toMatchObject({ imported: 0, duplicates: 2 });
    await h.db.delete(syncCursors).where(eq(syncCursors.connectionId, conn.id));
    const replay = await runSync(h.db, org.env, conn.id, {}, overrides);
    expect(replay).toMatchObject({ imported: 0, duplicates: 2 });
    threads = await listThreads(ctx);
    expect(threads.length).toBe(2);
    const msgCount = await h.db.execute(
      sql`select count(*)::int as n from messages where org_id = ${ctx.orgId}`,
    );
    expect((msgCount as any).rows[0].n).toBe(2);

    // triage: dismiss the unrelated one, confirm the real one (creates exactly one opportunity, idempotently)
    await triageThread(ctx, news.id, 'DISMISSED');
    const c1 = await triageThread(ctx, collab.id, 'CONFIRMED');
    const c2 = await triageThread(ctx, collab.id, 'CONFIRMED');
    expect((c1 as any).opportunity.id).toBe((c2 as any).opportunity.id);
    expect((c2 as any).alreadyConfirmed).toBe(true);
    const opps = await h.db.select().from(opportunities).where(eq(opportunities.orgId, ctx.orgId));
    expect(opps.length).toBe(1);
    const dismissed = await h.db
      .select()
      .from(conversationThreads)
      .where(and(eq(conversationThreads.orgId, ctx.orgId), eq(conversationThreads.triageState, 'DISMISSED')));
    expect(dismissed.map((d) => d.id)).toEqual([news.id]);
  });

  it('T19 a manual intake produces a confirmed opportunity at once and is a triage-free path', async () => {
    const { ctx } = await todoWorld();
    const r = await manualIntake(ctx, {
      brand: 'Acme Co',
      contactEmail: 'pr@acme.test',
      subject: 'Reel collab',
      valueMinor: 100000,
      currency: 'CAD',
    });
    expect(r.opportunity.stage).toBe('TRIAGE');
    expect((await listThreads(ctx))[0]!.triageState).toBe('CONFIRMED');
  });

  it('T20 identical inbound content in the same thread is stored once, even without a provider id', async () => {
    const { ctx } = await todoWorld();
    const input = {
      source: 'MANUAL' as const,
      providerThreadId: 'manual-thread-1',
      direction: 'INBOUND' as const,
      receivedAt: new Date('2030-01-01T10:00:00Z'),
      fromEmail: 'pr@acme.test',
      subject: 'Hello',
      body: 'Same text',
    };
    const a = await ingestMessage(ctx, input);
    const b = await ingestMessage(ctx, input);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.messageId).toBeNull();
  });
});

// ------------------------------------------------------------------ deals and money (T21, T23)
describe('deals (T21, T23)', () => {
  it('T21 a deal with three deliverables tracks approvals and publication independently', async () => {
    const { ctx } = await todoWorld();
    const { opportunity } = await manualIntake(ctx, {
      brand: 'Nova',
      subject: 'Three videos',
      valueMinor: 300000,
    });
    const { deal } = await convertOpportunityToDeal(ctx, opportunity.id, { contractedValueMinor: 300000 });
    const brand = await createBrand(ctx, { name: 'Mehak' });
    const ch = await createChannel(ctx, { brandId: brand.id, name: 'Mehak' });
    const yt = await createSocialAccount(ctx, { channelId: ch.id, platform: 'youtube', handle: '@m' });

    const dels = [];
    for (const t of ['Reel 1', 'Reel 2', 'Story set'])
      dels.push(await addDeliverable(ctx, deal.id, { title: t }));

    // approvals are independent and need evidence
    await expect(setDeliverableStatus(ctx, dels[0]!.id, 'APPROVED')).rejects.toMatchObject({
      code: 'EVIDENCE_REQUIRED',
    });
    await setDeliverableStatus(ctx, dels[0]!.id, 'SUBMITTED');
    await setDeliverableStatus(ctx, dels[0]!.id, 'APPROVED', { evidence: 'Sam approved on call 2030-01-03' });
    await setDeliverableStatus(ctx, dels[1]!.id, 'SUBMITTED');
    await setDeliverableStatus(ctx, dels[1]!.id, 'CHANGES_REQUESTED', { evidence: 'wants a new hook' });

    // publication is tracked per deliverable, separately from approval
    const asset = await createAsset(ctx, { title: 'Reel 1 master', kind: 'VIDEO' });
    const variant = await createVariant(ctx, {
      assetId: asset.id,
      titleMaster: 'Reel 1',
      type: 'SHORT_FORM',
    } as any);
    const { record } = await createRecord(ctx, {
      socialAccountId: yt.id,
      variantId: variant.id,
      deliverableId: dels[0]!.id,
      title: 'Reel 1',
      plannedAt: new Date(Date.now() - 1000).toISOString(),
      state: 'PLANNED',
    } as any);
    await markPublishedManual(ctx, record.id, { url: 'https://www.youtube.com/watch?v=abcdefghijk' });

    const d = await getDeal(ctx, deal.id);
    const by = Object.fromEntries(d.deliverables.map((x) => [x.title, x]));
    expect(by['Reel 1']!.status).toBe('APPROVED');
    expect(by['Reel 1']!.approvalEvidence).toMatch(/approved/);
    expect(by['Reel 2']!.status).toBe('CHANGES_REQUESTED');
    expect(by['Reel 2']!.revisionRounds).toBe(1);
    expect(by['Story set']!.status).toBe('PLANNED');
    const pubs = await h.db.select().from(publicationRecords).where(eq(publicationRecords.orgId, ctx.orgId));
    expect(pubs.filter((p) => p.deliverableId)).toHaveLength(1);
    expect(pubs.find((p) => p.deliverableId)!.deliverableId).toBe(dels[0]!.id);
  });

  it('T23 a partially paid invoice shows the correct outstanding balance and status', async () => {
    const { ctx } = await todoWorld();
    const { opportunity } = await manualIntake(ctx, {
      brand: 'Zed',
      subject: 'One video',
      valueMinor: 100000,
    });
    const { deal } = await convertOpportunityToDeal(ctx, opportunity.id, {
      contractedValueMinor: 100000,
      currency: 'CAD',
    });
    const inv = await createInvoice(ctx, {
      dealId: deal.id,
      amountMinor: 100000,
      currency: 'CAD',
      draft: true,
    });
    await issueInvoice(ctx, inv.id);
    await recordPayment(ctx, inv.id, { amountMinor: 35000 });
    await recordPayment(ctx, inv.id, { amountMinor: 15000 });
    const after = await getInvoice(ctx, inv.id);
    expect(after.paidTotalMinor).toBe(50000);
    expect(after.amountMinor - after.paidTotalMinor).toBe(50000);
    expect(after.status).toBe('PARTIALLY_PAID');
    expect(after.payments.length).toBe(2);
    const d = await getDeal(ctx, deal.id);
    expect(d.summary).toMatchObject({ invoicedMinor: 100000, receivedMinor: 50000, outstandingMinor: 50000 });
  });
});

// -------------------------------------------------------------- timezones, honesty, failures
describe('timezones, optional integrations and failure injection (T29, T32, T34)', () => {
  it('T29 planned times follow the owner timezone across DST changes', async () => {
    const { ctx } = await todoWorld();
    const brand = await createBrand(ctx, { name: 'TZ' });
    const ch = await createChannel(ctx, { brandId: brand.id, name: 'TZ' });
    const acct = await createSocialAccount(ctx, { channelId: ch.id, platform: 'youtube', handle: '@tz' });
    const plan = async (local: string, plannedTimezone?: string) =>
      (
        await createRecord(ctx, {
          socialAccountId: acct.id,
          plannedLocal: local,
          plannedTimezone,
          title: local,
        } as any)
      ).record;
    // America/Vancouver (the default): spring forward Sun 8 Mar 2026
    expect((await plan('2026-03-07T09:00')).plannedAt!.toISOString()).toBe('2026-03-07T17:00:00.000Z'); // PST (UTC-8)
    expect((await plan('2026-03-08T09:00')).plannedAt!.toISOString()).toBe('2026-03-08T16:00:00.000Z'); // PDT (UTC-7)
    expect((await plan('2026-03-08T09:00')).plannedTimezone).toBe('America/Vancouver');
    // fall back (Pacific rules): Sun 3 Nov 2030
    expect((await plan('2030-11-02T09:00', 'America/Los_Angeles')).plannedAt!.toISOString()).toBe(
      '2030-11-02T16:00:00.000Z',
    );
    expect((await plan('2030-11-03T09:00', 'America/Los_Angeles')).plannedAt!.toISOString()).toBe(
      '2030-11-03T17:00:00.000Z',
    );
    // whatever the platform's tz database says (British Columbia is moving to permanent daylight time),
    // a planned wall-clock time always round-trips to the same wall-clock time in the stored zone
    for (const day of ['2026-06-15', '2026-11-02', '2026-12-25', '2027-03-14', '2027-11-07', '2030-01-15']) {
      const r = await plan(day + 'T09:00');
      expect(utcToZonedParts(r.plannedAt!, r.plannedTimezone)).toMatchObject({ hour: 9, minute: 0 });
    }
  });
  it('T32 with no provider configured the core stays operational and every integration says exactly why not', async () => {
    const { ctx } = await todoWorld();
    const list = await listIntegrations(ctx);
    const byProvider = Object.fromEntries(list.map((i) => [i.provider, i]));
    for (const p of ['gmail', 'youtube', 'postiz', 'meta', 'tiktok']) {
      expect(['NOT_CONFIGURED', 'BLOCKED_EXTERNAL', 'UNCONFIGURED']).toContain(byProvider[p]!.state);
      expect(byProvider[p]!.capabilities.write).toBe(false);
      expect(byProvider[p]!.capabilities.blockers.length).toBeGreaterThan(0);
    }
    expect(byProvider.gmail!.capabilities.setupSteps.length).toBeGreaterThan(0);
    // core features still work
    const a = await createAction(ctx, { title: 'Works offline from every provider' });
    expect((await listActions(ctx)).map((x) => x.id)).toContain(a.id);
    expect((await briefing(ctx)).top).toBeDefined();
  });

  it('T34 API 429s are visible and recoverable: the connection keeps its state, the error is recorded, the next sync succeeds', async () => {
    const { ctx, conn, org, yt, overrides } = await youtubeWorld([
      ytVideo('rateLimitedA', 'Some video', new Date(Date.now() - 86400_000).toISOString()),
    ]);
    yt.state.rateLimited = 1000; // every call is rate limited (retries included)
    await expect(runSync(h.db, org.env, conn.id, {}, overrides)).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
    });
    let [c] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, conn.id));
    expect(c!.state).toBe('ACTIVE'); // not demoted: it is a temporary condition
    expect(c!.lastError).toMatch(/rate limit/i);
    const events = await h.db.execute(
      sql`select count(*)::int as n from outbox_events where org_id = ${ctx.orgId} and type = 'connector.sync.failed'`,
    );
    expect((events as any).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await listUnmatchedPublications(ctx)).length).toBe(0); // nothing half-imported

    yt.state.rateLimited = 0;
    const ok = await runSync(h.db, org.env, conn.id, {}, overrides);
    expect(ok.created).toBe(1);
    [c] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, conn.id));
    expect(c!.lastError).toBeNull();
    expect(c!.state).toBe('ACTIVE');
  });

  it('T34 an expired Gmail history cursor triggers a full resync with no duplicates', async () => {
    const org = await makeOrg(h);
    const ctx = org.ctx as Ctx;
    const conn = await connect(ctx, 'gmail', 'owner@creator.test');
    const msg = gmailMsg('g9', 'th9', 'a@b.test', 'Hello there', 'plain body text', Date.now() - 1000);
    const gm = fakeGmail([msg]);
    const overrides = { fetch: gm.fetch, ...noSleep } as const;
    await runSync(h.db, org.env, conn.id, {}, overrides);
    const [cur] = await h.db.select().from(syncCursors).where(eq(syncCursors.connectionId, conn.id));
    expect(cur!.cursor).toBe('500');

    gm.state.historyExpired = true;
    gm.state.historyId = '900';
    const r = await runSync(h.db, org.env, conn.id, {}, overrides);
    expect(r.resynced).toBe(true);
    expect(r.imported).toBe(0);
    expect(r.duplicates).toBe(1);
    const [after] = await h.db.select().from(syncCursors).where(eq(syncCursors.connectionId, conn.id));
    expect(after!.cursor).toBe('900');
    expect(after!.restartRequired).toBe(false);
    expect((await listThreads(ctx)).length).toBe(1);
  });

  it('T34 an auth failure flips the connection to AUTH_EXPIRED visibly instead of failing silently', async () => {
    const org = await makeOrg(h);
    const ctx = org.ctx as Ctx;
    const conn = await connect(ctx, 'gmail', 'owner@creator.test');
    const overrides = {
      fetch: async () => json({ error: { message: 'invalid' } }, 401),
      ...noSleep,
    } as const;
    await expect(runSync(h.db, org.env, conn.id, {}, overrides)).rejects.toBeTruthy();
    const [c] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, conn.id));
    expect(c!.state).toBe('AUTH_EXPIRED');
    expect(c!.lastError).toBeTruthy();
    const list = await listIntegrations(ctx);
    expect(list.find((i) => i.provider === 'gmail')!.state).toBe('AUTH_EXPIRED');
  });
});
