import { oauthScopes } from '@creatoros/domain';
import { http } from './http';
import { randomState } from './pkce';
import {
  ConnectorError,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorContext,
  type ConnectResult,
  type Credentials,
  type HealthResult,
  type NormalizedPost,
  type RateLimitBudget,
  type SyncResult,
} from './types';

const AUTH = 'https://accounts.snapchat.com/login/oauth2/authorize';
const TOKEN = 'https://accounts.snapchat.com/login/oauth2/access_token';
const PROFILE = 'https://businessapi.snapchat.com/v1/public_profiles/my_profile';
const SCOPE = 'snapchat-profile-api';
export const SNAPCHAT_ALLOWLIST =
  'Snapchat has not allowlisted this app for the Public Profile API. The login is saved, and profile, stories, posting, and analytics stay off until Snapchat approves access.';

const iso = (ctx: ConnectorContext) => new Date(ctx.now()).toISOString();

export interface SnapchatProfile {
  id: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  organizationId: string | null;
}

/** Public Profile API. Login Kit scopes do not authorize this profile. */
export class SnapchatConnector implements Connector<NormalizedPost, never> {
  readonly id = 'snapchat' as const;

  async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const hasClient = Boolean(ctx.config.clientId && ctx.config.clientSecret && ctx.config.redirectUri);
    const connected = Boolean(ctx.credentials.accessToken || ctx.credentials.refreshToken);
    const granted = (ctx.credentials.scopes ?? []).includes(SCOPE);
    const access = (ctx.config.access ?? {}) as { publicProfile?: boolean; stories?: boolean };
    const publicProfile = connected && granted && access.publicProfile === true;
    const stories = publicProfile && access.stories === true;
    return {
      provider: 'snapchat',
      state: !hasClient ? 'NOT_CONFIGURED' : !connected ? 'NOT_CONFIGURED' : publicProfile ? 'ACTIVE' : 'PARTIAL_SYNC',
      read: stories,
      write: false,
      incrementalSync: false,
      flags: {
        appConfigured: hasClient,
        redirectUri: ctx.config.redirectUri ?? null,
        publicProfile,
        stories,
        directPost: false,
        analytics: false,
      },
      blockers: [
        'Connect asks for Public Profile only when that box is checked. Posting and analytics are not requested.',
        'A Story is not sent from Kemokem. A capability is on only after Snapchat accepts a call for it.',
        ...(connected && granted && access.publicProfile === false ? [SNAPCHAT_ALLOWLIST] : []),
        ...(hasClient ? [] : ['The server has no Snapchat client id and client secret yet.']),
      ],
      setupSteps: [
        'In the Snapchat developer portal, create an OAuth app and enable the Public Profile API.',
        'Register the redirect shown on this card. Put the client id and client secret in the server environment.',
        'Press Connect. Snapchat asks for the Public Profile permission. Nothing is posted during Connect.',
      ],
    };
  }

  async connect(ctx: ConnectorContext, input: Record<string, unknown> = {}): Promise<ConnectResult> {
    if (!ctx.config.clientId || !ctx.config.redirectUri)
      return { status: 'NOT_CONFIGURED', steps: (await this.getCapabilities(ctx)).setupSteps };
    const state = randomState();
    const requested = Array.isArray(input.scopes) ? (input.scopes as string[]) : [SCOPE];
    const scopes = oauthScopes('snapchat', requested);
    if (!scopes.includes(SCOPE))
      return {
        status: 'NOT_CONFIGURED',
        steps: ['Check Public Profile to continue. Kemokem does not open Snapchat without it, and it does not ask for any other permission.'],
      };
    const u = new URL(AUTH);
    u.searchParams.set('client_id', ctx.config.clientId);
    u.searchParams.set('redirect_uri', ctx.config.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', scopes.join(' '));
    u.searchParams.set('state', state);
    return {
      status: 'REDIRECT',
      authorizeUrl: u.toString(),
      oauth: { state, verifier: state, scopes },
    };
  }

  async exchangeCode(ctx: ConnectorContext, code: string): Promise<Credentials> {
    const { data } = await http<any>(ctx, TOKEN, {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        client_id: ctx.config.clientId,
        client_secret: ctx.config.clientSecret,
        code,
        redirect_uri: ctx.config.redirectUri,
      },
      maxAttempts: 1,
    });
    if (!data?.access_token) throw new ConnectorError('BAD_REQUEST', snapError(data) || 'Snapchat did not return a token.');
    return tokenCreds(ctx, data);
  }

  async refreshCredentials(ctx: ConnectorContext): Promise<Credentials> {
    if (!ctx.credentials.refreshToken) throw new ConnectorError('AUTH_EXPIRED', 'No Snapchat refresh token; reconnect.');
    const { data } = await http<any>(ctx, TOKEN, {
      method: 'POST',
      form: {
        grant_type: 'refresh_token',
        client_id: ctx.config.clientId,
        client_secret: ctx.config.clientSecret,
        refresh_token: ctx.credentials.refreshToken,
      },
      maxAttempts: 2,
      idempotent: true,
    });
    if (!data?.access_token) throw new ConnectorError('AUTH_EXPIRED', snapError(data) || 'Snapchat did not refresh the login.');
    return { ...ctx.credentials, ...tokenCreds(ctx, data), refreshToken: data.refresh_token ?? ctx.credentials.refreshToken };
  }

  async profile(ctx: ConnectorContext): Promise<SnapchatProfile> {
    const token = ctx.credentials.accessToken;
    if (!token) throw new ConnectorError('NOT_CONFIGURED', 'Snapchat account not connected.');
    let data: any;
    try {
      ({ data } = await http<any>(ctx, PROFILE, {
        headers: { authorization: `Bearer ${token}` },
        maxAttempts: 1,
      }));
    } catch (e) {
      if (e instanceof ConnectorError && e.kind === 'PERMISSION_DENIED')
        throw new ConnectorError('PERMISSION_DENIED', SNAPCHAT_ALLOWLIST, { status: 403 });
      throw e;
    }
    if (data?.request_status && data.request_status !== 'SUCCESS') {
      const message = String(data.display_message || data.debug_message || 'Snapchat did not return the profile.');
      if (/allowlist|not authorized|permission|forbidden/i.test(message))
        throw new ConnectorError('PERMISSION_DENIED', SNAPCHAT_ALLOWLIST, { status: 403 });
      throw new ConnectorError('BAD_REQUEST', message);
    }
    const profile = data?.public_profile ?? {};
    const logo = profile.logo_urls ?? {};
    return {
      id: typeof profile.id === 'string' ? profile.id : null,
      username: typeof profile.snap_user_name === 'string' ? profile.snap_user_name : null,
      displayName: typeof profile.display_name === 'string' ? profile.display_name : null,
      avatarUrl: typeof logo.manage_profile_logo_url === 'string' ? logo.manage_profile_logo_url : null,
      organizationId: typeof profile.organization_id === 'string' ? profile.organization_id : null,
    };
  }

  async disconnect() {}

  /** Confirms profile and story listing with the saved token. Publishing and analytics are not called. */
  async inspectAccess(ctx: ConnectorContext): Promise<{
    publicProfile: boolean;
    stories: boolean;
    publish: false;
    analytics: false;
    detail: string | null;
    profile: SnapchatProfile | null;
  }> {
    const token = await this.token(ctx);
    const authed = { ...ctx, credentials: { ...ctx.credentials, accessToken: token } };
    try {
      const profile = await this.profile(authed);
      let stories = false;
      if (profile.id) {
        try {
          await http(authed, `https://businessapi.snapchat.com/v1/public_profiles/${encodeURIComponent(profile.id)}/stories`, {
            headers: { authorization: `Bearer ${token}` },
            query: { limit: 1 },
            maxAttempts: 1,
          });
          stories = true;
        } catch (e) {
          if (!(e instanceof ConnectorError) || e.kind !== 'PERMISSION_DENIED') stories = false;
        }
      }
      return { publicProfile: true, stories, publish: false, analytics: false, detail: null, profile };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        publicProfile: false,
        stories: false,
        publish: false,
        analytics: false,
        detail: err.kind === 'PERMISSION_DENIED' ? SNAPCHAT_ALLOWLIST : err.message,
        profile: null,
      };
    }
  }

  async health(ctx: ConnectorContext): Promise<HealthResult> {
    try {
      const access = await this.inspectAccess(ctx);
      if (access.publicProfile) return { ok: true, state: 'ACTIVE', checkedAt: iso(ctx) };
      return {
        ok: false,
        state: 'PARTIAL_SYNC',
        detail: access.detail ?? SNAPCHAT_ALLOWLIST,
        checkedAt: iso(ctx),
      };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        ok: false,
        state: err.kind === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : err.kind === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'ERROR',
        detail: err.message,
        checkedAt: iso(ctx),
      };
    }
  }

  async rateLimitBudget(): Promise<RateLimitBudget> {
    return { remaining: null, limit: null, resetsAt: null, estimated: true };
  }

  normalize(): NormalizedPost {
    throw new ConnectorError('UNSUPPORTED', 'Snapchat stories are not imported. The API does not return a public link.');
  }

  async getExternalRecord(): Promise<NormalizedPost | null> {
    return null;
  }

  async syncFull(): Promise<SyncResult<NormalizedPost>> {
    return { items: [], nextCursor: null, hasMore: false };
  }

  syncIncremental(): Promise<SyncResult<NormalizedPost>> {
    return this.syncFull();
  }

  private async token(ctx: ConnectorContext): Promise<string> {
    const c = ctx.credentials;
    if (!c.accessToken && !c.refreshToken) throw new ConnectorError('NOT_CONFIGURED', 'Snapchat account not connected.');
    if (c.accessToken && (!c.expiresAt || c.expiresAt - 120_000 > ctx.now())) return c.accessToken;
    const next = await this.refreshCredentials(ctx);
    ctx.credentials = next;
    await ctx.onCredentials?.(next);
    return next.accessToken!;
  }
}

function tokenCreds(ctx: ConnectorContext, data: any): Credentials {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: ctx.now() + (data.expires_in ?? 3600) * 1000,
    scopes: String(data.scope ?? SCOPE)
      .split(/[\s,]+/)
      .filter(Boolean),
  };
}

function snapError(data: any): string {
  return [data?.error, data?.error_description].filter(Boolean).join(': ');
}
