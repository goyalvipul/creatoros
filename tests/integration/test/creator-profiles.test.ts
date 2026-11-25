import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, makeApi, type Api } from '../src/helpers';

let fresh: Awaited<ReturnType<typeof freshDb>>;
let api: Api;
let cookie: string;
const path = '/api/v1/ai/profile';

beforeAll(async () => {
  fresh = await freshDb();
  api = await makeApi(fresh.handle, fresh.url);
  const result = await api.call('POST', '/api/v1/setup/bootstrap', {
    body: { email: 'profiles@test.local', password: 'violet harbor lantern quartz', name: 'Owner', orgName: 'Profiles', timezone: 'America/Vancouver', currency: 'CAD' },
  });
  expect(result.status).toBe(201);
  cookie = result.cookie!;
});

afterAll(async () => { await api?.close(); await fresh?.drop(); });

describe('creator profiles', () => {
  it('keeps creator identities separate and preserves fields during a partial update', async () => {
    const a = await api.call('POST', '/api/v1/brands', { cookie, body: { name: 'Creator A' } });
    const b = await api.call('POST', '/api/v1/brands', { cookie, body: { name: 'Creator B' } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const first = a.body.data.id;
    const second = b.body.data.id;
    expect((await api.call('PUT', path, { cookie, body: { brandId: first, name: 'A', voice: 'A voice', themes: 'A themes' } })).status).toBe(200);
    expect((await api.call('PUT', path, { cookie, body: { brandId: second, name: 'B', voice: 'B voice' } })).status).toBe(200);
    expect((await api.call('PUT', path, { cookie, body: { brandId: first, tone: 'Warm' } })).status).toBe(200);
    const profileA = await api.call('GET', path + '?brandId=' + first, { cookie });
    const profileB = await api.call('GET', path + '?brandId=' + second, { cookie });
    expect(profileA.body.data).toMatchObject({ name: 'A', voice: 'A voice', themes: 'A themes', tone: 'Warm' });
    expect(profileB.body.data).toMatchObject({ name: 'B', voice: 'B voice' });
    expect((await api.call('GET', path, { cookie })).body.data).toBeNull();
    expect((await api.call('PUT', path, { cookie, body: { brandId: first, referenceFileIds: [randomUUID()] } })).status).toBe(400);
    expect((await api.call('PUT', path, { cookie, body: { brandId: first, name: 'x'.repeat(121) } })).status).toBe(400);
    expect((await api.call('PUT', path, { cookie, body: { brandId: randomUUID(), name: 'Unknown' } })).status).toBe(404);
    expect((await api.call('PUT', path, { body: { brandId: first, name: 'Unauthorized' } })).status).toBe(401);
  });
});
