import { afterAll, describe, expect, it } from 'vitest';
import { eq, providerConnections, socialAccounts, sql } from '@creatoros/db';
import {
  createBrand,
  createChannel,
  createSocialAccount,
  encryptJson,
  listSocialAccounts,
  listSocialThreads,
  replyToThread,
  syncSocialAccount,
} from '@creatoros/services';
import { makeOrg, openDb } from '../src/helpers';

const h = openDb();
afterAll(async () => {
  await h.db.execute(sql`delete from social_outbound_messages`);
  await h.db.delete(providerConnections).where(eq(providerConnections.provider, 'youtube'));
  await h.close();
});

const READ = 'https://www.googleapis.com/auth/youtube.readonly';
const COMMENTS = 'https://www.googleapis.com/auth/youtube.force-ssl';
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const now = () => new Date().toISOString();

function fakeYouTube(channelId: string) {
  const writes: { url: string; body: any; auth: string }[] = [];
  const quotaCalls = { threads: 0 };
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const auth = new Headers(init.headers as any).get('authorization') ?? '';
    if (u.pathname.endsWith('/channels'))
      return json({
        items: [
          {
            id: channelId,
            snippet: { title: 'Mehak' },
            contentDetails: { relatedPlaylists: { uploads: 'UU' } },
          },
        ],
      });
    if (u.pathname.endsWith('/commentThreads')) {
      quotaCalls.threads += 1;
      return json({
        items: [
          {
            snippet: {
              videoId: 'vid1',
              totalReplyCount: 1,
              topLevelComment: {
                id: 'Ug1',
                snippet: {
                  videoId: 'vid1',
                  textOriginal: 'love this song',
                  authorDisplayName: 'Fan',
                  authorChannelId: { value: 'UCfan' },
                  publishedAt: now(),
                },
              },
            },
            replies: {
              comments: [
                {
                  id: 'Ug1.r1',
                  snippet: {
                    textOriginal: 'thanks!',
                    authorDisplayName: 'Mehak',
                    authorChannelId: { value: channelId },
                    publishedAt: now(),
                  },
                },
              ],
            },
          },
          {
            snippet: {
              videoId: 'vid1',
              totalReplyCount: 0,
              topLevelComment: {
                id: 'Ug2',
                snippet: {
                  videoId: 'vid1',
                  textOriginal: 'when is the next one?',
                  authorDisplayName: 'Other',
                  authorChannelId: { value: 'UCother' },
                  publishedAt: now(),
                },
              },
            },
          },
        ],
      });
    }
    if (u.pathname.endsWith('/videos'))
      return json({
        items: [{ id: 'vid1', snippet: { title: 'Song One' }, statistics: { commentCount: '3' } }],
      });
    if (u.pathname.endsWith('/comments') && init.method === 'POST') {
      writes.push({ url, body: JSON.parse(String(init.body)), auth });
      return json({ id: 'Ug2.mine' });
    }
    return json({}, 404);
  };
  return { writes, quotaCalls, overrides: { fetch: fetchImpl as any, sleep: async () => {} } };
}

async function world(scopes: string[], opts: { linked?: boolean } = {}) {
  const org = await makeOrg(h);
  const channelId = `UC${Math.floor(Math.random() * 1e9)}`;
  const brand: any = await createBrand(org.ctx, { name: 'Mehak' });
  const channel: any = await createChannel(org.ctx, { brandId: brand.id, name: 'Mehak Music' });
  const acct: any = await createSocialAccount(org.ctx, {
    channelId: channel.id,
    platform: 'youtube',
    handle: '@mehak',
    ...(opts.linked ? { externalAccountId: channelId } : {}),
  });
  const [conn] = await h.db
    .insert(providerConnections)
    .values({
      orgId: org.ctx.orgId,
      provider: 'youtube',
      label: 'youtube',
      principalHint: 'mehak@example.com',
      state: 'ACTIVE',
      scopes,
      encryptedTokenRef: encryptJson(
        { accessToken: 'ytok', expiresAt: 9e12, scopes, principal: 'mehak@example.com' },
        org.ctx.env.encryptionKey,
      ),
    })
    .returning();
  return { org, channelId, acct, conn: conn!, g: fakeYouTube(channelId) };
}

describe('YouTube comments in Socials', () => {
  it('without the comments permission nothing is fetched and the account says so', async () => {
    const w = await world([READ]);
    const r: any = await syncSocialAccount(w.org.ctx, w.conn.id, w.g.overrides);
    expect(r.state).toBe('FAILED');
    expect(r.lastError).toContain('Enable comments');
    expect(w.g.quotaCalls.threads).toBe(0);
    const a: any = (await listSocialAccounts(w.org.ctx)).find((x: any) => x.id === w.conn.id);
    expect(a).toMatchObject({
      platform: 'YOUTUBE',
      capabilities: { readComments: 'MISSING_PERMISSION', sendMessages: 'UNSUPPORTED' },
    });
  });

  it('imports threads and your replies idempotently, resolves the channel and auto-links on the verified channel id', async () => {
    const w = await world([READ, COMMENTS], { linked: true });
    const r1: any = await syncSocialAccount(w.org.ctx, w.conn.id, w.g.overrides);
    expect(r1.state).toBe('OK');
    expect(r1.counts).toMatchObject({ comments: 3, newMessages: 3, videos: 1 });
    const r2: any = await syncSocialAccount(w.org.ctx, w.conn.id, w.g.overrides);
    expect(r2.counts.newMessages).toBe(0);
    const [c] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, w.conn.id));
    expect((c!.config as any).youtube.channelId).toBe(w.channelId);
    expect(
      (await h.db.select().from(socialAccounts).where(eq(socialAccounts.id, w.acct.id)))[0]!
        .providerConnectionId,
    ).toBe(w.conn.id);
    const threads: any[] = await listSocialThreads(w.org.ctx, { kind: 'COMMENT' });
    expect(threads).toHaveLength(2);
    expect(w.g.writes).toHaveLength(0); // sync never writes to YouTube
    const [{ n }] = (
      await h.db.execute(sql`select count(*)::int n from social_media_items where connection_id=${w.conn.id}`)
    ).rows as any[];
    expect(n).toBe(1);
  });

  it('replies to the top-level comment only on explicit send, as the owning channel', async () => {
    const w = await world([READ, COMMENTS], { linked: true });
    const other = await world([READ, COMMENTS], { linked: true });
    await syncSocialAccount(w.org.ctx, w.conn.id, w.g.overrides);
    const threads: any[] = await listSocialThreads(w.org.ctx, { kind: 'COMMENT' });
    const t = threads.find((x) => /next one/.test(JSON.stringify(x))) ?? threads[0];
    const draft: any = await replyToThread(
      w.org.ctx,
      t.id,
      { connectionId: w.conn.id, text: 'soon!', requestId: `y-${w.channelId}-0`, send: false },
      w.g.overrides,
    );
    expect(draft.state).toBe('DRAFT');
    expect(w.g.writes).toHaveLength(0);
    await expect(
      replyToThread(
        w.org.ctx,
        t.id,
        { connectionId: other.conn.id, text: 'x', requestId: `y-${w.channelId}-1`, send: true },
        w.g.overrides,
      ),
    ).rejects.toBeTruthy();
    const sent: any = await replyToThread(
      w.org.ctx,
      t.id,
      { connectionId: w.conn.id, text: 'soon!', requestId: `y-${w.channelId}-2`, send: true },
      w.g.overrides,
    );
    expect(sent.state).toBe('SENT');
    expect(w.g.writes).toHaveLength(1);
    expect(w.g.writes[0]!.body.snippet.textOriginal).toBe('soon!');
    expect(w.g.writes[0]!.body.snippet.parentId).toMatch(/^Ug[12]$/);
    expect(w.g.writes[0]!.auth).toBe('Bearer ytok');
    await replyToThread(
      w.org.ctx,
      t.id,
      { connectionId: w.conn.id, text: 'soon!', requestId: `y-${w.channelId}-2`, send: true },
      w.g.overrides,
    );
    expect(w.g.writes).toHaveLength(1);
  });
});
