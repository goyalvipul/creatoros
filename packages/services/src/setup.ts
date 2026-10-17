import {
  and,
  count,
  eq,
  followUpRules,
  notificationPreferences,
  organizationMemberships,
  organizations,
  projectChecklistTemplates,
  sql,
  users,
  type Db,
  type Executor,
} from '@creatoros/db';
import { BUILT_IN_TEMPLATES, DEFAULT_FOLLOW_UP_RULES, DEFAULT_TIMEZONE, isValidTimeZone } from '@creatoros/domain';
import { audit } from './audit';
import { badRequest, conflict, type Ctx } from './types';

export async function isInitialized(db: Db): Promise<boolean> {
  const [r] = await db.select({ n: count() }).from(users);
  return (r?.n ?? 0) > 0;
}

export interface BootstrapInput {
  email: string;
  passwordHash: string;
  name: string;
  orgName: string;
  timezone?: string;
  currency?: string;
}

/** Org-level defaults every organization needs: follow-up rules, built-in templates, notification preferences. */
export async function seedOrgDefaults(tx: Executor, orgId: string, userId: string, timezone: string): Promise<void> {
  await tx
    .insert(followUpRules)
    .values(
      DEFAULT_FOLLOW_UP_RULES.map((r) => ({
        orgId,
        key: r.key,
        label: r.label,
        durationHours: 'hours' in r ? r.hours : 'days' in r && typeof r.days === 'number' ? r.days * 24 : null,
        condition: 'days' in r && Array.isArray(r.days) ? { days: r.days } : {},
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(projectChecklistTemplates)
    .values(
      BUILT_IN_TEMPLATES.map((t) => ({
        orgId,
        key: t.key,
        name: t.name,
        contentType: t.contentType as any,
        items: t.items,
        variants: t.variants,
        builtIn: true,
      })),
    )
    .onConflictDoNothing();
  await tx.insert(notificationPreferences).values({ orgId, userId, timezone }).onConflictDoNothing();
}

/**
 * First-run only. Refuses once any user exists, so the setup endpoint can never be used to take over an install.
 * There is NO default password: the owner chooses one in the wizard.
 */
export async function bootstrapOwner(db: Db, input: BootstrapInput): Promise<{ userId: string; orgId: string }> {
  const tz = input.timezone ?? DEFAULT_TIMEZONE;
  if (!isValidTimeZone(tz)) throw badRequest(`Unknown time zone: ${tz}`);
  return db.transaction(async (tx) => {
    // serialise concurrent first-run attempts
    await tx.execute(sql`select pg_advisory_xact_lock(7340321)`);
    const [n] = await tx.select({ n: count() }).from(users);
    if ((n?.n ?? 0) > 0) throw conflict('This installation is already set up. Sign in instead.', undefined, 'ALREADY_INITIALIZED');
    const [user] = await tx
      .insert(users)
      .values({ email: input.email.trim(), passwordHash: input.passwordHash, name: input.name, role: 'OWNER', timezone: tz })
      .returning({ id: users.id });
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.orgName, ownerUserId: user.id, baseCurrency: input.currency ?? 'CAD', timezone: tz, setupStep: 'welcome' })
      .returning({ id: organizations.id });
    await tx.insert(organizationMemberships).values({ orgId: org.id, userId: user.id, role: 'OWNER' });
    await seedOrgDefaults(tx, org.id, user.id, tz);
    await audit({ db: tx, orgId: org.id, actor: { type: 'user', id: user.id }, userId: user.id }, 'setup.bootstrap', { type: 'organization', id: org.id });
    return { userId: user.id, orgId: org.id };
  });
}

export const SETUP_STEPS = ['welcome', 'organization', 'brands', 'devices', 'roots', 'first_scan', 'integrations', 'done'] as const;

export async function getSetupState(ctx: Ctx) {
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org) throw badRequest('Organization missing');
  return { step: org.setupStep, completedAt: org.setupCompletedAt, steps: SETUP_STEPS };
}

export async function setSetupStep(ctx: Ctx, step: string, complete = false) {
  if (!SETUP_STEPS.includes(step as any)) throw badRequest(`Unknown setup step ${step}`);
  await ctx.db
    .update(organizations)
    .set({ setupStep: step, ...(complete ? { setupCompletedAt: ctx.now() } : {}) })
    .where(eq(organizations.id, ctx.orgId));
  return getSetupState(ctx);
}

export async function getMembership(db: Db, userId: string) {
  const [m] = await db
    .select()
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, 'ACTIVE')))
    .limit(1);
  return m ?? null;
}
