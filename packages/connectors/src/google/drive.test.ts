import { describe, expect, it, vi } from 'vitest';
import { readGoogleClientConfig, GOOGLE_SCOPES } from './oauth';
import { GoogleDriveConnector } from './drive';

const env = {
  GOOGLE_CLIENT_ID: 'existing-gmail',
  GOOGLE_CLIENT_SECRET: 'gmail-secret',
  GOOGLE_REDIRECT_URI: 'https://example.test/api/v1/integrations/oauth/callback',
  YOUTUBE_GOOGLE_CLIENT_ID: 'existing-youtube',
  YOUTUBE_GOOGLE_CLIENT_SECRET: 'youtube-secret',
  YOUTUBE_GOOGLE_REDIRECT_URI: 'https://youtube.test/callback',
  DRIVE_GOOGLE_CLIENT_ID: 'separate-drive-client',
  DRIVE_GOOGLE_CLIENT_SECRET: 'drive-secret',
  DRIVE_GOOGLE_REDIRECT_URI: 'https://drive.test/api/v1/integrations/oauth/callback',
};

describe('Drive OAuth credentials stay separate from Gmail and YouTube', () => {
  it('uses dedicated Drive credentials and redirect without modifying the existing clients', () => {
    expect(readGoogleClientConfig(env, 'google')).toEqual({
      clientId: 'separate-drive-client', clientSecret: 'drive-secret',
      redirectUri: 'https://drive.test/api/v1/integrations/oauth/callback',
    });
    expect(readGoogleClientConfig(env, 'gmail')?.clientId).toBe('existing-gmail');
    expect(readGoogleClientConfig(env, 'youtube')?.clientId).toBe('existing-youtube');
  });

  it('does not silently fall back to the existing Gmail client if Drive is unconfigured', () => {
    expect(readGoogleClientConfig({ ...env, DRIVE_GOOGLE_CLIENT_ID: '' }, 'google')).toBeNull();
    expect(readGoogleClientConfig({ ...env, DRIVE_GOOGLE_REDIRECT_URI: '' }, 'google')).toBeNull();
  });

  it('reports a separate Drive card and verifies its own permission', async () => {
    const connector = new GoogleDriveConnector();
    const config = { googleClient: readGoogleClientConfig(env, 'google') };
    const context = {
      fetch: vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 })),
      now: () => Date.now(),
      credentials: {
        accessToken: 'drive-token', expiresAt: Date.now() + 600000,
        scopes: [...GOOGLE_SCOPES.driveFile],
      },
      config,
    };
    const capabilities = await connector.getCapabilities(context);
    expect(capabilities.provider).toBe('google');
    expect(capabilities.flags.driveSync).toBe(true);
    expect((await connector.health(context)).ok).toBe(true);
    expect(context.fetch).toHaveBeenCalledOnce();
    expect((await connector.getCapabilities({
      ...context, credentials: { ...context.credentials, scopes: ['https://www.googleapis.com/auth/gmail.readonly'] },
    })).read).toBe(false);
  });
});
