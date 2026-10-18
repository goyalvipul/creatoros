import { and, brands, channels, eq, providerConnections, socialAccounts, sql, type Db } from '@creatoros/db';
import { audit } from './audit';
import { badRequest, conflict, notFound, type Ctx } from './types';

type Conn = typeof providerConnections.$inferSelect;
type Acct = typeof socialAccounts.$inferSelect;

/** Providers whose connections must map to exactly one Channels > social account to import posts. */
const PLATFORM_OF: Record<string, 'instagram' | 'facebook' | 'youtube' | 'tiktok'> = {
  instagram: 'instagram',
  facebook: 'facebook',
  meta: 'instagram',
  youtube: 'youtube',
  tiktok: 'tiktok',
};

export const needsAccountLink = (provider: string) => provider in PLATFORM_OF;

/**
 * The verified identity of a connection. Only Instagram gives us a platform account id that matches
 * `social_accounts.external_account_id`; other providers have no verified id, so they can only be linked by confirmation.
 */
export function connectionIdentity(conn: Conn) {
  const platform = PLATFORM_OF[conn.provider];
  if (!platform) return null;
  const cfg = (conn.config ?? {}) as Record<string, any>;
  const verifiedId =
    conn.provider === 'instagram' || conn.provider === 'facebook' ? (conn.principalHint ?? null) : null;
  const username = typeof cfg.username === 'string' && cfg.username ? cfg.username : null;
  return { platform, verifiedId, username };
}

const handleOf = (u: string) => `@${u.replace(/^@/, '')}`;
const norm = (h: string) => h.replace(/^@/, '').toLowerCase();

export type CandidateMatch = 'VERIFIED_ID' | 'USERNAME_ONLY' | 'UNVERIFIED';
export interface LinkCandidate {
  id: string;
  handle: string;
  channel: string | null;
  brand: string | null;
  linkedToThis: boolean;
  match: CandidateMatch;
}

async function liveAccounts(db: Db, orgId: string, platform: string) {
  return db
    .select({ a: socialAccounts, channel: channels.name, brand: brands.name })
    .from(socialAccounts)
    .innerJoin(channels, eq(channels.id, socialAccounts.channelId))
    .leftJoin(brands, eq(brands.id, channels.brandId))
    .where(
      and(
        eq(socialAccounts.orgId, orgId),
        eq(socialAccounts.platform, platform as never),
        sql`${socialAccounts.deletedAt} is null`,
      ),
    );
}

/**
 * Read-only: how does this connection relate to the Channels records?
 *  LINKED: a live social account already points at the connection.
 *  NEEDS_CONFIRMATION: candidates exist but none is proven (username match or unverified) - the owner must choose.
 *  NO_ACCOUNT: nothing suitable exists - offer to create one under an existing channel.
 */
export async function inspectIdentity(ctx: { db: Db; orgId: string }, conn: Conn) {
  const id = connectionIdentity(conn);
  if (!id) return null;
  const rows = await liveAccounts(ctx.db, conn.orgId, id.platform);
  const linked = rows.find((r) => r.a.providerConnectionId === conn.id);
  const toCandidate = (r: (typeof rows)[number]): LinkCandidate => ({
    id: r.a.id,
    handle: r.a.handle,
    channel: r.channel,
    brand: r.brand,
    linkedToThis: r.a.providerConnectionId === conn.id,
    match:
      id.verifiedId && r.a.externalAccountId === id.verifiedId
        ? 'VERIFIED_ID'
        : id.username && norm(r.a.handle) === norm(id.username)
          ? 'USERNAME_ONLY'
          : 'UNVERIFIED',
  });
  if (linked)
    return { status: 'LINKED' as const, platform: id.platform, linked: toCandidate(linked), candidates: [] };
  // accounts already bound to some other live connection are not offered
  const free = rows.filter((r) => !r.a.providerConnectionId);
  const candidates = free.map(toCandidate).sort((a, b) => rank(a.match) - rank(b.match));
  return {
    status: candidates.length ? ('NEEDS_CONFIRMATION' as const) : ('NO_ACCOUNT' as const),
    platform: id.platform,
    linked: null,
    candidates,
  };
}
const rank = (m: CandidateMatch) => (m === 'VERIFIED_ID' ? 0 : m === 'USERNAME_ONLY' ? 1 : 2);

async function loadConn(db: Db, orgId: string, id: string) {
  const [c] = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, id), eq(providerConnections.orgId, orgId)));
  if (!c) throw notFound('Connection');
  return c;
}

/** Applies the link. Every guard lives here so no caller can create a wrong or duplicate mapping. */
async function applyLink(ctx: Ctx, conn: Conn, acct: Acct, how: 'AUTO_VERIFIED_ID' | 'OWNER_CONFIRMED') {
  const id = connectionIdentity(conn);
  if (!id) throw badRequest('This provider does not map to a channel account.');
  if (acct.orgId !== conn.orgId || acct.platform !== id.platform || acct.deletedAt)
    throw badRequest(`That account is not an active ${id.platform} account in this workspace.`);
  if (acct.providerConnectionId && acct.providerConnectionId !== conn.id)
    throw conflict('That account is already linked to another connection.', undefined, 'ALREADY_LINKED');
  if (id.verifiedId && acct.externalAccountId && acct.externalAccountId !== id.verifiedId)
    throw conflict(
      'That account is bound to a different platform account id. It cannot be linked to this connection.',
      undefined,
      'IDENTITY_MISMATCH',
    );
  const rows = await liveAccounts(ctx.db, conn.orgId, id.platform);
  const other = rows.find((r) => r.a.providerConnectionId === conn.id && r.a.id !== acct.id);
  if (other)
    throw conflict(
      `This connection is already linked to ${other.a.handle}. Unlink it first.`,
      undefined,
      'CONNECTION_ALREADY_LINKED',
    );
  const [u] = await ctx.db
    .update(socialAccounts)
    .set({
      providerConnectionId: conn.id,
      externalAccountId: id.verifiedId ?? acct.externalAccountId,
      verifiedLink: Boolean(id.verifiedId),
      profileUrl:
        acct.profileUrl ??
        (id.username && id.platform === 'instagram' ? `https://www.instagram.com/${id.username}/` : null),
      capabilityFlags: { ...(acct.capabilityFlags ?? {}), oauthConnected: true },
      updatedAt: new Date(),
    })
    .where(eq(socialAccounts.id, acct.id))
    .returning();
  await audit(ctx, 'social_account.linked', { type: 'social_account', id: acct.id }, undefined, {
    connectionId: conn.id,
    provider: conn.provider,
    how,
    verifiedId: Boolean(id.verifiedId),
  });
  // the "no linked account" warning described a missing link, not a failed connection
  if (conn.state === 'PARTIAL_SYNC' && /no social account is linked/i.test(conn.lastError ?? ''))
    await ctx.db
      .update(providerConnections)
      .set({ state: 'ACTIVE', lastError: null, updatedAt: new Date() })
      .where(eq(providerConnections.id, conn.id));
  return u!;
}

/** Automatic path: links ONLY when exactly one live account carries the verified provider id. A username is never enough. */
export async function autoReconcileConnection(ctx: Ctx, connectionId: string) {
  const conn = await loadConn(ctx.db, ctx.orgId, connectionId);
  const id = connectionIdentity(conn);
  if (!id) return null;
  const current = await inspectIdentity(ctx, conn);
  if (current?.status === 'LINKED') return current;
  if (id.verifiedId) {
    const rows = await liveAccounts(ctx.db, conn.orgId, id.platform);
    const matches = rows.filter((r) => r.a.externalAccountId === id.verifiedId && !r.a.providerConnectionId);
    if (matches.length === 1) await applyLink(ctx, conn, matches[0]!.a, 'AUTO_VERIFIED_ID');
  }
  return inspectIdentity(ctx, conn);
}

/** Owner-confirmed link of a manual account to this connection (the one-time confirmation). */
export async function confirmAccountLink(ctx: Ctx, connectionId: string, socialAccountId: string) {
  const conn = await loadConn(ctx.db, ctx.orgId, connectionId);
  const [acct] = await ctx.db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, socialAccountId), eq(socialAccounts.orgId, ctx.orgId)));
  if (!acct) throw notFound('Social account');
  await applyLink(ctx, conn, acct, 'OWNER_CONFIRMED');
  return inspectIdentity(ctx, conn);
}

/** Creates a new social account under an EXISTING channel (never a new brand or channel) and links it. */
export async function createAndLinkAccount(ctx: Ctx, connectionId: string, channelId: string) {
  const conn = await loadConn(ctx.db, ctx.orgId, connectionId);
  const id = connectionIdentity(conn);
  if (!id || !id.username) throw badRequest('The connection has no username to create an account from.');
  const [ch] = await ctx.db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.orgId, ctx.orgId)));
  if (!ch) throw notFound('Channel');
  const rows = await liveAccounts(ctx.db, conn.orgId, id.platform);
  const same = rows.find((r) => norm(r.a.handle) === norm(id.username!));
  if (same)
    throw conflict(
      `${same.a.handle} already exists under ${same.channel ?? 'a channel'}. Link that account instead of creating a duplicate.`,
      undefined,
      'DUPLICATE_ACCOUNT',
    );
  const [a] = await ctx.db
    .insert(socialAccounts)
    .values({
      orgId: ctx.orgId,
      channelId,
      platform: id.platform,
      handle: handleOf(id.username),
      externalAccountId: id.verifiedId,
      verifiedLink: false,
      accountType: 'creator',
    })
    .returning();
  await applyLink(ctx, conn, a!, 'OWNER_CONFIRMED');
  return inspectIdentity(ctx, conn);
}

export async function unlinkAccount(ctx: Ctx, socialAccountId: string) {
  const [a] = await ctx.db
    .update(socialAccounts)
    .set({ providerConnectionId: null, verifiedLink: false, updatedAt: new Date() })
    .where(and(eq(socialAccounts.id, socialAccountId), eq(socialAccounts.orgId, ctx.orgId)))
    .returning();
  if (!a) throw notFound('Social account');
  await audit(ctx, 'social_account.unlinked', { type: 'social_account', id: a.id });
  return a;
}

/** Channels the owner can attach a new account to, so "create" never invents a brand or channel. */
export async function listChannelsForLinking(ctx: Ctx) {
  return ctx.db
    .select({ id: channels.id, name: channels.name, brand: brands.name })
    .from(channels)
    .leftJoin(brands, eq(brands.id, channels.brandId))
    .where(and(eq(channels.orgId, ctx.orgId), sql`${channels.deletedAt} is null`));
}

export async function getConnectionIdentity(ctx: Ctx, connectionId: string) {
  const conn = await loadConn(ctx.db, ctx.orgId, connectionId);
  return { identity: await inspectIdentity(ctx, conn), channels: await listChannelsForLinking(ctx) };
}
