import { ConnectorError, type ConnectorContext, type Credentials } from '../types';
import { http } from '../http';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/**
 * Exact scopes requested. Narrowest practical set; each capability is opt-in.
 * - gmail.readonly: read messages/threads/history (no send, no modify)
 * - gmail.compose: ONLY if the owner enables "create reply drafts" (still never sends)
 * - youtube.readonly: list own uploads + public stats (Data API v3)
 * - yt-analytics.readonly: optional private analytics (watch time etc.)
 */
export const GOOGLE_SCOPES = {
  identity: ['openid', 'email'],
  gmailRead: ['https://www.googleapis.com/auth/gmail.readonly'],
  gmailDrafts: ['https://www.googleapis.com/auth/gmail.compose'],
  youtubeRead: ['https://www.googleapis.com/auth/youtube.readonly'],
  youtubeAnalytics: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
} as const;

export interface GoogleClientConfig {
  clientId: string;
  /** Optional: required for "Web application" clients, absent for "Desktop"/PKCE-only usage. */
  clientSecret?: string;
  redirectUri: string;
}

export function readGoogleClientConfig(env: Record<string, string | undefined>): GoogleClientConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) return null;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET || undefined, redirectUri: env.GOOGLE_REDIRECT_URI };
}

export function buildGoogleAuthUrl(args: {
  client: GoogleClientConfig;
  scopes: string[];
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set('client_id', args.client.clientId);
  u.searchParams.set('redirect_uri', args.client.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', args.scopes.join(' '));
  u.searchParams.set('state', args.state);
  u.searchParams.set('code_challenge', args.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('prompt', 'consent');
  if (args.loginHint) u.searchParams.set('login_hint', args.loginHint);
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

function decodeIdTokenEmail(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export async function exchangeGoogleCode(
  ctx: ConnectorContext,
  client: GoogleClientConfig,
  code: string,
  codeVerifier: string,
): Promise<Credentials> {
  const form: Record<string, string> = {
    client_id: client.clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: client.redirectUri,
  };
  if (client.clientSecret) form.client_secret = client.clientSecret;
  const { data } = await http<TokenResponse>(ctx, GOOGLE_TOKEN_URL, { method: 'POST', form, maxAttempts: 1 });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: ctx.now() + data.expires_in * 1000,
    scopes: (data.scope ?? '').split(' ').filter(Boolean),
    principal: decodeIdTokenEmail(data.id_token),
    tokenType: data.token_type,
  };
}

export async function refreshGoogleToken(ctx: ConnectorContext): Promise<Credentials> {
  const client = ctx.config.googleClient as GoogleClientConfig | undefined;
  const rt = ctx.credentials.refreshToken;
  if (!client) throw new ConnectorError('NOT_CONFIGURED', 'Google OAuth client is not configured (GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI).');
  if (!rt) throw new ConnectorError('AUTH_EXPIRED', 'No refresh token stored; reconnect the Google account.');
  const form: Record<string, string> = { client_id: client.clientId, refresh_token: rt, grant_type: 'refresh_token' };
  if (client.clientSecret) form.client_secret = client.clientSecret;
  try {
    const { data } = await http<TokenResponse>(ctx, GOOGLE_TOKEN_URL, { method: 'POST', form, maxAttempts: 2, idempotent: true });
    return {
      ...ctx.credentials,
      accessToken: data.access_token,
      expiresAt: ctx.now() + data.expires_in * 1000,
      scopes: data.scope ? data.scope.split(' ').filter(Boolean) : ctx.credentials.scopes,
    };
  } catch (e) {
    if (e instanceof ConnectorError && (e.kind === 'BAD_REQUEST' || e.kind === 'AUTH_EXPIRED')) {
      // invalid_grant => the owner revoked access or the token expired (7 day limit for unverified apps in testing mode)
      throw new ConnectorError('AUTH_REVOKED', 'Google rejected the refresh token (revoked or expired). Reconnect the account.', { status: e.status });
    }
    throw e;
  }
}

export async function revokeGoogleToken(ctx: ConnectorContext): Promise<void> {
  const token = ctx.credentials.refreshToken ?? ctx.credentials.accessToken;
  if (!token) return;
  try {
    await http(ctx, GOOGLE_REVOKE_URL, { method: 'POST', form: { token }, maxAttempts: 1 });
  } catch {
    // best effort; local credentials are deleted regardless
  }
}

export function hasScope(creds: Credentials, scope: string): boolean {
  return (creds.scopes ?? []).includes(scope);
}
