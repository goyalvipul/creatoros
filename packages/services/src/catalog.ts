import { and, asc, brands, channels, eq, inArray, isNull, socialAccounts } from '@creatoros/db';
import { audit } from './audit';
import { badRequest, conflict, notFound, type Ctx } from './types';

type BrandInsert = typeof brands.$inferInsert;
type ChannelInsert = typeof channels.$inferInsert;
type AccountInsert = typeof socialAccounts.$inferInsert;

const isUnique = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (e as any)?.cause?.code === '23505';

export async function createBrand(
  ctx: Ctx,
  input: { name: string; type?: string; description?: string | null; contentPillars?: string[] },
) {
  const name = input.name?.trim();
  if (!name) throw badRequest('Brand name is required');
  try {
    const [b] = await ctx.db
      .insert(brands)
      .values({
        orgId: ctx.orgId,
        name,
        type: input.type ?? 'creator',
        description: input.description ?? null,
        contentPillars: input.contentPillars ?? [],
      })
      .returning();
    await audit(ctx, 'brand.create', { type: 'brand', id: b!.id });
    return b!;
  } catch (e) {
    if (isUnique(e)) throw conflict(`A brand named "${name}" already exists.`);
    throw e;
  }
}

export async function updateBrand(
  ctx: Ctx,
  id: string,
  patch: Partial<Pick<BrandInsert, 'name' | 'type' | 'description' | 'contentPillars' | 'active'>>,
) {
  const [b] = await ctx.db
    .update(brands)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(brands.id, id), eq(brands.orgId, ctx.orgId), isNull(brands.deletedAt)))
    .returning();
  if (!b) throw notFound('Brand');
  await audit(ctx, 'brand.update', { type: 'brand', id });
  return b;
}

/**
 * "Delete" a brand = archive it together with its channels and accounts. Nothing is erased: publications, ideas,
 * projects and deals that point at them keep their history, and a new brand may reuse the name afterwards.
 */
export async function archiveBrand(ctx: Ctx, id: string) {
  const now = new Date();
  await ctx.db.transaction(async (tx) => {
    const [b] = await tx
      .update(brands)
      .set({ deletedAt: now, active: false })
      .where(and(eq(brands.id, id), eq(brands.orgId, ctx.orgId), isNull(brands.deletedAt)))
      .returning({ id: brands.id });
    if (!b) throw notFound('Brand');
    const chans = await tx
      .update(channels)
      .set({ deletedAt: now, active: false })
      .where(and(eq(channels.brandId, id), eq(channels.orgId, ctx.orgId), isNull(channels.deletedAt)))
      .returning({ id: channels.id });
    if (chans.length)
      await tx
        .update(socialAccounts)
        .set({ deletedAt: now, active: false })
        .where(
          and(
            eq(socialAccounts.orgId, ctx.orgId),
            isNull(socialAccounts.deletedAt),
            inArray(
              socialAccounts.channelId,
              chans.map((c) => c.id),
            ),
          ),
        );
    await audit({ ...ctx, db: tx }, 'brand.archive', { type: 'brand', id }, undefined, {
      channels: chans.length,
    });
  });
}

/** Archive a channel and its accounts (history is kept; see archiveBrand). */
export async function archiveChannel(ctx: Ctx, id: string) {
  const now = new Date();
  await ctx.db.transaction(async (tx) => {
    const [c] = await tx
      .update(channels)
      .set({ deletedAt: now, active: false })
      .where(and(eq(channels.id, id), eq(channels.orgId, ctx.orgId), isNull(channels.deletedAt)))
      .returning({ id: channels.id });
    if (!c) throw notFound('Channel');
    await tx
      .update(socialAccounts)
      .set({ deletedAt: now, active: false })
      .where(
        and(
          eq(socialAccounts.channelId, id),
          eq(socialAccounts.orgId, ctx.orgId),
          isNull(socialAccounts.deletedAt),
        ),
      );
    await audit({ ...ctx, db: tx }, 'channel.archive', { type: 'channel', id });
  });
}

/** Archive a social account. Posts already recorded for it stay as evidence; it disappears from the matrix and pickers. */
export async function archiveSocialAccount(ctx: Ctx, id: string) {
  const [a] = await ctx.db
    .update(socialAccounts)
    .set({ deletedAt: new Date(), active: false })
    .where(
      and(eq(socialAccounts.id, id), eq(socialAccounts.orgId, ctx.orgId), isNull(socialAccounts.deletedAt)),
    )
    .returning({ id: socialAccounts.id });
  if (!a) throw notFound('Social account');
  await audit(ctx, 'social_account.archive', { type: 'social_account', id });
}
export async function createChannel(
  ctx: Ctx,
  input: { brandId: string; name: string; purpose?: string | null; language?: string; goals?: string | null },
) {
  if (!input.name?.trim()) throw badRequest('Channel name is required');
  const [b] = await ctx.db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, input.brandId), eq(brands.orgId, ctx.orgId), isNull(brands.deletedAt)));
  if (!b) throw notFound('Brand');
  const [c] = await ctx.db
    .insert(channels)
    .values({
      orgId: ctx.orgId,
      brandId: input.brandId,
      name: input.name.trim(),
      purpose: input.purpose ?? null,
      language: input.language ?? 'en',
      goals: input.goals ?? null,
    })
    .returning();
  await audit(ctx, 'channel.create', { type: 'channel', id: c!.id });
  return c!;
}

export async function updateChannel(
  ctx: Ctx,
  id: string,
  patch: Partial<Pick<ChannelInsert, 'name' | 'purpose' | 'language' | 'goals' | 'active'>>,
) {
  const [c] = await ctx.db
    .update(channels)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(channels.id, id), eq(channels.orgId, ctx.orgId), isNull(channels.deletedAt)))
    .returning();
  if (!c) throw notFound('Channel');
  await audit(ctx, 'channel.update', { type: 'channel', id });
  return c;
}

export async function createSocialAccount(
  ctx: Ctx,
  input: {
    channelId: string;
    platform: AccountInsert['platform'];
    handle: string;
    profileUrl?: string | null;
    externalAccountId?: string | null;
    accountType?: string;
  },
) {
  if (!input.handle?.trim()) throw badRequest('Handle is required');
  const [c] = await ctx.db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.id, input.channelId), eq(channels.orgId, ctx.orgId), isNull(channels.deletedAt)));
  if (!c) throw notFound('Channel');
  const [a] = await ctx.db
    .insert(socialAccounts)
    .values({
      orgId: ctx.orgId,
      channelId: input.channelId,
      platform: input.platform,
      handle: input.handle.trim(),
      profileUrl: input.profileUrl ?? null,
      externalAccountId: input.externalAccountId ?? null,
      accountType: input.accountType ?? 'creator',
    })
    .returning();
  await audit(ctx, 'social_account.create', { type: 'social_account', id: a!.id });
  return a!;
}

export async function updateSocialAccount(
  ctx: Ctx,
  id: string,
  patch: Partial<
    Pick<AccountInsert, 'handle' | 'profileUrl' | 'externalAccountId' | 'accountType' | 'active'>
  >,
) {
  const [a] = await ctx.db
    .update(socialAccounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(socialAccounts.id, id), eq(socialAccounts.orgId, ctx.orgId), isNull(socialAccounts.deletedAt)),
    )
    .returning();
  if (!a) throw notFound('Social account');
  await audit(ctx, 'social_account.update', { type: 'social_account', id });
  return a;
}

/** Brands → channels → accounts in one nested read (used by the Channels page, filters and the setup wizard). */
export async function listCatalog(ctx: Ctx) {
  const [bs, cs, as] = await Promise.all([
    ctx.db
      .select()
      .from(brands)
      .where(and(eq(brands.orgId, ctx.orgId), isNull(brands.deletedAt)))
      .orderBy(asc(brands.name)),
    ctx.db
      .select()
      .from(channels)
      .where(and(eq(channels.orgId, ctx.orgId), isNull(channels.deletedAt)))
      .orderBy(asc(channels.name)),
    ctx.db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.orgId, ctx.orgId), isNull(socialAccounts.deletedAt)))
      .orderBy(asc(socialAccounts.platform), asc(socialAccounts.handle)),
  ]);
  return bs.map((b) => ({
    ...b,
    channels: cs
      .filter((c) => c.brandId === b.id)
      .map((c) => ({ ...c, accounts: as.filter((a) => a.channelId === c.id) })),
  }));
}
