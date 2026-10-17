import {
  and,
  asc,
  auditEvents,
  contacts,
  desc,
  eq,
  externalOrganizations,
  followUpRules,
  isNull,
  organizationMemberships,
  organizations,
  sql,
  users,
} from '@creatoros/db';
import { isValidTimeZone } from '@creatoros/domain';
import { audit } from './audit';
import { hashPassword, validatePassword } from './auth';
import { badRequest, conflict, notFound, type Ctx } from './types';

const rowsOf = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;

/** Org settings keys the owner can change from the UI. Anything else is rejected rather than silently stored. */
export const ORG_SETTING_KEYS = {
  missingGraceHours: { min: 1, max: 720 },
  replySlaHours: { min: 1, max: 720 },
  dueSoonDays: { min: 1, max: 30 },
} as const;

export async function getOrganization(ctx: Ctx) {
  const [o] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!o) throw notFound('Organization');
  const { settings, ...rest } = o;
  const { demo: _demo, ...visible } = (settings ?? {}) as Record<string, unknown>;
  return { ...rest, settings: visible, demoLoaded: Boolean((settings as any)?.demo) };
}

export async function updateOrganization(
  ctx: Ctx,
  patch: { name?: string; timezone?: string; baseCurrency?: string; settings?: Record<string, number> },
) {
  if (patch.timezone && !isValidTimeZone(patch.timezone))
    throw badRequest(`Unknown time zone: ${patch.timezone}`);
  if (patch.baseCurrency && !/^[A-Z]{3}$/.test(patch.baseCurrency))
    throw badRequest('Currency must be a 3-letter ISO code such as CAD');
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name?.trim()) set.name = patch.name.trim();
  if (patch.timezone) set.timezone = patch.timezone;
  if (patch.baseCurrency) set.baseCurrency = patch.baseCurrency;
  if (patch.settings) {
    for (const [k, v] of Object.entries(patch.settings)) {
      const spec = (ORG_SETTING_KEYS as any)[k];
      if (!spec) throw badRequest(`Unknown setting "${k}"`);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < spec.min || v > spec.max)
        throw badRequest(`${k} must be between ${spec.min} and ${spec.max}`);
    }
    set.settings = sql`settings || ${JSON.stringify(patch.settings)}::jsonb`;
  }
  await ctx.db.update(organizations).set(set).where(eq(organizations.id, ctx.orgId));
  if (patch.timezone)
    await ctx.db.execute(sql`update users set timezone = ${patch.timezone} where id = ${ctx.userId}`);
  await audit(
    ctx,
    'organization.update',
    { type: 'organization', id: ctx.orgId },
    undefined,
    patch as Record<string, unknown>,
  );
  return getOrganization(ctx);
}

// ------------------------------------------------------------------ members

export async function listMembers(ctx: Ctx) {
  return ctx.db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: organizationMemberships.role,
      status: organizationMemberships.status,
      lastLoginAt: users.lastLoginAt,
      totp: sql<boolean>`${users.totpSecretEnc} is not null`,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(eq(organizationMemberships.orgId, ctx.orgId))
    .orderBy(asc(users.name));
}

async function activeOwners(ctx: Ctx) {
  const r = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.orgId, ctx.orgId),
        eq(organizationMemberships.role, 'OWNER'),
        eq(organizationMemberships.status, 'ACTIVE'),
      ),
    );
  return r[0]!.n;
}

export async function createMember(
  ctx: Ctx,
  input: { email: string; name: string; role: 'OWNER' | 'EDITOR' | 'VIEWER'; password: string },
) {
  const errs = validatePassword(input.password, input.email);
  if (errs.length) throw badRequest(errs[0]!, { errors: errs }, 'WEAK_PASSWORD');
  const email = input.email.trim();
  const dupe = await ctx.db.execute(sql`select 1 from users where lower(email) = lower(${email})`);
  if (rowsOf(dupe).length) throw conflict('A user with that e-mail already exists.');
  return ctx.db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        email,
        name: input.name.trim(),
        passwordHash: await hashPassword(input.password),
        role: input.role,
      })
      .returning({ id: users.id });
    await tx.insert(organizationMemberships).values({ orgId: ctx.orgId, userId: u!.id, role: input.role });
    await audit({ ...ctx, db: tx }, 'member.create', { type: 'user', id: u!.id }, undefined, {
      role: input.role,
    });
    return { id: u!.id, email, name: input.name.trim(), role: input.role };
  });
}

export async function updateMember(
  ctx: Ctx,
  userId: string,
  patch: { role?: 'OWNER' | 'EDITOR' | 'VIEWER'; status?: 'ACTIVE' | 'DISABLED' },
) {
  const [m] = await ctx.db
    .select()
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.orgId, ctx.orgId), eq(organizationMemberships.userId, userId)));
  if (!m) throw notFound('Member');
  const demoting =
    m.role === 'OWNER' &&
    m.status === 'ACTIVE' &&
    ((patch.role && patch.role !== 'OWNER') || patch.status === 'DISABLED');
  if (demoting && (await activeOwners(ctx)) <= 1)
    throw conflict('There must always be at least one active owner.', undefined, 'LAST_OWNER');
  await ctx.db
    .update(organizationMemberships)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(organizationMemberships.id, m.id));
  if (patch.status) await ctx.db.update(users).set({ status: patch.status }).where(eq(users.id, userId));
  if (patch.status === 'DISABLED' || (patch.role && patch.role !== m.role))
    await ctx.db.execute(
      sql`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`,
    );
  await audit(
    ctx,
    'member.update',
    { type: 'user', id: userId },
    { role: m.role, status: m.status },
    patch as Record<string, unknown>,
  );
}

// ------------------------------------------------------------ follow-up rules

export async function listFollowUpRules(ctx: Ctx) {
  return ctx.db
    .select()
    .from(followUpRules)
    .where(eq(followUpRules.orgId, ctx.orgId))
    .orderBy(asc(followUpRules.key));
}

export async function updateFollowUpRule(
  ctx: Ctx,
  key: string,
  patch: { enabled?: boolean; notify?: boolean; durationHours?: number | null },
) {
  if (
    patch.durationHours != null &&
    (!Number.isInteger(patch.durationHours) || patch.durationHours < 1 || patch.durationHours > 24 * 365)
  )
    throw badRequest('Duration must be 1 hour to 1 year');
  const [r] = await ctx.db
    .update(followUpRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(followUpRules.orgId, ctx.orgId), eq(followUpRules.key, key)))
    .returning();
  if (!r) throw notFound('Rule');
  await audit(
    ctx,
    'follow_up_rule.update',
    { type: 'follow_up_rule', id: r.id },
    undefined,
    patch as Record<string, unknown>,
  );
  return r;
}

// ------------------------------------------------------------------- audit

export async function listAudit(
  ctx: Ctx,
  q: { objectType?: string; objectId?: string; action?: string; limit?: number } = {},
) {
  const where = [eq(auditEvents.orgId, ctx.orgId)];
  if (q.objectType) where.push(eq(auditEvents.objectType, q.objectType));
  if (q.objectId) where.push(eq(auditEvents.objectId, q.objectId));
  if (q.action) where.push(sql`${auditEvents.action} like ${q.action + '%'}`);
  return ctx.db
    .select()
    .from(auditEvents)
    .where(and(...where))
    .orderBy(desc(auditEvents.at))
    .limit(Math.min(q.limit ?? 100, 500));
}

// ------------------------------------------------------- CRM address book

export async function listExternalOrganizations(ctx: Ctx, q: { q?: string; limit?: number } = {}) {
  const like = q.q ? `%${q.q}%` : null;
  return rowsOf<any>(
    await ctx.db.execute(sql`
      select o.*, (select count(*)::int from deals d where d.external_org_id = o.id and d.deleted_at is null) as "dealCount",
             (select count(*)::int from contacts c where c.external_org_id = o.id) as "contactCount"
      from external_organizations o where o.org_id = ${ctx.orgId} ${like ? sql`and o.name ilike ${like}` : sql``}
      order by o.name limit ${Math.min(q.limit ?? 100, 500)}`),
  );
}

export async function listContacts(ctx: Ctx, q: { q?: string; externalOrgId?: string; limit?: number } = {}) {
  const where = [eq(contacts.orgId, ctx.orgId)];
  if (q.externalOrgId) where.push(eq(contacts.externalOrgId, q.externalOrgId));
  if (q.q)
    where.push(
      sql`(${contacts.name} ilike ${'%' + q.q + '%'} or array_to_string(${contacts.emails}, ' ') ilike ${'%' + q.q + '%'})`,
    );
  return ctx.db
    .select()
    .from(contacts)
    .where(and(...where))
    .orderBy(asc(contacts.name))
    .limit(Math.min(q.limit ?? 100, 500));
}

export async function updateExternalOrganization(
  ctx: Ctx,
  id: string,
  patch: { name?: string; notes?: string | null },
) {
  const [o] = await ctx.db
    .update(externalOrganizations)
    .set({ ...patch, updatedAt: new Date() } as any)
    .where(and(eq(externalOrganizations.id, id), eq(externalOrganizations.orgId, ctx.orgId)))
    .returning();
  if (!o) throw notFound('Organization');
  return o;
}

void isNull;
