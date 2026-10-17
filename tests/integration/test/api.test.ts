import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAgentRequest } from '@creatoros/services';
import { freshDb, makeApi, type Api } from '../src/helpers';

const OWNER = {
  email: 'owner@creator.test',
  password: 'violet harbor lantern quartz',
  name: 'Owner',
  orgName: 'Creator Test',
  timezone: 'America/Vancouver',
  currency: 'CAD',
};
const V1 = '/api/v1';

let fresh: Awaited<ReturnType<typeof freshDb>>;
let api: Api;
let owner: string; // cookie
let editor: string;
let viewer: string;

beforeAll(async () => {
  fresh = await freshDb();
  api = await makeApi(fresh.handle, fresh.url);
});
afterAll(async () => {
  await api.close();
  await fresh.drop();
});

const j = (r: { body: any }) => r.body.data;

describe('first run and auth', () => {
  it('reports a fresh install, refuses weak passwords, bootstraps once', async () => {
    expect(j(await api.call('GET', `${V1}/setup/status`)).initialized).toBe(false);
    const weak = await api.call('POST', `${V1}/setup/bootstrap`, { body: { ...OWNER, password: 'short' } });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');
    expect(weak.body.data).toBeNull();
    const ok = await api.call('POST', `${V1}/setup/bootstrap`, { body: OWNER });
    expect(ok.status).toBe(201);
    expect(ok.cookie).toMatch(/^cos_session=/);
    owner = ok.cookie!;
    const again = await api.call('POST', `${V1}/setup/bootstrap`, {
      body: { ...OWNER, email: 'attacker@evil.test' },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_INITIALIZED');
    expect(j(await api.call('GET', `${V1}/setup/status`)).initialized).toBe(true);
  });

  it('responses use the {data, meta, error} envelope and unauthenticated calls get 401', async () => {
    const anon = await api.call('GET', `${V1}/projects`);
    expect(anon.status).toBe(401);
    expect(anon.body).toMatchObject({ data: null, error: { code: 'UNAUTHORIZED' } });
    expect(anon.body.meta.requestId).toBeTruthy();
    const me = await api.call('GET', `${V1}/me`, { cookie: owner });
    expect(me.status).toBe(200);
    expect(me.body.error).toBeNull();
    expect(j(me).user.role).toBe('OWNER');
    expect(j(me).organization.baseCurrency).toBe('CAD');
    const nf = await api.call('GET', `${V1}/nope`, { cookie: owner });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
  });

  it('blocks cross-site and header-less state changes (CSRF)', async () => {
    const foreign = await api.call('POST', `${V1}/ideas`, {
      cookie: owner,
      body: { title: 'x' },
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    const noHeader = await api.app.inject({
      method: 'POST',
      url: `${V1}/ideas`,
      headers: { cookie: owner, 'content-type': 'application/json' },
      payload: '{"title":"x"}',
    });
    expect(noHeader.statusCode).toBe(403);
    const sameOrigin = await api.call('POST', `${V1}/ideas`, {
      cookie: owner,
      body: { title: 'ok' },
      headers: { origin: 'http://localhost:8080' },
    });
    expect(sameOrigin.status).toBe(201);
    const loginForeign = await api.call('POST', `${V1}/auth/login`, {
      body: { email: OWNER.email, password: OWNER.password },
      headers: { origin: 'https://evil.example' },
    });
    expect(loginForeign.status).toBe(403);
  });

  it('enforces roles: viewer reads, editor edits, only owner administers', async () => {
    for (const [email, role] of [
      ['editor@creator.test', 'EDITOR'],
      ['viewer@creator.test', 'VIEWER'],
    ] as const) {
      const r = await api.call('POST', `${V1}/members`, {
        cookie: owner,
        body: { email, name: role, role, password: 'another long passphrase 123' },
      });
      expect(r.status).toBe(201);
    }
    editor = await api.login('editor@creator.test', 'another long passphrase 123');
    viewer = await api.login('viewer@creator.test', 'another long passphrase 123');
    expect((await api.call('GET', `${V1}/projects`, { cookie: viewer })).status).toBe(200);
    expect((await api.call('POST', `${V1}/ideas`, { cookie: viewer, body: { title: 'nope' } })).status).toBe(
      403,
    );
    expect((await api.call('POST', `${V1}/ideas`, { cookie: editor, body: { title: 'fine' } })).status).toBe(
      201,
    );
    expect((await api.call('GET', `${V1}/members`, { cookie: editor })).status).toBe(403);
    expect((await api.call('POST', `${V1}/pairing-codes`, { cookie: editor, body: {} })).status).toBe(403);
    expect((await api.call('GET', `${V1}/members`, { cookie: owner })).status).toBe(200);
    // the last owner cannot be demoted
    const me = j(await api.call('GET', `${V1}/me`, { cookie: owner })).user;
    const demote = await api.call('PATCH', `${V1}/members/${me.id}`, {
      cookie: owner,
      body: { role: 'VIEWER' },
    });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('LAST_OWNER');
  });

  it('validation errors list the offending fields; Idempotency-Key replays', async () => {
    const bad = await api.call('POST', `${V1}/projects`, {
      cookie: owner,
      body: { title: '', type: 'NOT_A_TYPE' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.details.map((d: any) => d.path)).toEqual(expect.arrayContaining(['title', 'type']));
    const key = randomUUID();
    const a = await api.call('POST', `${V1}/ideas`, {
      cookie: owner,
      body: { title: 'Idempotent idea' },
      headers: { 'idempotency-key': key },
    });
    const b = await api.call('POST', `${V1}/ideas`, {
      cookie: owner,
      body: { title: 'Idempotent idea' },
      headers: { 'idempotency-key': key },
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(j(b).id).toBe(j(a).id);
    const list = j(await api.call('GET', `${V1}/ideas?q=Idempotent`, { cookie: owner }));
    expect(list.filter((i: any) => i.title === 'Idempotent idea')).toHaveLength(1);
    const reuse = await api.call('POST', `${V1}/ideas`, {
      cookie: owner,
      body: { title: 'Different body' },
      headers: { 'idempotency-key': key },
    });
    expect(reuse.status).toBe(422);
    expect(reuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('sessions can be revoked and logout invalidates the cookie', async () => {
    const c = await api.login(OWNER.email, OWNER.password);
    expect((await api.call('GET', `${V1}/me`, { cookie: c })).status).toBe(200);
    expect((await api.call('POST', `${V1}/auth/logout`, { cookie: c, body: {} })).status).toBe(200);
    expect((await api.call('GET', `${V1}/me`, { cookie: c })).status).toBe(401);
  });

  it('serves OpenAPI documentation', async () => {
    const r = await api.call('GET', '/api/docs/json');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.paths).length).toBeGreaterThan(100);
    expect(r.body.paths['/api/v1/projects'] ?? r.body.paths['/projects']).toBeTruthy();
  });
});

describe('content flow over HTTP', () => {
  it('brand → channel → account → idea → project → stage gate → asset → publication', async () => {
    const brand = j(await api.call('POST', `${V1}/brands`, { cookie: owner, body: { name: 'HTTP Brand' } }));
    const channel = j(
      await api.call('POST', `${V1}/channels`, {
        cookie: owner,
        body: { brandId: brand.id, name: 'HTTP Channel' },
      }),
    );
    const account = j(
      await api.call('POST', `${V1}/social-accounts`, {
        cookie: owner,
        body: { channelId: channel.id, platform: 'youtube', handle: '@http' },
      }),
    );
    const dupBrand = await api.call('POST', `${V1}/brands`, { cookie: owner, body: { name: 'http brand' } });
    expect(dupBrand.status).toBe(409);

    const idea = j(
      await api.call('POST', `${V1}/ideas`, {
        cookie: owner,
        body: { title: 'Flow idea', brandId: brand.id },
      }),
    );
    const conv1 = await api.call('POST', `${V1}/ideas/${idea.id}/convert`, {
      cookie: owner,
      body: { type: 'SHORT_FORM' },
    });
    const conv2 = await api.call('POST', `${V1}/ideas/${idea.id}/convert`, {
      cookie: owner,
      body: { type: 'SHORT_FORM' },
    });
    expect(conv1.status).toBe(201);
    expect(JSON.stringify(j(conv2))).toContain(JSON.stringify(j(conv1)).match(/"id":"([0-9a-f-]{36})"/)![1]!); // same project, not a second one

    const project = j(
      await api.call('POST', `${V1}/projects`, {
        cookie: owner,
        body: { title: 'Flow project', type: 'MUSIC_VIDEO', contentFormat: 'LYRIC_VIDEO', brandId: brand.id },
      }),
    );
    await api.call('PUT', `${V1}/projects/${project.id}/scenes`, {
      cookie: owner,
      body: { scenes: [1, 2].map((n) => ({ ordinal: n, title: `s${n}` })) },
    });
    const scenes = j(await api.call('GET', `${V1}/projects/${project.id}/scenes`, { cookie: owner }));
    await api.call('PATCH', `${V1}/scenes/${scenes[0].id}`, { cookie: owner, body: { status: 'SELECTED' } });
    const detail = j(await api.call('GET', `${V1}/projects/${project.id}`, { cookie: owner }));
    expect(detail.progress.percent ?? detail.progress.pct).toBe(50);
    const gate = await api.call('POST', `${V1}/projects/${project.id}/stage`, {
      cookie: owner,
      body: { to: 'READY' },
    });
    expect(gate.status).toBe(409);
    expect(gate.body.error.code).toBe('CHECKLIST_INCOMPLETE');

    const asset = j(
      await api.call('POST', `${V1}/assets`, {
        cookie: owner,
        body: { title: 'Flow asset', kind: 'VIDEO', projectId: project.id },
      }),
    );
    const variant = j(
      await api.call('POST', `${V1}/variants`, {
        cookie: owner,
        body: { assetId: asset.id, titleMaster: 'Flow video', type: 'LONG_FORM' },
      }),
    );
    await api.call('PUT', `${V1}/variants/${variant.id}/targets/${account.id}`, {
      cookie: owner,
      body: { desired: true },
    });
    const pub = j(
      await api.call('POST', `${V1}/publications`, {
        cookie: owner,
        body: {
          socialAccountId: account.id,
          variantId: variant.id,
          plannedAt: new Date(Date.now() + 86400_000).toISOString(),
          title: 'Flow video',
          state: 'PLANNED',
        },
      }),
    );
    expect(pub.record.state).toBe('PLANNED');
    // the API must refuse to create a record that claims to be published
    const forged = await api.call('POST', `${V1}/publications`, {
      cookie: owner,
      body: { socialAccountId: account.id, state: 'PUBLISHED_VERIFIED' },
    });
    expect(forged.status).toBe(400);
    const manual = await api.call('POST', `${V1}/publications/${pub.record.id}/mark-published`, {
      cookie: owner,
      body: { url: 'https://www.youtube.com/watch?v=abcdefghijk' },
    });
    expect(manual.status).toBe(200);
    expect(j(manual).state).toBe('PUBLISHED_MANUAL');
    const matrix = j(await api.call('GET', `${V1}/publishing/matrix?assetId=${asset.id}`, { cookie: owner }));
    expect(JSON.stringify(matrix)).toContain('PUBLISHED_MANUAL');
    const an = j(await api.call('GET', `${V1}/analytics`, { cookie: owner }));
    expect(an.totals).toMatchObject({ verified: 0, manual: 1 });
  });

  it('collaboration: intake → deal → deliverable evidence → invoice → payment → close', async () => {
    const intake = j(
      await api.call('POST', `${V1}/intake`, {
        cookie: owner,
        body: {
          brand: 'Acme Co',
          contactEmail: 'pr@acme.test',
          subject: 'Reel collab',
          valueMinor: 100000,
          currency: 'CAD',
        },
      }),
    );
    const deal = j(
      await api.call('POST', `${V1}/opportunities/${intake.opportunity.id}/convert`, {
        cookie: owner,
        body: { contractedValueMinor: 100000, currency: 'CAD', paymentTermsDays: 30 },
      }),
    ).deal;
    const again = j(
      await api.call('POST', `${V1}/opportunities/${intake.opportunity.id}/convert`, {
        cookie: owner,
        body: {},
      }),
    );
    expect(again.alreadyConverted).toBe(true);
    const del = j(
      await api.call('POST', `${V1}/deals/${deal.id}/deliverables`, {
        cookie: owner,
        body: { title: 'Reel' },
      }),
    );
    const noEvidence = await api.call('POST', `${V1}/deliverables/${del.id}/status`, {
      cookie: owner,
      body: { status: 'APPROVED' },
    });
    expect(noEvidence.status).toBe(400);
    expect(noEvidence.body.error.code).toBe('EVIDENCE_REQUIRED');
    const inv = j(
      await api.call('POST', `${V1}/invoices`, {
        cookie: owner,
        body: { dealId: deal.id, amountMinor: 100000, currency: 'CAD', draft: true },
      }),
    );
    expect(inv.invoiceNo).toMatch(/^INV-\d{4}-\d{4}$/);
    await api.call('POST', `${V1}/invoices/${inv.id}/issue`, { cookie: owner, body: {} });
    const blocked = await api.call('POST', `${V1}/deals/${deal.id}/stage`, {
      cookie: owner,
      body: { to: 'PAID_CLOSED' },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('UNPAID_INVOICES');
    const usd = await api.call('POST', `${V1}/invoices/${inv.id}/payments`, {
      cookie: owner,
      body: { amountMinor: 100000, currency: 'USD' },
    });
    expect(usd.status).toBeGreaterThanOrEqual(400);
    const over = await api.call('POST', `${V1}/invoices/${inv.id}/payments`, {
      cookie: owner,
      body: { amountMinor: 100001 },
    });
    expect(over.status).toBeGreaterThanOrEqual(400);
    const paid = await api.call('POST', `${V1}/invoices/${inv.id}/payments`, {
      cookie: owner,
      body: { amountMinor: 100000 },
    });
    expect(paid.status).toBe(201);
    const closed = await api.call('POST', `${V1}/deals/${deal.id}/stage`, {
      cookie: owner,
      body: { to: 'PAID_CLOSED' },
    });
    expect(closed.status).toBe(200);
    const fin = j(await api.call('GET', `${V1}/finance/summary`, { cookie: owner }));
    expect(fin.perCurrency.received.CAD).toBeGreaterThanOrEqual(100000);
  });

  it('global search, briefing, goals and demo data work through the API', async () => {
    const s = j(await api.call('GET', `${V1}/search?q=Flow`, { cookie: owner }));
    expect(JSON.stringify(s)).toContain('Flow');
    expect((await api.call('GET', `${V1}/briefing`, { cookie: owner })).status).toBe(200);
    const goal = await api.call('POST', `${V1}/goals`, {
      cookie: owner,
      body: { name: 'Publish 4', metric: 'VIDEOS_PUBLISHED', targetValue: 4 },
    });
    expect(goal.status).toBe(201);
    expect(j(await api.call('GET', `${V1}/goals`, { cookie: owner })).length).toBeGreaterThan(0);
    expect((await api.call('POST', `${V1}/demo`, { cookie: editor, body: {} })).status).toBe(403);
    expect((await api.call('POST', `${V1}/demo`, { cookie: owner, body: {} })).status).toBe(201);
    expect(j(await api.call('GET', `${V1}/demo`, { cookie: owner })).seeded).toBe(true);
    expect((await api.call('DELETE', `${V1}/demo`, { cookie: owner })).status).toBe(200);
    expect(j(await api.call('GET', `${V1}/demo`, { cookie: owner })).seeded).toBe(false);
  });

  it('integrations are honest: unconfigured providers say so', async () => {
    const list = j(await api.call('GET', `${V1}/integrations`, { cookie: owner }));
    const text = JSON.stringify(list);
    expect(text).toMatch(/NOT_CONFIGURED|UNCONFIGURED|BLOCKED_EXTERNAL/);
    const start = await api.call('POST', `${V1}/integrations/gmail/oauth/start`, { cookie: owner, body: {} });
    expect(j(start).authorizeUrl).toBeNull(); // no GOOGLE_CLIENT_ID configured in tests: must not pretend
    expect(j(start).status).not.toBe('REDIRECT');
    expect(j(start).steps.length).toBeGreaterThan(0);
    expect(
      (await api.call('POST', `${V1}/integrations/gmail/oauth/start`, { cookie: editor, body: {} })).status,
    ).toBe(403);
  });

  it('a viewer cannot read private CRM, email, finance, media, device or integration data (and nobody gets secrets)', async () => {
    const privateGets = [
      '/threads',
      '/deals',
      '/deals/pipeline',
      '/organizations',
      '/contacts',
      '/invoices',
      '/finance/summary',
      '/devices',
      '/roots',
      '/library',
      '/library/counts',
      '/integrations',
      '/todo/status',
      '/todo/links',
      '/actions',
      '/briefing',
      '/notifications',
      '/duplicates/exact',
    ];
    for (const p of privateGets) {
      const anon = await api.call('GET', `${V1}${p}`);
      const v = await api.call('GET', `${V1}${p}`, { cookie: viewer });
      const e = await api.call('GET', `${V1}${p}`, { cookie: editor });
      expect([p, anon.status]).toEqual([p, 401]);
      expect([p, v.status]).toEqual([p, 403]);
      expect([p, e.status < 400]).toEqual([p, true]);
    }
    for (const p of ['/members', '/audit', '/backups', '/pairing-codes']) {
      expect([p, (await api.call('GET', `${V1}${p}`, { cookie: viewer })).status]).toEqual([p, 403]);
      expect([p, (await api.call('GET', `${V1}${p}`, { cookie: editor })).status]).toEqual([p, 403]);
    }
    // the creative pipeline stays readable
    for (const p of [
      '/projects',
      '/ideas',
      '/assets',
      '/publications/unmatched',
      '/publishing/matrix',
      '/catalog',
      '/analytics',
      '/goals',
    ]) {
      const r = await api.call('GET', `${V1}${p}`, { cookie: viewer });
      expect([p, r.status]).toEqual([p, 200]);
    }
    // search hides files, email and CRM entities from viewers
    const searchTypes = async (cookie: string) =>
      new Set<string>(
        j(await api.call('GET', `${V1}/search?q=Acme`, { cookie })).map((h: { type: string }) => h.type),
      );
    expect([...(await searchTypes(owner))]).toContain('organization');
    const vt = await searchTypes(viewer);
    for (const t of ['organization', 'deal', 'thread', 'contact', 'file']) expect(vt.has(t)).toBe(false);
    // secrets are write-only: a saved key never comes back from any endpoint
    const SECRET = 'SUPER-SECRET-TODO-KEY-0123456789';
    expect(
      (
        await api.call('POST', `${V1}/integrations/todo/key`, {
          cookie: owner,
          body: { apiKey: SECRET, config: { baseUrl: 'http://127.0.0.1:9/api', clientSecret: SECRET } },
        })
      ).status,
    ).toBe(200);
    for (const p of ['/integrations', '/todo/status', '/audit', '/devices', '/organization']) {
      const r = await api.call('GET', `${V1}${p}`, { cookie: owner });
      expect([p, JSON.stringify(r.body).includes(SECRET)]).toEqual([p, false]);
    }
  });

  it('workflow webhook requires a valid HMAC and is idempotent', async () => {
    const body = JSON.stringify({ provider: 'comfyui', jobId: 'job-1', status: 'SUCCEEDED', outputs: [] });
    const bad = await api.call('POST', `${V1}/webhooks/workflow`, {
      raw: body,
      headers: { 'content-type': 'application/json', 'x-creatoros-signature': 'deadbeef' },
    });
    expect(bad.status).toBe(401);
    const sig = createHmac('sha256', api.config.workflowWebhookSecret!).update(body).digest('hex');
    const ok = await api.call('POST', `${V1}/webhooks/workflow`, {
      raw: body,
      headers: { 'content-type': 'application/json', 'x-creatoros-signature': sig },
    });
    expect([200, 201, 400, 404, 422]).toContain(ok.status); // signature accepted (manifest content decides the rest)
    expect(ok.status).not.toBe(401);
  });
});

describe('agent over HTTP', () => {
  let agentServer: http.Server;
  let agentPort = 0;
  const content = Buffer.from('0123456789'.repeat(100));
  const dev = { token: '', key: '', deviceId: '', rootId: '' };
  const signed = (method: 'GET' | 'POST', url: string, body = '') => {
    const s = signAgentRequest(dev.key, body);
    return api.call(method, url, {
      raw: body || undefined,
      headers: {
        authorization: `Bearer ${dev.token}`,
        'x-agent-timestamp': s.timestamp,
        'x-agent-signature': s.signature,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
    });
  };

  beforeAll(async () => {
    agentServer = http.createServer((req, res) => {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : content.length - 1;
        res.writeHead(206, {
          'content-type': 'video/mp4',
          'content-range': `bytes ${start}-${end}/${content.length}`,
          'content-length': end - start + 1,
          'accept-ranges': 'bytes',
        });
        res.end(content.subarray(start, end + 1));
      } else {
        res.writeHead(200, {
          'content-type': 'video/mp4',
          'content-length': content.length,
          'accept-ranges': 'bytes',
        });
        res.end(content);
      }
    });
    await new Promise<void>((r) => agentServer.listen(0, '127.0.0.1', r));
    agentPort = (agentServer.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => agentServer.close(() => r())));

  it('pairs once, signs requests, rejects tampering, ingests and streams with Range', async () => {
    const code = j(
      await api.call('POST', `${V1}/pairing-codes`, { cookie: owner, body: { label: 'Test PC' } }),
    ).code as string;
    const pairBody = {
      code,
      deviceUuid: randomUUID(),
      hostname: 'TEST-PC',
      os: 'windows',
      agentVersion: '1.0.0',
    };
    const paired = await api.call('POST', `${V1}/agents/pair`, { body: pairBody });
    expect(paired.status).toBe(201);
    dev.token = j(paired).token;
    dev.key = j(paired).signingKey;
    dev.deviceId = j(paired).deviceId;
    const replay = await api.call('POST', `${V1}/agents/pair`, {
      body: { ...pairBody, deviceUuid: randomUUID() },
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);

    // unsigned and tampered requests are rejected
    expect(
      (await api.call('GET', `${V1}/agents/config`, { headers: { authorization: `Bearer ${dev.token}` } }))
        .status,
    ).toBe(401);
    const s = signAgentRequest(dev.key, '');
    const tampered = await api.call('GET', `${V1}/agents/config`, {
      headers: {
        authorization: `Bearer ${dev.token}`,
        'x-agent-timestamp': s.timestamp,
        'x-agent-signature': s.signature.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')),
      },
    });
    expect(tampered.status).toBe(401);

    // root creation by the owner
    const root = j(
      await api.call('POST', `${V1}/roots`, {
        cookie: owner,
        body: { deviceId: dev.deviceId, label: 'Media', displayPath: 'D:\\Media' },
      }),
    );
    dev.rootId = root.id;
    const hb = await signed(
      'POST',
      `${V1}/agents/heartbeat`,
      JSON.stringify({
        agentVersion: '1.0.0',
        listenUrls: [`http://127.0.0.1:${agentPort}`],
        roots: [{ rootId: root.id, reachable: true }],
      }),
    );
    expect(hb.status).toBe(200);
    const cfg = await signed('GET', `${V1}/agents/config`);
    expect(cfg.status).toBe(200);
    expect(j(cfg).roots.map((r: any) => r.rootId)).toContain(root.id);

    // ingest
    const runId = randomUUID();
    const batch = {
      rootId: root.id,
      runId,
      phase: 'START',
      observations: [
        {
          eventId: `${runId}:0`,
          seq: 0,
          kind: 'file',
          path: 'D:\\Media\\clip.mp4',
          size: content.length,
          mtimeMs: Date.now() - 600_000,
          fileId: 'f1',
          state: 'STABLE',
          stableObservations: 2,
          quickSignature: 'qs1',
        },
      ],
    };
    const ing = await signed('POST', `${V1}/agents/ingest`, JSON.stringify(batch));
    expect(ing.status).toBe(200);
    expect(j(ing).accepted).toBe(1);
    const dup = await signed('POST', `${V1}/agents/ingest`, JSON.stringify(batch));
    expect(j(dup).duplicates).toBe(1);

    // library shows it, and streaming proxies Range to the agent
    const lib = j(await api.call('GET', `${V1}/library?q=clip`, { cookie: owner }));
    expect(lib.items?.length ?? lib.length).toBe(1);
    const fileId = (lib.items ?? lib)[0].id;
    const full = await api.call('GET', `${V1}/files/${fileId}/stream`, { cookie: owner });
    expect(full.status).toBe(200);
    expect(full.raw.length).toBe(content.length);
    const part = await api.call('GET', `${V1}/files/${fileId}/stream`, {
      cookie: owner,
      headers: { range: 'bytes=10-19' },
    });
    expect(part.status).toBe(206);
    expect(part.raw.toString()).toBe('0123456789');
    expect((await api.call('GET', `${V1}/files/${fileId}/stream`)).status).toBe(401);
    const tok = j(await api.call('POST', `${V1}/files/${fileId}/stream-token`, { cookie: owner, body: {} }))
      .url as string;
    const viaToken = await api.call('GET', tok.replace('http://localhost:8080', ''));
    expect(viaToken.status).toBe(200);
    const badTok = await api.call('GET', `${V1}/files/${fileId}/stream?token=garbage`);
    expect(badTok.status).toBe(401);

    // offline device is "unavailable", never "missing"
    await fresh.handle.db.execute(
      (await import('@creatoros/db')).sql`update devices set state = 'OFFLINE' where id = ${dev.deviceId}`,
    );
    const off = await api.call('GET', `${V1}/files/${fileId}/stream`, { cookie: owner });
    expect(off.status).toBe(503);
    expect(off.body.error.code).toBe('DEVICE_OFFLINE');
    const libOff = j(await api.call('GET', `${V1}/library?q=clip`, { cookie: owner }));
    expect(JSON.stringify(libOff)).toContain('DEVICE_OFFLINE');
    expect(JSON.stringify(libOff)).not.toContain('CONFIRMED_MISSING');

    // revoked device is refused immediately
    await api.call('POST', `${V1}/devices/${dev.deviceId}/revoke`, { cookie: owner, body: {} });
    expect((await signed('GET', `${V1}/agents/config`)).status).toBe(401);
  });
});
