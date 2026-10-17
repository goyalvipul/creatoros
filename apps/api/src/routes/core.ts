import { z } from 'zod';
import { count, sql, users } from '@creatoros/db';
import {
  badRequest,
  beginTotp,
  bootstrapOwner,
  changePassword,
  clearDemo,
  createMember,
  demoStatus,
  disableTotp,
  enableTotp,
  getOrganization,
  getSetupState,
  hashPassword,
  listAudit,
  listFollowUpRules,
  listMembers,
  listSessions,
  login,
  logout,
  revokeSession,
  seedDemo,
  setSetupStep,
  systemHealth,
  updateFollowUpRule,
  resetMemberPassword,
  updateMember,
  updateOrganization,
  validatePassword,
  lastHeartbeat,
  audit,
} from '@creatoros/services';
import { SESSION_COOKIE, idParam, makeRouter, type AppDeps } from '../http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

function setSessionCookie(reply: FastifyReply, req: FastifyRequest, token: string, expires: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: req.protocol === 'https',
    expires,
  });
}

export function coreRoutes(app: FastifyInstance, deps: AppDeps) {
  const route = makeRouter(app, deps);
  const { db, config } = deps;

  // ------------------------------------------------------------ health
  route(
    { method: 'GET', url: '/health/live', tag: 'System', summary: 'Liveness probe', role: 'public' },
    async () => ({ status: 'ok' }),
  );
  route(
    {
      method: 'GET',
      url: '/health/ready',
      tag: 'System',
      summary: 'Readiness probe (database reachable)',
      role: 'public',
    },
    async ({ reply }) => {
      try {
        await db.execute(sql`select 1`);
        return { status: 'ready' };
      } catch {
        reply.status(503);
        return { status: 'not_ready' };
      }
    },
  );
  route(
    {
      method: 'GET',
      url: '/system/health',
      tag: 'System',
      summary: 'Detailed system health: db, worker, outbox, backups, disk, agents',
    },
    async ({ ctx }) => systemHealth(db, config.env, ctx.now()),
  );

  // ------------------------------------------------------------ setup / auth
  route(
    {
      method: 'GET',
      url: '/setup/status',
      tag: 'Setup',
      summary: 'Is this a fresh install?',
      role: 'public',
    },
    async () => {
      const [n] = await db.select({ n: count() }).from(users);
      return { initialized: (n?.n ?? 0) > 0 };
    },
  );

  const bootstrapBody = z.object({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(256),
    orgName: z.string().trim().min(1).max(100),
    timezone: z.string().max(64).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
  });
  route(
    {
      method: 'POST',
      url: '/setup/bootstrap',
      tag: 'Setup',
      summary: 'Create the first owner (only works once, there is no default password)',
      role: 'public',
      body: bootstrapBody,
      status: 201,
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    async ({ body, req, reply }) => {
      const errs = validatePassword(body.password, body.email);
      if (errs.length) throw badRequest(errs[0]!, { errors: errs }, 'WEAK_PASSWORD');
      const { userId, orgId } = await bootstrapOwner(db, {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        orgName: body.orgName,
        timezone: body.timezone,
        currency: body.currency,
      });
      const res = await login(db, config.env, {
        email: body.email,
        password: body.password,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      setSessionCookie(reply, req, res.token, res.expiresAt);
      return { userId, orgId, user: res.user };
    },
  );

  route(
    {
      method: 'POST',
      url: '/auth/login',
      tag: 'Auth',
      summary: 'Sign in (sets an HttpOnly session cookie)',
      role: 'public',
      body: z.object({
        email: z.string().max(254),
        password: z.string().max(256),
        totp: z.string().max(10).optional(),
      }),
      rateLimit: { max: config.loginRateLimit, timeWindow: '1 minute' },
    },
    async ({ body, req, reply }) => {
      // login is a state-changing cookie-setting request: same Origin policy as every other POST
      const res = await login(
        db,
        config.env,
        { ...body, ip: req.ip, userAgent: req.headers['user-agent'] },
        deps.now?.(),
      );
      setSessionCookie(reply, req, res.token, res.expiresAt);
      return { user: res.user };
    },
  );

  route(
    { method: 'POST', url: '/auth/logout', tag: 'Auth', summary: 'Sign out', role: 'VIEWER' },
    async ({ req, reply }) => {
      const token = (req as any).cookies?.[SESSION_COOKIE] as string | undefined;
      if (token) await logout(db, token);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    },
  );

  route(
    { method: 'GET', url: '/me', tag: 'Auth', summary: 'Current user, organization and setup progress' },
    async ({ ctx, session }) => {
      const org = await getOrganization(ctx);
      const setup = await getSetupState(ctx);
      return {
        user: {
          id: session.userId,
          email: session.email,
          name: session.name,
          role: session.role,
          timezone: session.timezone,
        },
        organization: org,
        setup,
      };
    },
  );

  route(
    {
      method: 'POST',
      url: '/auth/password',
      tag: 'Auth',
      summary: 'Change password (signs out other sessions)',
      body: z.object({ current: z.string().max(256), next: z.string().max(256) }),
      role: 'VIEWER',
    },
    async ({ ctx, body, session }) => {
      await changePassword(ctx, { current: body.current, next: body.next, keepSessionId: session.sessionId });
      return { ok: true };
    },
  );
  route(
    { method: 'GET', url: '/auth/sessions', tag: 'Auth', summary: 'Active sessions' },
    async ({ ctx, session }) =>
      (await listSessions(ctx)).map((s) => ({ ...s, current: s.id === session.sessionId })),
  );
  route(
    {
      method: 'DELETE',
      url: '/auth/sessions/:id',
      tag: 'Auth',
      summary: 'Revoke a session',
      params: idParam,
      role: 'VIEWER',
    },
    async ({ ctx, params }) => {
      await revokeSession(ctx, params.id);
      return { ok: true };
    },
  );
  route(
    {
      method: 'POST',
      url: '/auth/totp/begin',
      tag: 'Auth',
      summary: 'Start two-factor setup',
      role: 'VIEWER',
    },
    async ({ session }) => beginTotp(session.email),
  );
  route(
    {
      method: 'POST',
      url: '/auth/totp/enable',
      tag: 'Auth',
      summary: 'Confirm and enable two-factor',
      body: z.object({ secret: z.string().min(16).max(64), code: z.string().min(6).max(10) }),
      role: 'VIEWER',
    },
    async ({ ctx, body }) => {
      await enableTotp(ctx, body.secret, body.code);
      return { ok: true };
    },
  );
  route(
    {
      method: 'POST',
      url: '/auth/totp/disable',
      tag: 'Auth',
      summary: 'Disable two-factor (needs password)',
      body: z.object({ password: z.string().max(256) }),
      role: 'VIEWER',
    },
    async ({ ctx, body }) => {
      await disableTotp(ctx, body.password);
      return { ok: true };
    },
  );

  // ------------------------------------------------------------ organization & setup wizard
  route(
    { method: 'GET', url: '/organization', tag: 'Settings', summary: 'Organization and settings' },
    ({ ctx }) => getOrganization(ctx),
  );
  route(
    {
      method: 'PATCH',
      url: '/organization',
      tag: 'Settings',
      summary: 'Update organization',
      role: 'OWNER',
      body: z.object({
        name: z.string().max(100).optional(),
        timezone: z.string().max(64).optional(),
        baseCurrency: z.string().length(3).toUpperCase().optional(),
        settings: z.record(z.string(), z.number()).optional(),
      }),
    },
    ({ ctx, body }) => updateOrganization(ctx, body),
  );
  route({ method: 'GET', url: '/setup/state', tag: 'Setup', summary: 'Setup wizard progress' }, ({ ctx }) =>
    getSetupState(ctx),
  );
  route(
    {
      method: 'PUT',
      url: '/setup/step',
      tag: 'Setup',
      summary: 'Record setup wizard progress',
      role: 'OWNER',
      body: z.object({ step: z.string().max(40), complete: z.boolean().optional() }),
    },
    ({ ctx, body }) => setSetupStep(ctx, body.step, body.complete),
  );

  // ------------------------------------------------------------ members
  route(
    { method: 'GET', url: '/members', tag: 'Settings', summary: 'Users in this organization', role: 'OWNER' },
    ({ ctx }) => listMembers(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/members',
      tag: 'Settings',
      summary: 'Create a user',
      role: 'OWNER',
      status: 201,
      body: z.object({
        email: z.email().max(254),
        name: z.string().trim().min(1).max(100),
        role: z.enum(['OWNER', 'EDITOR', 'VIEWER']),
        password: z.string().max(256),
      }),
    },
    ({ ctx, body }) => createMember(ctx, body),
  );
  route(
    {
      method: 'PATCH',
      url: '/members/:id',
      tag: 'Settings',
      summary: 'Change role or disable a user',
      role: 'OWNER',
      params: idParam,
      body: z.object({
        role: z.enum(['OWNER', 'EDITOR', 'VIEWER']).optional(),
        status: z.enum(['ACTIVE', 'DISABLED']).optional(),
      }),
    },
    async ({ ctx, params, body }) => {
      await updateMember(ctx, params.id, body);
      return { ok: true };
    },
  );

  route(
    {
      method: 'POST',
      url: '/members/:id/password',
      tag: 'Settings',
      summary: 'Set a new password for a person (signs them out everywhere)',
      role: 'OWNER',
      params: idParam,
      body: z.object({ password: z.string().max(256) }),
    },
    async ({ ctx, params, body }) => {
      await resetMemberPassword(ctx, params.id, body.password);
      return { ok: true };
    },
  );

  // ------------------------------------------------------------ rules, audit, demo
  route({ method: 'GET', url: '/follow-up-rules', tag: 'Settings', summary: 'Follow-up rules' }, ({ ctx }) =>
    listFollowUpRules(ctx),
  );
  route(
    {
      method: 'PATCH',
      url: '/follow-up-rules/:key',
      tag: 'Settings',
      summary: 'Edit a follow-up rule',
      role: 'OWNER',
      params: z.object({ key: z.string().max(60) }),
      body: z.object({
        enabled: z.boolean().optional(),
        notify: z.boolean().optional(),
        durationHours: z.number().int().nullable().optional(),
      }),
    },
    ({ ctx, params, body }) => updateFollowUpRule(ctx, params.key, body),
  );
  route(
    {
      method: 'GET',
      url: '/audit',
      tag: 'Settings',
      summary: 'Audit trail',
      role: 'OWNER',
      query: z.object({
        objectType: z.string().optional(),
        objectId: z.string().optional(),
        action: z.string().optional(),
        limit: z.coerce.number().int().max(500).optional(),
      }),
    },
    ({ ctx, query }) => listAudit(ctx, query),
  );
  route({ method: 'GET', url: '/demo', tag: 'Settings', summary: 'Is demo data loaded?' }, ({ ctx }) =>
    demoStatus(ctx),
  );
  route(
    {
      method: 'POST',
      url: '/demo',
      tag: 'Settings',
      summary: 'Load labelled DEMO data (no fake files, no fake verified metrics)',
      role: 'OWNER',
      status: 201,
    },
    ({ ctx }) => seedDemo(ctx),
  );
  route(
    { method: 'DELETE', url: '/demo', tag: 'Settings', summary: 'Remove DEMO data', role: 'OWNER' },
    ({ ctx }) => clearDemo(ctx),
  );
  route({ method: 'GET', url: '/system/worker', tag: 'System', summary: 'Worker heartbeat' }, async () => {
    const hb = await lastHeartbeat(db, 'worker');
    return hb
      ? { alive: Date.now() - hb.at.getTime() < 120_000, lastSeenAt: hb.at, detail: hb.detail }
      : { alive: false, lastSeenAt: null };
  });
  void audit;
}
