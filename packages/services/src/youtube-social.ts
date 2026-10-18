import { eq, providerConnections, socialMediaItems, type Db } from '@creatoros/db';
import {
  GOOGLE_SCOPES,
  YouTubeConnector,
  listYoutubeCommentPage,
  youtubeVideoTitles,
  type ConnectorContext,
} from '@creatoros/connectors';
import { autoReconcileConnection } from './identity';
import { connectorContext } from './integrations';
import { ingestSocialEvent } from './social';
import { AppError, notFound, type Ctx } from './types';
import { and } from '@creatoros/db';

type Conn = typeof providerConnections.$inferSelect;

export const YOUTUBE_COMMENTS_SCOPE = GOOGLE_SCOPES.youtubeComments[0];
/** First import reads up to this many pages (100 threads, 1 quota unit each); later runs re-read the newest few. */
const FIRST_PAGES = 10;
const REFRESH_PAGES = 3;

async function loadYt(db: Db, orgId: string, id: string): Promise<Conn> {
  const [c] = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, id), eq(providerConnections.orgId, orgId)));
  if (!c || c.provider !== 'youtube') throw notFound('YouTube connection');
  return c;
}

async function saveConfig(db: Db, id: string, fn: (cfg: any) => any, extra: Record<string, unknown> = {}) {
  const [fresh] = await db.select().from(providerConnections).where(eq(providerConnections.id, id));
  await db
    .update(providerConnections)
    .set({ config: fn((fresh?.config ?? {}) as any), ...extra, updatedAt: new Date() })
    .where(eq(providerConnections.id, id));
}

/** Resolves and stores the channel id (the verified identity), then links to a matching Channels account if exactly one carries it. */
async function ensureChannel(ctx: Ctx, conn: Conn, cctx: ConnectorContext) {
  const known = ((conn.config ?? {}) as any).youtube?.channelId as string | undefined;
  if (known) return known;
  const ch = await new YouTubeConnector().getChannel(cctx);
  if (!ch) throw new AppError(409, 'NO_CHANNEL', 'This Google account has no YouTube channel.');
  await saveConfig(ctx.db, conn.id, (cfg) => ({
    ...cfg,
    youtube: { channelId: ch.channelId, title: ch.title },
  }));
  await autoReconcileConnection(ctx, conn.id);
  return ch.channelId;
}

/**
 * Imports comment threads (and your replies) for the whole channel into the Socials inbox. Read only, polling
 * (YouTube has no comment webhooks), historical (never triggers automation).
 */
export async function syncYoutubeComments(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const conn = await loadYt(ctx.db, ctx.orgId, connectionId);
  if (conn.state !== 'ACTIVE' && conn.state !== 'PARTIAL_SYNC')
    throw new AppError(409, 'NEEDS_RECONNECT', 'Reconnect this YouTube account before syncing.');
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const steps: { key: string; ok: boolean; fetched: number; error?: string }[] = [];
  const counts = { videos: 0, comments: 0, newMessages: 0 };
  const started = new Date().toISOString();
  const first = !(((conn.config ?? {}) as any).social?.sync?.lastSuccessAt as string | undefined);

  if (!(conn.scopes ?? []).includes(YOUTUBE_COMMENTS_SCOPE)) {
    steps.push({
      key: 'comments',
      ok: false,
      fetched: 0,
      error: `Permission not granted: ${YOUTUBE_COMMENTS_SCOPE}. Press "Enable comments" to reconnect and approve it.`,
    });
  } else {
    try {
      const channelId = await ensureChannel(ctx, conn, cctx);
      let token: string | null = null;
      const videos = new Set<string>();
      const topAuthor = new Map<string, string>();
      for (let i = 0; i < (first ? FIRST_PAGES : REFRESH_PAGES); i++) {
        const page = await listYoutubeCommentPage(cctx, { channelId, pageToken: token });
        for (const c of page.comments) {
          counts.comments += 1;
          if (c.videoId) videos.add(c.videoId);
          if (c.isTopLevel && c.authorChannelId) topAuthor.set(c.threadId, c.authorChannelId);
          const r = await ingestSocialEvent(ctx, {
            connectionId: conn.id,
            kind: 'COMMENT',
            providerThreadId: `yt:${c.threadId}`,
            providerMsgId: c.id,
            participantId: c.authorChannelId ?? 'unknown',
            participantName: c.authorName,
            direction: c.authorChannelId === channelId ? 'OUTBOUND' : 'INBOUND',
            text: c.text,
            mediaId: c.videoId,
            receivedAt: new Date(c.publishedAt),
            isLive: false,
          });
          if (!r.duplicate) counts.newMessages += 1;
        }
        token = page.nextPageToken;
        if (!token) break;
      }
      steps.push({ key: 'comments', ok: true, fetched: counts.comments });
      try {
        const titles = await youtubeVideoTitles(cctx, [...videos]);
        for (const [id, v] of titles) {
          counts.videos += 1;
          await ctx.db
            .insert(socialMediaItems)
            .values({
              orgId: ctx.orgId,
              connectionId: conn.id,
              providerMediaId: id,
              mediaType: 'VIDEO',
              caption: v.title,
              permalink: `https://www.youtube.com/watch?v=${id}`,
              commentsCount: v.commentCount ?? 0,
            })
            .onConflictDoUpdate({
              target: [socialMediaItems.connectionId, socialMediaItems.providerMediaId],
              set: {
                caption: v.title,
                commentsCount: v.commentCount ?? 0,
                lastSyncedAt: new Date(),
              },
            });
        }
        steps.push({ key: 'videos', ok: true, fetched: counts.videos });
      } catch (e) {
        steps.push({ key: 'videos', ok: false, fetched: 0, error: (e as Error).message.slice(0, 300) });
      }
    } catch (e) {
      steps.push({ key: 'comments', ok: false, fetched: 0, error: (e as Error).message.slice(0, 300) });
    }
  }

  const failed = steps.filter((s) => !s.ok);
  const state = failed.length === 0 ? 'OK' : failed.length === steps.length ? 'FAILED' : 'PARTIAL';
  const sync = {
    state,
    steps,
    counts,
    lastError: failed.map((s) => `${s.key}: ${s.error}`).join(' | ') || null,
    lastAttemptAt: started,
    ...(state !== 'FAILED' ? { lastSuccessAt: new Date().toISOString() } : {}),
  };
  const [fresh] = await ctx.db.select().from(providerConnections).where(eq(providerConnections.id, conn.id));
  await saveConfig(
    ctx.db,
    conn.id,
    (cfg) => ({ ...cfg, social: { ...(cfg.social ?? {}), sync: { ...(cfg.social?.sync ?? {}), ...sync } } }),
    { lastSyncAt: state === 'FAILED' ? fresh?.lastSyncAt : new Date() },
  );
  return sync;
}

/** Read-only check that the token works and which channel it belongs to. */
export async function testYoutubeAccount(
  ctx: Ctx,
  connectionId: string,
  overrides: Partial<ConnectorContext> = {},
) {
  const conn = await loadYt(ctx.db, ctx.orgId, connectionId);
  const cctx = connectorContext(ctx.db, ctx.env, conn, overrides);
  const h = await new YouTubeConnector().health(cctx);
  if (h.ok) {
    try {
      await ensureChannel(ctx, conn, cctx);
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 300) };
    }
  }
  return h.ok
    ? { ok: true, commentsPermission: (conn.scopes ?? []).includes(YOUTUBE_COMMENTS_SCOPE) }
    : { ok: false, error: h.detail };
}
