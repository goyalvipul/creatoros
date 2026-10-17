import argon2, { type HashOptions } from 'argon2';
import * as OTPAuth from 'otpauth';
import { and, eq, gt, isNull, organizationMemberships, sessions, sql, users, type Db } from '@creatoros/db';
import { audit } from './audit';
import { decrypt, encrypt, randomToken, sha256Hex } from './crypto';
import { AppError, badRequest, forbidden, unauthorized, type Ctx, type ServiceEnv } from './types';

const SESSION_TTL_MS = 14 * 86400_000;
const IDLE_TTL_MS = 7 * 86400_000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;

// OWASP-ish argon2id parameters; fast enough for a login form, expensive enough for offline cracking.
const ARGON: HashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => argon2.hash(pw, ARGON);
export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
}
// Used so that unknown emails cost the same time as a wrong password (no account enumeration by timing).
let dummyHash: Promise<string> | null = null;

const COMMON = new Set(['password', 'password1', '123456789012', 'qwertyuiop12', 'letmein12345', 'creatoros123', 'admin1234567', 'iloveyou1234']);

/** Passwords: at least 12 characters, not obviously common, not the e-mail address. No composition rules (they reduce entropy in practice). */
export function validatePassword(pw: string, email?: string): string[] {
  const errs: string[] = [];
  if (pw.length < 12) errs.push('Use at least 12 characters (a passphrase of several words works well).');
  if (pw.length > 256) errs.push('Password is too long.');
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) errs.push('That password is too common.');
  if (email && (low === email.toLowerCase() || low.includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4)) errs.push('Password must not contain your e-mail name.');
  return errs;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  orgId: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  email: string;
  name: string;
  timezone: string;
}

function totpFor(secretBase32: string, label: string) {
  return new OTPAuth.TOTP({ issuer: 'Creator OS', label, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretBase32) });
}

export async function login(db: Db, env: ServiceEnv, input: { email: string; password: string; totp?: string; ip?: string; userAgent?: string }, now = new Date()) {
  const email = input.email.trim().toLowerCase();
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!u) {
    dummyHash ??= hashPassword('dummy-password-for-timing');
    await verifyPassword(await dummyHash, input.password);
    throw unauthorized('Invalid e-mail or password.');
  }
  if (u.status !== 'ACTIVE') throw forbidden('This account is disabled.');
  if (u.lockedUntil && u.lockedUntil > now) {
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${Math.ceil((u.lockedUntil.getTime() - now.getTime()) / 60000)} minute(s).`);
  }
  const fail = async (why: string) => {
    const failed = u.failedLogins + 1;
    await db.update(users).set({ failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MS) : null }).where(eq(users.id, u.id));
    const m = await db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, u.id)).limit(1);
    if (m[0]) await audit({ db, orgId: m[0].orgId, actor: { type: 'system' }, userId: null, ip: input.ip }, 'auth.login.failed', { type: 'user', id: u.id }, undefined, { why });
    throw unauthorized('Invalid e-mail or password.');
  };
  if (!(await verifyPassword(u.passwordHash, input.password))) return fail('password');
  if (u.totpSecretEnc) {
    if (!input.totp) throw new AppError(401, 'TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app.');
    const secret = decrypt(u.totpSecretEnc, env.encryptionKey);
    if (totpFor(secret, u.email).validate({ token: input.totp.replace(/\s/g, ''), window: 1 }) === null) return fail('totp');
  }
  const mem = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.userId, u.id), eq(organizationMemberships.status, 'ACTIVE'))).limit(1);
  if (!mem[0]) throw forbidden('No active organization membership.');
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const [s] = await db.insert(sessions).values({ userId: u.id, orgId: mem[0].orgId, tokenHash: sha256Hex(token), ip: input.ip ?? null, userAgent: input.userAgent?.slice(0, 300) ?? null, expiresAt }).returning({ id: sessions.id });
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, u.id));
  // opportunistic rehash if parameters changed
  if (argon2.needsRehash(u.passwordHash, ARGON)) await db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, u.id));
  await audit({ db, orgId: mem[0].orgId, actor: { type: 'user', id: u.id }, userId: u.id, ip: input.ip }, 'auth.login', { type: 'session', id: s!.id });
  return { token, expiresAt, user: { id: u.id, email: u.email, name: u.name, role: mem[0].role, orgId: mem[0].orgId, timezone: u.timezone } };
}

export async function authenticateSession(db: Db, token: string | undefined, now = new Date()): Promise<SessionInfo | null> {
  if (!token) return null;
  const [r] = await db
    .select({ s: sessions, u: users, role: organizationMemberships.role, mstatus: organizationMemberships.status })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizationMemberships, and(eq(organizationMemberships.userId, users.id), eq(organizationMemberships.orgId, sessions.orgId)))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
  if (!r || r.u.status !== 'ACTIVE' || r.mstatus !== 'ACTIVE' || !r.s.orgId) return null;
  if (now.getTime() - r.s.lastSeenAt.getTime() > IDLE_TTL_MS) return null;
  if (now.getTime() - r.s.lastSeenAt.getTime() > 60_000) await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, r.s.id));
  return { sessionId: r.s.id, userId: r.u.id, orgId: r.s.orgId, role: r.role, email: r.u.email, name: r.u.name, timezone: r.u.timezone };
}

export async function logout(db: Db, token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256Hex(token)));
}

export async function listSessions(ctx: Ctx) {
  return db_sessions(ctx);
}
async function db_sessions(ctx: Ctx) {
  return ctx.db.select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt }).from(sessions).where(and(eq(sessions.userId, ctx.userId!), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
}

export async function revokeSession(ctx: Ctx, id: string) {
  await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, id), eq(sessions.userId, ctx.userId!)));
  await audit(ctx, 'auth.session.revoke', { type: 'session', id });
}

export async function changePassword(ctx: Ctx, input: { current: string; next: string; keepSessionId?: string }) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, ctx.userId!));
  if (!u || !(await verifyPassword(u.passwordHash, input.current))) throw unauthorized('Current password is incorrect.');
  const errs = validatePassword(input.next, u.email);
  if (errs.length) throw badRequest(errs[0]!, { errors: errs }, 'WEAK_PASSWORD');
  await ctx.db.update(users).set({ passwordHash: await hashPassword(input.next), updatedAt: new Date() }).where(eq(users.id, u.id));
  // every other session is signed out
  await ctx.db.execute(sql`update sessions set revoked_at = now() where user_id = ${u.id} and revoked_at is null and id is distinct from ${input.keepSessionId ?? null}::uuid`);
  await audit(ctx, 'auth.password.change', { type: 'user', id: u.id });
}

export function beginTotp(email: string) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, uri: totpFor(secret, email).toString() };
}

export async function enableTotp(ctx: Ctx, secret: string, code: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, ctx.userId!));
  if (!u) throw unauthorized();
  if (totpFor(secret, u.email).validate({ token: code.replace(/\s/g, ''), window: 1 }) === null) throw badRequest('That code is not valid. Check your authenticator app clock and try again.', undefined, 'TOTP_INVALID');
  await ctx.db.update(users).set({ totpSecretEnc: encrypt(secret, ctx.env.encryptionKey) }).where(eq(users.id, u.id));
  await audit(ctx, 'auth.totp.enable', { type: 'user', id: u.id });
}

export async function disableTotp(ctx: Ctx, password: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, ctx.userId!));
  if (!u || !(await verifyPassword(u.passwordHash, password))) throw unauthorized('Password is incorrect.');
  await ctx.db.update(users).set({ totpSecretEnc: null }).where(eq(users.id, u.id));
  await audit(ctx, 'auth.totp.disable', { type: 'user', id: u.id });
}

const RANK = { VIEWER: 0, EDITOR: 1, OWNER: 2 } as const;
/** Throws unless the session's role is at least `min`. */
export function requireRole(session: Pick<SessionInfo, 'role'>, min: keyof typeof RANK) {
  if (RANK[session.role] < RANK[min]) throw forbidden(`This action needs the ${min.toLowerCase()} role.`);
}
