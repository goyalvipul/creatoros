import { describe, expect, it, afterAll } from 'vitest';
import * as OTPAuth from 'otpauth';
import { eq, organizations, sql, users } from '@creatoros/db';
import {
  authenticateSession,
  beginTotp,
  bootstrapOwner,
  changePassword,
  clearDemo,
  demoStatus,
  disableTotp,
  enableTotp,
  hashPassword,
  login,
  logout,
  seedDemo,
  validatePassword,
  requireRole,
} from '@creatoros/services';
import { makeOrg, openDb, testEnv } from './../src/helpers';

const h = openDb();
afterAll(() => h.close());
const env = testEnv();
const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;

async function makeUser(password = 'correct horse battery staple') {
  const org = await makeOrg(h, env);
  const hash = await hashPassword(password);
  await h.db.update(users).set({ passwordHash: hash }).where(eq(users.id, org.userId));
  const [u] = await h.db.select().from(users).where(eq(users.id, org.userId));
  return { ...org, email: u!.email, password };
}

describe('auth', () => {
  it('rejects weak passwords and accepts a passphrase', () => {
    expect(validatePassword('short').length).toBeGreaterThan(0);
    expect(validatePassword('password1').length).toBeGreaterThan(0);
    expect(validatePassword('correct horse battery staple', 'a@b.c')).toEqual([]);
  });

  it('logs in, authenticates by cookie token, logs out', async () => {
    const u = await makeUser();
    const res = await login(h.db, env, { email: u.email.toUpperCase(), password: u.password });
    const s = await authenticateSession(h.db, res.token);
    expect(s?.userId).toBe(u.userId);
    expect(s?.orgId).toBe(u.orgId);
    await logout(h.db, res.token);
    expect(await authenticateSession(h.db, res.token)).toBeNull();
  });

  it('does not reveal whether an e-mail exists and locks after repeated failures', async () => {
    const u = await makeUser();
    await expect(
      login(h.db, env, { email: 'nobody@test.local', password: 'whatever whatever' }),
    ).rejects.toMatchObject({ status: 401 });
    for (let i = 0; i < 5; i++)
      await expect(login(h.db, env, { email: u.email, password: 'wrong wrong wrong' })).rejects.toMatchObject(
        { status: 401 },
      );
    await expect(login(h.db, env, { email: u.email, password: u.password })).rejects.toMatchObject({
      status: 429,
      code: 'ACCOUNT_LOCKED',
    });
    // after the lock window the right password works again
    const later = new Date(Date.now() + 16 * 60_000);
    const ok = await login(h.db, env, { email: u.email, password: u.password }, later);
    expect(ok.token).toBeTruthy();
  });

  it('expired and revoked sessions are rejected', async () => {
    const u = await makeUser();
    const res = await login(h.db, env, { email: u.email, password: u.password });
    expect(await authenticateSession(h.db, res.token, new Date(Date.now() + 15 * 86400_000))).toBeNull();
    await h.db.execute(sql`update sessions set revoked_at = now() where user_id = ${u.userId}`);
    expect(await authenticateSession(h.db, res.token)).toBeNull();
  });

  it('TOTP is required once enabled and can be disabled with the password', async () => {
    const u = await makeUser();
    const { secret } = beginTotp(u.email);
    const code = () =>
      new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
    await expect(enableTotp(u.ctx, secret, '000000')).rejects.toMatchObject({ code: 'TOTP_INVALID' });
    await enableTotp(u.ctx, secret, code());
    await expect(login(h.db, env, { email: u.email, password: u.password })).rejects.toMatchObject({
      code: 'TOTP_REQUIRED',
    });
    const ok = await login(h.db, env, { email: u.email, password: u.password, totp: code() });
    expect(ok.token).toBeTruthy();
    await disableTotp(u.ctx, u.password);
    expect((await login(h.db, env, { email: u.email, password: u.password })).token).toBeTruthy();
  });

  it('changing the password signs other sessions out and enforces strength', async () => {
    const u = await makeUser();
    const a = await login(h.db, env, { email: u.email, password: u.password });
    const b = await login(h.db, env, { email: u.email, password: u.password });
    const sa = (await authenticateSession(h.db, a.token))!;
    await expect(changePassword(u.ctx, { current: u.password, next: 'short' })).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });
    await changePassword(u.ctx, {
      current: u.password,
      next: 'another long passphrase here',
      keepSessionId: sa.sessionId,
    });
    expect(await authenticateSession(h.db, a.token)).not.toBeNull();
    expect(await authenticateSession(h.db, b.token)).toBeNull();
  });

  it('roles are ordered', () => {
    expect(() => requireRole({ role: 'VIEWER' }, 'EDITOR')).toThrow();
    expect(() => requireRole({ role: 'EDITOR' }, 'EDITOR')).not.toThrow();
    expect(() => requireRole({ role: 'OWNER' }, 'OWNER')).not.toThrow();
  });
});

describe('bootstrap', () => {
  it('only the very first owner can be created (no default password)', async () => {
    // other tests already created users in this database, so bootstrap must refuse
    await expect(
      bootstrapOwner(h.db, { email: 'x@y.z', passwordHash: 'x', name: 'X', orgName: 'Y' }),
    ).rejects.toMatchObject({ code: 'ALREADY_INITIALIZED' });
  });
});

describe('demo data', () => {
  it('seeds labelled demo data, is not repeatable, and clears only itself', async () => {
    const o = await makeOrg(h, env);
    const other = await makeOrg(h, env);
    const before = rows<{ n: number }>(
      await h.db.execute(sql`select count(*)::int n from creative_projects where org_id = ${o.orgId}`),
    )[0]!.n;
    await seedDemo(o.ctx);
    expect((await demoStatus(o.ctx)).seeded).toBe(true);
    await expect(seedDemo(o.ctx)).rejects.toMatchObject({ code: 'DEMO_EXISTS' });
    const demoProjects = rows<{ n: number }>(
      await h.db.execute(
        sql`select count(*)::int n from creative_projects where org_id = ${o.orgId} and is_demo`,
      ),
    )[0]!.n;
    expect(demoProjects).toBeGreaterThanOrEqual(2);
    const manualState = rows<{ state: string }>(
      await h.db.execute(
        sql`select state::text as state from publication_records where org_id = ${o.orgId} and state::text like 'PUBLISHED%'`,
      ),
    );
    expect(manualState.every((r) => r.state === 'PUBLISHED_MANUAL')).toBe(true);
    // another organisation is untouched by clear
    await seedDemo(other.ctx);
    await clearDemo(o.ctx);
    expect((await demoStatus(o.ctx)).seeded).toBe(false);
    const left = rows<{ n: number }>(
      await h.db.execute(
        sql`select (select count(*) from creative_projects where org_id = ${o.orgId}) + (select count(*) from deals where org_id = ${o.orgId}) + (select count(*) from brands where org_id = ${o.orgId} and name like 'DEMO%') as n`,
      ),
    )[0]!.n;
    expect(Number(left)).toBe(before);
    expect((await demoStatus(other.ctx)).seeded).toBe(true);
    const otherProjects = rows<{ n: number }>(
      await h.db.execute(sql`select count(*)::int n from creative_projects where org_id = ${other.orgId}`),
    )[0]!.n;
    expect(otherProjects).toBeGreaterThanOrEqual(2);
    // and demo can be loaded again after clearing
    await seedDemo(o.ctx);
    await clearDemo(o.ctx);
    await clearDemo(other.ctx);
  });
});

void organizations;
