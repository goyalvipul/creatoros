import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { sql } from '@creatoros/db';
import { DIAGNOSTIC_RESULT, DIAGNOSTIC_SUBSCRIBE, dispatchMcpDiagnostics } from '@creatoros/services';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { freshDb, makeApi, makeOrg } from '../src/helpers';

const callbacks = vi.hoisted(() => ({ verify: vi.fn(), send: vi.fn() }));
vi.mock('../../../packages/services/src/mcp-event-webhook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../packages/services/src/mcp-event-webhook')>()),
  verifyMcpCallback: callbacks.verify,
  sendMcpWebhook: callbacks.send,
}));

const gateway = '/api/v1/ai-gateway/events/';
const admin = '/api/v1/integrations/ai-gateway';
const principal = 'test-site-owner';
const url = 'https://receiver.example.com/test';
const secret = 'whsec_' + Buffer.alloc(32, 42).toString('base64');
const siteKey = '4'.repeat(64);
const scopes = [DIAGNOSTIC_SUBSCRIBE, DIAGNOSTIC_RESULT];
let fresh: Awaited<ReturnType<typeof freshDb>>;
let api: Awaited<ReturnType<typeof makeApi>>;
let cookie: string;
let token: string;

beforeAll(async () => {
  fresh = await freshDb();
  api = await makeApi(fresh.handle, fresh.url, { KEMOKEM_MCP_EVENTS_KEY: siteKey });
  const owner = await api.call('POST', '/api/v1/setup/bootstrap', {
    body: {
      email: 'events@test.local',
      password: 'violet harbor lantern quartz',
      name: 'Diagnostic owner',
      orgName: 'MCP Events',
      timezone: 'America/Vancouver',
      currency: 'CAD',
    },
  });
  expect(owner.status).toBe(201);
  cookie = owner.cookie!;
  const credential = await api.call('POST', admin + '/credential', {
    cookie,
    body: { mode: 'hosted', action: 'rotate' },
  });
  token = credential.body.data.token;
});
afterAll(async () => {
  await api?.close();
  await fresh?.drop();
});
const sendSite = (
  action: string,
  body: object,
  nonce = randomUUID(),
  signingKey = siteKey,
  credential = token,
) => {
  const time = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', signingKey)
    .update([time, nonce, action, JSON.stringify(body)].join('.'))
    .digest('hex');
  return api.call('POST', gateway + action, {
    body,
    headers: {
      authorization: 'Bearer ' + credential,
      'x-kemokem-event-time': time,
      'x-kemokem-event-nonce': nonce,
      'x-kemokem-event-signature': signature,
    },
  });
};
const subscribe = (signingSecret = secret) =>
  sendSite('subscribe', { principal, url, secret: signingSecret });
const settings = (hostedScopes: string[]) =>
  api.call('POST', admin + '/settings', {
    cookie,
    body: { enabled: true, mode: 'hosted', hostedScopes },
  });
const ack = (requestId: string, sitePrincipal = principal) =>
  sendSite('result', { principal: sitePrincipal, requestId });

it('binds lifecycle and acknowledgement to the credential and principal with durable PostgreSQL state', async () => {
  await settings([]);
  expect((await subscribe()).status).toBe(403);
  await settings(scopes);
  const testBody = { principal, requestId: randomUUID() };
  expect((await sendSite('result', testBody, randomUUID(), '5'.repeat(64))).status).toBe(403);
  const nonce = randomUUID();
  expect((await sendSite('result', testBody, nonce)).status).toBe(404);
  expect((await sendSite('result', testBody, nonce)).status).toBe(409);
  callbacks.verify.mockRejectedValueOnce(new Error('unsafe_callback_address'));
  expect((await subscribe()).body.error.code).toBe('MCP_CALLBACK_UNVERIFIED');
  const registered = await subscribe();
  expect(registered.status).toBe(200);
  const subscriptionId = registered.body.data.id;
  expect((await subscribe()).body.data.id).toBe(subscriptionId);
  expect(callbacks.verify).toHaveBeenCalledTimes(2);
  expect((await subscribe('whsec_' + Buffer.alloc(32, 43).toString('base64'))).body.data.id).toBe(
    subscriptionId,
  );
  expect(callbacks.verify).toHaveBeenCalledTimes(3);
  const send = (requestId = randomUUID()) =>
    api.call('POST', admin + '/events/send', { cookie, body: { subscriptionId, requestId } });
  const queued = await send();
  expect((await send(queued.body.data.requestId)).body.data).toEqual(queued.body.data);
  expect(queued.status).toBe(200);
  const requestId = queued.body.data.requestId;
  expect((await ack(requestId)).status).toBe(404);
  callbacks.send
    .mockResolvedValueOnce({ status: 503, body: '' })
    .mockResolvedValueOnce({ status: 202, body: '' });
  await dispatchMcpDiagnostics(fresh.handle.db, api.config.env.encryptionKey);
  await fresh.handle.db.execute(
    sql`update mcp_diagnostic_requests set next_attempt_at = now() where id = ${requestId}`,
  );
  await dispatchMcpDiagnostics(fresh.handle.db, api.config.env.encryptionKey);
  expect(callbacks.send.mock.calls.map((call) => call[3])).toEqual([requestId, requestId]);
  const history = async () => (await api.call('GET', admin + '/events', { cookie })).body.data.history;
  expect((await history())[0]).toMatchObject({
    id: requestId,
    http_status: 202,
    completed_at: null,
    attempts: 2,
  });
  const other = await makeOrg(fresh.handle);
  const otherToken = 'kk_hosted_' + randomBytes(32).toString('hex');
  const otherHash = createHash('sha256').update(otherToken).digest('hex');
  await fresh.handle.db.execute(sql`
    insert into ai_gateway_connections(org_id, enabled, mode, hosted_hash, hosted_owner, hosted_scopes)
    values (${other.orgId}, true, 'hosted', ${otherHash}, ${other.userId},
      ARRAY[${DIAGNOSTIC_SUBSCRIBE}, ${DIAGNOSTIC_RESULT}]::text[])
  `);
  expect((await sendSite('result', { principal, requestId }, randomUUID(), siteKey, otherToken)).status).toBe(
    404,
  );
  expect((await ack(requestId, 'another-owner')).status).toBe(404);
  expect((await ack(randomUUID())).status).toBe(404);
  await fresh.handle.db.execute(
    sql`update mcp_diagnostic_subscriptions set expires_at = now() where id = ${subscriptionId}`,
  );
  expect((await send()).status).toBe(404);
  const results = await Promise.all([ack(requestId), ack(requestId)]);
  expect(results.map((result) => result.body.data)).toEqual([
    { requestId, completed: true },
    { requestId, completed: true },
  ]);
  const completed = await history();
  expect(completed).toHaveLength(1);
  expect(completed[0].completed_at).toBeTruthy();
  expect((await subscribe()).status).toBe(200);
  expect((await sendSite('unsubscribe', { principal, url })).status).toBe(200);
  expect((await send()).status).toBe(404);
  await settings([DIAGNOSTIC_SUBSCRIBE]);
  expect((await ack(requestId)).status).toBe(403);
});

it('persists a dispatch failure and prevents dispatch after gateway credential revocation', async () => {
  await settings(scopes);
  const subscribed = await subscribe();
  expect(subscribed.status).toBe(200);
  const subscriptionId = subscribed.body.data.id;
  const send = (requestId: string) =>
    api.call('POST', admin + '/events/send', {
      cookie,
      body: { subscriptionId, requestId },
    });
  const failedId = randomUUID();
  expect((await send(failedId)).status).toBe(200);
  callbacks.send.mockClear();
  callbacks.send.mockResolvedValue({ status: 503, body: '' });
  for (let i = 0; i < 4; i++) {
    await fresh.handle.db.execute(
      sql`update mcp_diagnostic_requests set next_attempt_at = now() where id = ${failedId}`,
    );
    await dispatchMcpDiagnostics(fresh.handle.db, api.config.env.encryptionKey);
  }
  expect(callbacks.send.mock.calls.map((call) => call[3])).toEqual(Array(4).fill(failedId));
  const afterFailure = await api.call('GET', admin + '/events', { cookie });
  expect(afterFailure.body.data.history.find((row: { id: string }) => row.id === failedId)).toMatchObject({
    delivered_at: null,
    completed_at: null,
    error_code: 'callback_http_error',
    http_status: 503,
    attempts: 4,
  });
  const revokedId = randomUUID();
  expect((await send(revokedId)).status).toBe(200);
  expect(
    (await api.call('POST', admin + '/credential', { cookie, body: { mode: 'hosted', action: 'revoke' } }))
      .status,
  ).toBe(200);
  await dispatchMcpDiagnostics(fresh.handle.db, api.config.env.encryptionKey);
  expect(callbacks.send).toHaveBeenCalledTimes(4);
  expect((await ack(revokedId)).status).toBe(401);
  const afterRevocation = await api.call('GET', admin + '/events', { cookie });
  expect(afterRevocation.body.data.history.find((row: { id: string }) => row.id === revokedId)).toMatchObject(
    {
      dispatched_at: null,
      completed_at: null,
      error_code: 'subscription_inactive',
      attempts: 0,
    },
  );
});
