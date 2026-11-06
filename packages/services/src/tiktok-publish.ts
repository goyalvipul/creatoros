import { and, eq, providerConnections, socialAccounts } from '@creatoros/db';
import { queryTikTokCreator, tiktokConnector } from '@creatoros/connectors';
import { connectorContext, loadCredentials } from './integrations';
import { badRequest, conflict, notFound, type Ctx } from './types';

export async function tiktokCreatorOptions(ctx: Ctx, socialAccountId: string) {
  const [account] = await ctx.db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, socialAccountId), eq(socialAccounts.orgId, ctx.orgId)));
  if (!account || account.platform !== 'tiktok') throw notFound('TikTok account');
  if (!account.providerConnectionId) throw conflict('Connect this TikTok account in Integrations first.');
  const [conn] = await ctx.db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, account.providerConnectionId));
  if (!conn) throw conflict('Connect this TikTok account in Integrations first.');
  const scopes: string[] = conn.scopes ?? [];
  if (!scopes.includes('video.publish')) throw conflict('Reconnect TikTok and check Publish.');
  const cctx = connectorContext(ctx.db, ctx.env, conn, {});
  const creds = loadCredentials(ctx.env, conn);
  let token = creds.accessToken ?? '';
  if (creds.refreshToken && (!creds.expiresAt || creds.expiresAt - 120_000 <= Date.now())) {
    const fresh = await tiktokConnector.refreshCredentials(cctx).catch(() => creds);
    token = fresh.accessToken ?? token;
    if (fresh.accessToken && fresh.accessToken !== creds.accessToken) await cctx.onCredentials?.(fresh);
  }
  if (!token) throw conflict('TikTok needs to be connected again.');
  try {
    return await queryTikTokCreator(fetch, token);
  } catch (e) {
    throw badRequest((e as Error).message || 'TikTok did not return the posting options for this account.');
  }
}
