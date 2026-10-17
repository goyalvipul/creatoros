import { describe, expect, it } from 'vitest';
import {
  CONNECTORS,
  ConnectorError,
  GmailConnector,
  InstagramConnector,
  PostizConnector,
  TikTokConnector,
  TodoConnector,
  buildGoogleAuthUrl,
  classifyHttpError,
  ensureFreshToken,
  generatePkce,
  http,
  parseAddress,
  parseIsoDurationMs,
  parseRetryAfter,
  refreshGoogleToken,
  type ConnectorContext,
  type Credentials,
} from './index';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function makeCtx(handlers: Handler | Handler[], over: Partial<ConnectorContext> = {}) {
  const queue = Array.isArray(handlers) ? [...handlers] : null;
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const ctx: ConnectorContext = {
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      const h = queue ? (queue.length > 1 ? queue.shift()! : queue[0]!) : (handlers as Handler);
      return h(url, init);
    },
    now: () => 1_800_000_000_000,
    credentials: {},
    config: {},
    sleep: async (ms) => void sleeps.push(ms),
    ...over,
  };
  return { ctx, calls, sleeps };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const text = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

const client = { clientId: 'cid', redirectUri: 'https://app.example/cb' };

describe('http wrapper', () => {
  it('retries idempotent GETs on 5xx and 429 with Retry-After, then succeeds', async () => {
    const { ctx, calls, sleeps } = makeCtx([
      () => text('boom', 503),
      () => text('slow', 429, { 'retry-after': '2' }),
      () => json({ ok: true }),
    ]);
    const r = await http<{ ok: boolean }>(ctx, 'https://x.test/a');
    expect(r.data.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleeps[1]).toBe(2000);
  });

  it('never retries a POST unless it is marked idempotent', async () => {
    const { ctx, calls } = makeCtx(() => text('boom', 503));
    await expect(http(ctx, 'https://x.test/a', { method: 'POST', json: {} })).rejects.toMatchObject({
      kind: 'SERVER',
    });
    expect(calls).toHaveLength(1);
    const again = makeCtx(() => text('boom', 503));
    await expect(
      http(again.ctx, 'https://x.test/a', { method: 'POST', json: {}, idempotent: true, maxAttempts: 3 }),
    ).rejects.toMatchObject({ kind: 'SERVER' });
    expect(again.calls).toHaveLength(3);
  });

  it('gives up after maxAttempts and surfaces network errors as retryable NETWORK', async () => {
    const { ctx, calls } = makeCtx(() => {
      throw new Error('ECONNRESET');
    });
    await expect(http(ctx, 'https://x.test/a', { maxAttempts: 2 })).rejects.toMatchObject({
      kind: 'NETWORK',
      retryable: true,
    });
    expect(calls).toHaveLength(2);
  });

  it('classifies HTTP failures into the error taxonomy', () => {
    const h = new Headers();
    const k = (s: number, b = '') => classifyHttpError(s, b, h, 0).kind;
    expect(k(401)).toBe('AUTH_EXPIRED');
    expect(k(403, 'Daily quotaExceeded')).toBe('QUOTA_EXCEEDED');
    expect(k(403, 'nope')).toBe('PERMISSION_DENIED');
    expect(k(404)).toBe('NOT_FOUND');
    expect(k(409)).toBe('CONFLICT');
    expect(k(429)).toBe('RATE_LIMITED');
    expect(k(500)).toBe('SERVER');
    expect(k(400)).toBe('BAD_REQUEST');
    expect(classifyHttpError(401, '', h, 0).retryable).toBe(false);
  });

  it('parses Retry-After in seconds and HTTP dates', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(parseRetryAfter(null, 0)).toBeUndefined();
    expect(parseRetryAfter('garbage', 0)).toBeUndefined();
  });

  it('sends query, JSON and form bodies correctly', async () => {
    const a = makeCtx(() => json({}));
    await http(a.ctx, 'https://x.test/a?z=1', { query: { q: 'hi there', skip: undefined } });
    expect(a.calls[0]!.url).toBe('https://x.test/a?z=1&q=hi+there');
    const b = makeCtx(() => json({}));
    await http(b.ctx, 'https://x.test/a', { method: 'POST', form: { a: '1 2' } });
    expect(b.calls[0]!.init.body).toBe('a=1+2');
    expect((b.calls[0]!.init.headers as Headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
  });
});

describe('token freshness', () => {
  const fresh = (c: Credentials) => makeCtx(() => json({}), { credentials: c }).ctx;

  it('reuses a valid token and refreshes an expiring one, persisting the new credentials', async () => {
    let saved: Credentials | undefined;
    const ctx = fresh({ accessToken: 'old', refreshToken: 'r', expiresAt: 1_800_000_000_000 + 30_000 });
    ctx.onCredentials = (c) => void (saved = c);
    const t = await ensureFreshToken(ctx, async () => ({
      accessToken: 'new',
      refreshToken: 'r',
      expiresAt: 9e12,
    }));
    expect(t).toBe('new');
    expect(saved?.accessToken).toBe('new');
    expect(await ensureFreshToken(fresh({ accessToken: 'ok', expiresAt: 9e12 }), async () => ({}))).toBe(
      'ok',
    );
  });

  it('explains how to recover when nothing can refresh', async () => {
    await expect(ensureFreshToken(fresh({}), async () => ({}))).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
    });
    await expect(
      ensureFreshToken(fresh({ accessToken: 'x', expiresAt: 1 }), async () => ({})),
    ).rejects.toMatchObject({ kind: 'AUTH_EXPIRED' });
  });
});

describe('Google OAuth', () => {
  it('builds a PKCE authorize URL with offline access and narrow scopes', () => {
    const p = generatePkce();
    const url = new URL(
      buildGoogleAuthUrl({
        client,
        scopes: ['openid', 'https://www.googleapis.com/auth/gmail.readonly'],
        state: 's1',
        codeChallenge: p.challenge,
      }),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(p.challenge);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).not.toMatch(/send|compose|modify/);
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('maps a rejected refresh token to AUTH_REVOKED and never calls without a client', async () => {
    const { ctx } = makeCtx(() => json({ error: 'invalid_grant' }, 400), {
      credentials: { refreshToken: 'r' },
      config: { googleClient: client },
    });
    await expect(refreshGoogleToken(ctx)).rejects.toMatchObject({ kind: 'AUTH_REVOKED' });
    const none = makeCtx(() => json({}), { credentials: { refreshToken: 'r' } });
    await expect(refreshGoogleToken(none.ctx)).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
    expect(none.calls).toHaveLength(0);
  });

  it('refreshes successfully and keeps the refresh token', async () => {
    const { ctx } = makeCtx(() => json({ access_token: 'A2', expires_in: 3600, scope: 'a b' }), {
      credentials: { refreshToken: 'r', scopes: ['x'] },
      config: { googleClient: client },
    });
    const next = await refreshGoogleToken(ctx);
    expect(next).toMatchObject({ accessToken: 'A2', refreshToken: 'r', scopes: ['a', 'b'] });
    expect(next.expiresAt).toBe(1_800_000_000_000 + 3_600_000);
  });
});

describe('Gmail connector', () => {
  const gmail = new GmailConnector();
  const b64 = (s: string) => Buffer.from(s).toString('base64url');

  it('is honestly NOT_CONFIGURED without an OAuth client and offers setup steps instead of fake data', async () => {
    const { ctx } = makeCtx(() => json({}));
    const caps = await gmail.getCapabilities(ctx);
    expect(caps.state).toBe('NOT_CONFIGURED');
    expect(caps.read).toBe(false);
    expect(caps.flags.sendEmail).toBe(false);
    expect((await gmail.connect(ctx)).status).toBe('NOT_CONFIGURED');
  });

  it('starts read-only OAuth, requesting drafts only when explicitly asked', async () => {
    const { ctx } = makeCtx(() => json({}), { config: { googleClient: client } });
    const r = await gmail.connect(ctx);
    expect(r.status).toBe('REDIRECT');
    expect(r.oauth!.scopes.some((s) => /compose/.test(s))).toBe(false);
    expect(r.authorizeUrl).toContain('gmail.readonly');
    expect((await gmail.connect(ctx, { drafts: true })).oauth!.scopes.some((s) => /compose/.test(s))).toBe(
      true,
    );
  });

  it('parses addresses without trusting display names', () => {
    expect(parseAddress('"Sam Lee" <Sam@Acme.com>')).toEqual({ email: 'sam@acme.com', name: 'Sam Lee' });
    expect(parseAddress('plain@x.com')).toEqual({ email: 'plain@x.com', name: null });
    expect(parseAddress('ceo@bank.com <evil@x.com>').email).toBe('evil@x.com');
    expect(parseAddress(undefined)).toEqual({ email: null, name: null });
  });

  it('normalises a multipart message with attachments and a stable checksum', () => {
    const raw = {
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX'],
      snippet: 'hello',
      internalDate: '1800000000000',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: 'Sam <sam@acme.com>' },
          { name: 'To', value: 'me@x.com, You <you@x.com>' },
          { name: 'Subject', value: 'Collab?' },
        ],
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: b64('Plain body') } },
              { mimeType: 'text/html', body: { data: b64('<b>Html</b>') } },
            ],
          },
          { mimeType: 'application/pdf', filename: 'rates.pdf', body: { size: 10, attachmentId: 'att1' } },
        ],
      },
    };
    const n = gmail.normalize(raw);
    expect(n).toMatchObject({
      providerMsgId: 'm1',
      fromEmail: 'sam@acme.com',
      direction: 'INBOUND',
      bodyText: 'Plain body',
      subject: 'Collab?',
    });
    expect(n.toEmails).toEqual(['me@x.com', 'you@x.com']);
    expect(n.attachments).toEqual([
      { name: 'rates.pdf', mime: 'application/pdf', sizeBytes: 10, ref: 'att1' },
    ]);
    expect(gmail.normalize(raw).rawChecksum).toBe(n.rawChecksum);
    expect(gmail.normalize({ ...raw, labelIds: ['SENT'] }).direction).toBe('OUTBOUND');
  });

  it('falls back to a full resync when the history cursor expired (404)', async () => {
    const { ctx, calls } = makeCtx(
      (url) => {
        if (url.includes('/history')) return json({ error: { message: 'startHistoryId too old' } }, 404);
        if (url.endsWith('/profile')) return json({ historyId: '999', emailAddress: 'me@x.com' });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'm1' }] });
        return json({
          id: 'm1',
          threadId: 't1',
          snippet: 's',
          internalDate: '1800000000000',
          payload: { headers: [{ name: 'Subject', value: 'Hi' }] },
        });
      },
      {
        credentials: {
          accessToken: 'tok',
          expiresAt: 9e12,
          scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        },
      },
    );
    const r = await gmail.syncIncremental(ctx, '123');
    expect(r.resynced).toBe(true);
    expect(r.nextCursor).toBe('999');
    expect(r.items.map((i) => i.providerMsgId)).toEqual(['m1']);
    expect(calls.every((c) => (c.init.headers as Headers).get('authorization') === 'Bearer tok')).toBe(true);
  });

  it('collects only newly added messages from history and skips deleted ones', async () => {
    const { ctx } = makeCtx(
      (url) => {
        if (url.includes('/history'))
          return json({
            history: [{ id: '5', messagesAdded: [{ message: { id: 'a' } }, { message: { id: 'gone' } }] }],
            historyId: '7',
          });
        if (url.includes('/messages/gone')) return json({}, 404);
        return json({ id: 'a', threadId: 't', payload: { headers: [] }, internalDate: '1800000000000' });
      },
      { credentials: { accessToken: 'tok', expiresAt: 9e12 } },
    );
    const r = await gmail.syncIncremental(ctx, '1');
    expect(r.items.map((i) => i.providerMsgId)).toEqual(['a']);
    expect(r.nextCursor).toBe('7');
    expect(r.resynced).toBeUndefined();
  });

  it('reports health as AUTH_EXPIRED when the token is rejected', async () => {
    const { ctx } = makeCtx(() => json({}, 401), { credentials: { accessToken: 'tok', expiresAt: 9e12 } });
    expect(await gmail.health(ctx)).toMatchObject({ ok: false, state: 'AUTH_EXPIRED' });
  });
});

describe('Todo adapter', () => {
  const todo = new TodoConnector();
  const cfg = {
    baseUrl: 'https://todo.test/api/',
    authScheme: 'header',
    authHeader: 'x-token',
    fieldMap: { dueAt: 'due.date', completed: 'status', title: 'content' },
    completion: { style: 'status', doneValue: 'closed', openValue: 'open' },
    priorityMap: { LOW: 1, NORMAL: 2, HIGH: 3, URGENT: 4 },
    projectId: 'p9',
    defaultTags: ['creator-os'],
  };

  it('is NOT_CONFIGURED until a base URL exists', async () => {
    const { ctx } = makeCtx(() => json({}));
    expect((await todo.getCapabilities(ctx)).state).toBe('NOT_CONFIGURED');
    expect((await todo.health(ctx)).state).toBe('NOT_CONFIGURED');
    await expect(todo.listTasks(ctx)).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
  });

  it('maps our task onto the remote shape using configuration only, and sends an Idempotency-Key', async () => {
    const { ctx, calls } = makeCtx(
      () => json({ id: 7, content: 'Send invoice', status: 'open', external_ref: 'cos:1' }),
      {
        config: cfg,
        credentials: { apiKey: 'secret' },
      },
    );
    const t = await todo.createTask(
      ctx,
      {
        title: 'Send invoice',
        dueAt: '2026-10-20T10:00:00Z',
        priority: 'HIGH',
        externalRef: 'cos:1',
        tags: ['invoice'],
      },
      'key-1',
    );
    const call = calls[0]!;
    expect(call.url).toBe('https://todo.test/api/tasks');
    const headers = call.init.headers as Headers;
    expect(headers.get('idempotency-key')).toBe('key-1');
    expect(headers.get('x-token')).toBe('secret');
    expect(headers.get('authorization')).toBeNull();
    expect(JSON.parse(String(call.init.body))).toEqual({
      content: 'Send invoice',
      due: { date: '2026-10-20T10:00:00Z' },
      external_ref: 'cos:1',
      priority: 3,
      tags: ['creator-os', 'invoice'],
      project_id: 'p9',
    });
    expect(t).toMatchObject({ id: '7', title: 'Send invoice', completed: false, externalRef: 'cos:1' });
  });

  it('finds an existing remote task by our reference so retries never create duplicates', async () => {
    const { ctx, calls } = makeCtx(
      () =>
        json({
          items: [
            { id: 1, content: 'a', external_ref: 'other' },
            { id: 2, content: 'b', external_ref: 'cos:2' },
          ],
        }),
      { config: cfg },
    );
    expect((await todo.findByRef(ctx, 'cos:2'))?.id).toBe('2');
    expect(calls[0]!.url).toContain('external_ref=cos%3A2');
    const none = makeCtx(() => json({ items: [] }), { config: cfg });
    expect(await todo.findByRef(none.ctx, 'cos:3')).toBeNull();
  });

  it('reads completion from a status field and detects edit conflicts with If-Match', async () => {
    const { ctx } = makeCtx(() => json({ id: 2, content: 'b', status: 'closed' }), { config: cfg });
    expect((await todo.getTask(ctx, '2'))?.completed).toBe(true);
    const conflict = makeCtx(() => json({ error: 'stale' }, 412), { config: cfg });
    await expect(todo.updateTask(conflict.ctx, '2', { title: 'x' }, 'rev-1')).rejects.toMatchObject({
      kind: 'CONFLICT',
    });
    expect((conflict.calls[0]!.init.headers as Headers).get('if-match')).toBe('rev-1');
    const gone = makeCtx(() => json({}, 404), { config: cfg });
    expect(await todo.getTask(gone.ctx, '9')).toBeNull();
  });
});

describe('YouTube helpers', () => {
  it('parses ISO-8601 durations', () => {
    expect(parseIsoDurationMs('PT1M30S')).toBe(90_000);
    expect(parseIsoDurationMs('PT1H')).toBe(3_600_000);
    expect(parseIsoDurationMs('PT45S')).toBe(45_000);
    expect(parseIsoDurationMs(undefined)).toBeNull();
  });
});

describe('social connectors never claim more than they can verify', () => {
  it('Postiz: only a returned release URL counts as verified-published', () => {
    const p = new PostizConnector();
    expect(
      p.normalize({
        id: '1',
        state: 'PUBLISHED',
        releaseURL: 'https://x.test/p/1',
        publishDate: '2026-10-01T00:00:00Z',
      }).state,
    ).toBe('PUBLISHED_VERIFIED');
    expect(p.normalize({ id: '2', state: 'PUBLISHED' }).state).toBe('UNKNOWN');
    expect(p.normalize({ id: '3', state: 'QUEUE' }).state).toBe('SCHEDULED');
    expect(p.normalize({ id: '4', state: 'ERROR' }).state).toBe('FAILED');
  });

  it('Postiz and Meta report NOT_CONFIGURED and never schedule or publish', async () => {
    const { ctx } = makeCtx(() => json({}));
    const postiz = await new PostizConnector().getCapabilities(ctx);
    expect(postiz.state).toBe('NOT_CONFIGURED');
    expect(postiz.write).toBe(false);
    const meta = await new InstagramConnector().getCapabilities(ctx);
    expect(meta).toMatchObject({ state: 'NOT_CONFIGURED', write: false });
    expect(meta.flags.publish).toBe(false);
    expect(meta.flags.readDirectMessages).toBe(false);
    await expect(new InstagramConnector().syncFull(ctx)).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
  });

  it('Instagram sync stops at the cursor and returns the newest timestamp', async () => {
    const { ctx } = makeCtx(
      () =>
        json({
          data: [
            { id: 'new', timestamp: '2026-10-10T00:00:00+0000', permalink: 'https://ig/new' },
            { id: 'old', timestamp: '2026-09-01T00:00:00+0000' },
          ],
        }),
      { credentials: { accessToken: 't' }, config: { igUserId: '1' } },
    );
    const r = await new InstagramConnector().syncIncremental(ctx, '2026-09-15T00:00:00+0000');
    expect(r.items.map((i) => i.externalId)).toEqual(['new']);
    expect(r.nextCursor).toBe('2026-10-10T00:00:00+0000');
  });

  it('TikTok pages through videos and stops at the stored cursor', async () => {
    const pages = [
      () =>
        json({
          data: {
            videos: [
              { id: 'v3', create_time: 300 },
              { id: 'v2', create_time: 200 },
            ],
            has_more: true,
            cursor: 5,
          },
        }),
      () => json({ data: { videos: [{ id: 'v1', create_time: 100 }], has_more: false } }),
    ];
    let i = 0;
    const { ctx, calls } = makeCtx(() => pages[i++]!(), {
      credentials: { accessToken: 't', expiresAt: 9e12, scopes: ['video.list'] },
      config: { clientKey: 'k', clientSecret: 's', redirectUri: 'r' },
    });
    const full = await new TikTokConnector().syncFull(ctx);
    expect(full.items.map((v) => v.externalId)).toEqual(['v3', 'v2', 'v1']);
    expect(JSON.parse(String(calls[1]!.init.body)).cursor).toBe(5);
    i = 0;
    const inc = await new TikTokConnector().syncIncremental(ctx, '200');
    expect(inc.items.map((v) => v.externalId)).toEqual(['v3']);
  });

  it('Snapchat and the Google umbrella are gated with an explanation, not stubs that return data', async () => {
    const { ctx } = makeCtx(() => json({}));
    const snap = CONNECTORS.snapchat;
    expect((await snap.getCapabilities(ctx)).state).toBe('UNSUPPORTED');
    await expect(snap.syncFull(ctx)).rejects.toBeInstanceOf(ConnectorError);
    expect((await CONNECTORS.manual.getCapabilities(ctx)).read).toBe(false);
  });
});
