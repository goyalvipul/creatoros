import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, ts, updatedAt } from './columns';
import { connectionState, membershipStatus, platform, provider, userRole, userStatus } from './enums';

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull().default('OWNER'),
    timezone: text('timezone').notNull().default('America/Vancouver'),
    locale: text('locale').notNull().default('en-CA'),
    status: userStatus('status').notNull().default('ACTIVE'),
    totpSecretEnc: text('totp_secret_enc'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

export const organizations = pgTable('organizations', {
  id: pk(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
  baseCurrency: text('base_currency').notNull().default('CAD'),
  timezone: text('timezone').notNull().default('America/Vancouver'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  setupStep: text('setup_step').notNull().default('welcome'),
  setupCompletedAt: ts('setup_completed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** FK helper used by every owned table. */
export const orgRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRole('role').notNull().default('OWNER'),
    status: membershipStatus('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('memberships_org_user_uq').on(t.orgId, t.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const brands = pgTable(
  'brands',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    type: text('type').notNull().default('creator'),
    description: text('description'),
    contentPillars: text('content_pillars')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('brands_org_name_uq')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const channels = pgTable(
  'channels',
  {
    id: pk(),
    orgId: orgRef(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id),
    name: text('name').notNull(),
    purpose: text('purpose'),
    language: text('language').notNull().default('en'),
    goals: text('goals'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('channels_brand_idx').on(t.brandId)],
);

export const providerConnections = pgTable(
  'provider_connections',
  {
    id: pk(),
    orgId: orgRef(),
    provider: provider('provider').notNull(),
    label: text('label'),
    principalHint: text('principal_hint'),
    state: connectionState('state').notNull().default('NOT_CONFIGURED'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    encryptedTokenRef: text('encrypted_token_ref'),
    expiresAt: ts('expires_at'),
    lastSyncAt: ts('last_sync_at'),
    lastError: text('last_error'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('provider_connections_org_provider_idx').on(t.orgId, t.provider)],
);

export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: pk(),
    orgId: orgRef(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id),
    platform: platform('platform').notNull(),
    handle: text('handle').notNull(),
    externalAccountId: text('external_account_id'),
    profileUrl: text('profile_url'),
    accountType: text('account_type').notNull().default('creator'),
    verifiedLink: boolean('verified_link').notNull().default(false),
    capabilityFlags: jsonb('capability_flags').$type<Record<string, boolean>>().notNull().default({}),
    providerConnectionId: uuid('provider_connection_id').references(() => providerConnections.id, {
      onDelete: 'set null',
    }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('social_accounts_uq')
      .on(t.orgId, t.platform, sql`lower(${t.handle})`)
      .where(sql`${t.deletedAt} is null`),
    index('social_accounts_channel_idx').on(t.channelId),
  ],
);
