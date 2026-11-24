import { GatedConnector } from '../social';
import { ensureFreshToken } from '../http';
import { GOOGLE_SCOPES, refreshGoogleToken, revokeGoogleToken, type GoogleClientConfig } from './oauth';
import type { ConnectorCapabilities, ConnectorContext, HealthResult } from '../types';

const DRIVE_SCOPE = GOOGLE_SCOPES.driveFile[0];

/** Drive Sync has a separate Google OAuth client, account and encrypted token record. */
export class GoogleDriveConnector extends GatedConnector {
  constructor() {
    super('google', [], []);
  }

  override async getCapabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const configured = Boolean(ctx.config.googleClient as GoogleClientConfig | undefined);
    const authorized = Boolean(
      (ctx.credentials.accessToken || ctx.credentials.refreshToken) &&
      ctx.credentials.scopes?.includes(DRIVE_SCOPE),
    );
    return {
      provider: 'google',
      state: !configured ? 'NOT_CONFIGURED' : authorized ? 'ACTIVE' : 'NOT_CONFIGURED',
      read: authorized,
      write: authorized,
      incrementalSync: false,
      flags: { driveSync: authorized, fileAccess: authorized },
      blockers: [
        ...(!configured ? ['Set DRIVE_GOOGLE_CLIENT_ID and DRIVE_GOOGLE_REDIRECT_URI (plus DRIVE_GOOGLE_CLIENT_SECRET for a Web OAuth client).'] : []),
        ...(configured && !authorized ? ['Connect a Google account for Drive Sync using its separate Drive permission.'] : []),
      ],
      setupSteps: [
        'Enable the Google Drive API in Google Cloud.',
        'Set DRIVE_GOOGLE_CLIENT_ID, DRIVE_GOOGLE_CLIENT_SECRET and DRIVE_GOOGLE_REDIRECT_URI without modifying your Gmail or YouTube settings.',
        'Add the exact DRIVE_GOOGLE_REDIRECT_URI to the new Google OAuth client as an authorized redirect URI.',
        'Press Connect and choose the Google account you want to use for Drive Sync.',
      ],
    };
  }

  override refreshCredentials(ctx: ConnectorContext) {
    return refreshGoogleToken(ctx);
  }

  override disconnect(ctx: ConnectorContext) {
    return revokeGoogleToken(ctx);
  }

  override async health(ctx: ConnectorContext): Promise<HealthResult> {
    const caps = await this.getCapabilities(ctx);
    if (!caps.read) return { ok: false, state: caps.state, detail: caps.blockers[0] ?? 'Drive is not connected.', checkedAt: new Date(ctx.now()).toISOString() };
    try {
      const token = await ensureFreshToken(ctx, refreshGoogleToken);
      const response = await ctx.fetch('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)', {
        headers: { authorization: `Bearer ${token}` },
      });
      return {
        ok: response.ok,
        state: response.ok ? 'ACTIVE' : response.status === 401 ? 'AUTH_EXPIRED' : 'ERROR',
        detail: response.ok ? 'Google Drive API connected; Gmail and YouTube accounts are unchanged.' : `Drive API returned HTTP ${response.status}`,
        checkedAt: new Date(ctx.now()).toISOString(),
      };
    } catch (error) {
      return { ok: false, state: 'ERROR', detail: error instanceof Error ? error.message : 'Drive API unreachable.', checkedAt: new Date(ctx.now()).toISOString() };
    }
  }
}
