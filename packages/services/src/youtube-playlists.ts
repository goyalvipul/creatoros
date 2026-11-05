import { and, eq, providerConnections, socialAccounts } from '@creatoros/db';
import {
  addYoutubeVideoToPlaylists,
  createYoutubePlaylist,
  listYoutubePlaylists,
  refreshGoogleToken,
} from '@creatoros/connectors';
import { connectorContext, loadCredentials } from './integrations';
import { badRequest, conflict, notFound, type Ctx } from './types';

const MANAGE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const FULL = 'https://www.googleapis.com/auth/youtube';

async function youtubeAccess(ctx: Ctx, socialAccountId: string) {
  const [account] = await ctx.db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, socialAccountId), eq(socialAccounts.orgId, ctx.orgId)));
  if (!account || account.platform !== 'youtube') throw notFound('YouTube account');
  if (!account.providerConnectionId) throw conflict('Connect this YouTube account in Integrations first.');
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, account.providerConnectionId));
  if (!conn) throw conflict('Connect this YouTube account in Integrations first.');
  const creds = loadCredentials(ctx.env, conn);
  const fresh = await refreshGoogleToken(connectorContext(ctx.db, ctx.env, conn, {})).catch(() => creds);
  const token = fresh.accessToken ?? creds.accessToken ?? '';
  if (!token) throw conflict('YouTube needs to be connected again.');
  const scopes: string[] = conn.scopes ?? [];
  return { token, canCreate: scopes.includes(MANAGE) || scopes.includes(FULL) };
}

export async function listAccountPlaylists(ctx: Ctx, socialAccountId: string) {
  const access = await youtubeAccess(ctx, socialAccountId);
  try {
    const playlists = await listYoutubePlaylists(fetch, access.token);
    return { playlists, canCreate: access.canCreate };
  } catch (e) {
    throw badRequest((e as Error).message || 'Playlists could not be loaded from YouTube.');
  }
}

export async function createAccountPlaylist(
  ctx: Ctx,
  socialAccountId: string,
  input: { title: string; privacy?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' },
) {
  const title = input.title.trim();
  if (!title) throw badRequest('Enter a playlist name.');
  if (title.length > 150) throw badRequest('A playlist name can be at most 150 characters.');
  const access = await youtubeAccess(ctx, socialAccountId);
  if (!access.canCreate) {
    throw conflict(
      'Creating a playlist needs the YouTube manage permission. Integrations → Enable comments, then try again.',
      undefined,
      'PLAYLIST_PERMISSION',
    );
  }
  const privacy = input.privacy === 'PUBLIC' ? 'public' : input.privacy === 'PRIVATE' ? 'private' : 'unlisted';
  try {
    return await createYoutubePlaylist(fetch, access.token, { title, privacy });
  } catch (e) {
    throw badRequest((e as Error).message || 'YouTube did not create the playlist.');
  }
}

export async function placeVideoOnPlaylists(accessToken: string, videoId: string, playlistIds: string[]) {
  return addYoutubeVideoToPlaylists(fetch, accessToken, videoId, playlistIds);
}
