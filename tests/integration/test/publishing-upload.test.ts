import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, fileInstances, providerConnections, publicationRecords, socialAccounts } from '@creatoros/db';
import {
  AppError,
  createAsset,
  createBrand,
  createChannel,
  createProject,
  createSocialAccount,
  createVariant,
  encryptJson,
  linkPublishFile,
  publishingMatrix,
  requestPublish,
} from '@creatoros/services';
import { makeOrg, makeRoot, openDb, pairTestDevice } from '../src/helpers';

const h = openDb();
afterAll(async () => {
  await h.close();
});

const UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';

const fileBytes = () => ({
  body: new Uint8Array([1, 2, 3, 4]),
  size: 4,
  mime: 'video/mp4',
  name: 'clip.mp4',
});

describe('publishing upload', () => {
  it('links videos, sends one upload, and counts published files separately from attachments', async () => {
    const { ctx } = await makeOrg(h);
    const brand = await createBrand(ctx, { name: 'Mehak' });
    const channel = await createChannel(ctx, { brandId: brand.id, name: 'Mehak' });
    const project = await createProject(ctx, { title: 'New Song', brandId: brand.id });
    const other = await createProject(ctx, { title: 'Travel', brandId: brand.id });
    const yt = await createSocialAccount(ctx, {
      channelId: channel.id,
      platform: 'youtube',
      handle: '@mehak',
    });
    const tt = await createSocialAccount(ctx, {
      channelId: channel.id,
      platform: 'tiktok',
      handle: '@mehak',
    });
    const [conn] = await h.db
      .insert(providerConnections)
      .values({
        orgId: ctx.orgId,
        provider: 'youtube',
        principalHint: 'UC1',
        state: 'ACTIVE',
        scopes: [UPLOAD],
        encryptedTokenRef: encryptJson({ accessToken: 'ya', scopes: [UPLOAD] }, ctx.env.encryptionKey),
      })
      .returning();
    await h.db
      .update(socialAccounts)
      .set({ providerConnectionId: conn!.id })
      .where(eq(socialAccounts.id, yt.id));

    const dev = await pairTestDevice(ctx, 'windows', 'GPU-12');
    const root = await makeRoot(ctx, dev.deviceId, 'D:\\Media');
    const [clip] = await h.db
      .insert(fileInstances)
      .values({
        orgId: ctx.orgId,
        rootId: root.id,
        deviceId: dev.deviceId,
        canonicalPath: 'd:/media/clip.mp4',
        displayPath: 'D:\\Media\\clip.mp4',
        fileName: 'clip.mp4',
        ext: 'mp4',
        size: 4,
        fileType: 'VIDEO',
      })
      .returning();
    const [broll] = await h.db
      .insert(fileInstances)
      .values({
        orgId: ctx.orgId,
        rootId: root.id,
        deviceId: dev.deviceId,
        canonicalPath: 'd:/media/broll.mp4',
        displayPath: 'D:\\Media\\broll.mp4',
        fileName: 'broll.mp4',
        ext: 'mp4',
        size: 4,
        fileType: 'VIDEO',
      })
      .returning();

    const asset = await createAsset(ctx, { title: 'Song', kind: 'VIDEO' });
    const variant = await createVariant(ctx, {
      assetId: asset.id,
      titleMaster: 'Master',
      format: 'MASTER',
      projectId: project.id,
    });
    const hidden = await createVariant(ctx, {
      assetId: asset.id,
      titleMaster: 'Other title',
      format: 'MASTER',
      projectId: other.id,
    });
    const linked = await linkPublishFile(ctx, variant.id, clip!.id);
    const second = await linkPublishFile(ctx, variant.id, broll!.id);
    const again = await linkPublishFile(ctx, variant.id, clip!.id);
    expect(again.id).toBe(linked.id);

    let uploads = 0;
    let snippet: { title?: string; description?: string; tags?: string[] } | null = null;
    let privacy: string | null = null;
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      if (url.includes('uploadType=resumable')) {
        const body = JSON.parse(String(init.body));
        snippet = body.snippet;
        privacy = body.status.privacyStatus;
        return new Response('{}', { status: 200, headers: { location: 'https://upload.example/put' } });
      }
      if (url === 'https://upload.example/put') {
        uploads += 1;
        return new Response(JSON.stringify({ id: 'vid123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('unexpected', { status: 500 });
    };
    const run = { runNow: true as const, fetch: fetchImpl as typeof fetch, loadFile: async () => fileBytes() };

    const requestId = randomUUID();
    await expect(
      requestPublish(
        ctx,
        { itemId: linked.id, socialAccountId: yt.id, requestId, title: 'Live', privacy: null },
        run,
      ),
    ).rejects.toBeInstanceOf(AppError);

    const first = await requestPublish(
      ctx,
      {
        itemId: linked.id,
        socialAccountId: yt.id,
        requestId,
        title: 'Live',
        caption: 'A song',
        hashtags: ['song'],
        privacy: 'UNLISTED',
      },
      run,
    );
    expect(first.uploadState).toBe('PUBLISHED');
    expect(uploads).toBe(1);
    expect(snippet!.title).toBe('Live');
    expect(snippet!.description).toContain('A song');
    expect(snippet!.tags).toEqual(['song']);
    expect(privacy).toBe('unlisted');

    const repeat = await requestPublish(
      ctx,
      {
        itemId: linked.id,
        socialAccountId: yt.id,
        requestId,
        title: 'Live',
        caption: 'A song',
        hashtags: ['song'],
        privacy: 'UNLISTED',
      },
      run,
    );
    expect(repeat.uploadState).toBe('PUBLISHED');
    expect(uploads).toBe(1);

    await expect(
      requestPublish(
        ctx,
        {
          itemId: linked.id,
          socialAccountId: yt.id,
          requestId: randomUUID(),
          title: 'Live again',
          privacy: 'PUBLIC',
        },
        run,
      ),
    ).rejects.toMatchObject({ code: 'ALREADY_PUBLISHING' });
    expect(uploads).toBe(1);

    const recs = await h.db
      .select()
      .from(publicationRecords)
      .where(eq(publicationRecords.variantId, variant.id));
    expect(recs).toHaveLength(1);
    expect(recs[0]!.state).toBe('PUBLISHED_VERIFIED');
    expect(recs[0]!.stateProvenance).toBe('VERIFIED_PLATFORM');
    expect(recs[0]!.externalPostId).toBe('vid123');
    expect(recs[0]!.canonicalUrl).toBe('https://www.youtube.com/watch?v=vid123');
    expect(recs[0]!.fileInstanceId).toBe(clip!.id);
    expect(recs[0]!.privacy).toBe('UNLISTED');

    await expect(
      requestPublish(
        ctx,
        { itemId: second.id, socialAccountId: tt.id, requestId: randomUUID(), caption: 'hello' },
        run,
      ),
    ).rejects.toMatchObject({ code: 'CANNOT_PUBLISH' });
    expect(uploads).toBe(1);

    const offline = await requestPublish(
      ctx,
      {
        itemId: second.id,
        socialAccountId: yt.id,
        requestId: randomUUID(),
        title: 'B-roll',
        privacy: 'PRIVATE',
      },
      {
        runNow: true,
        fetch: fetchImpl as typeof fetch,
        loadFile: async () => {
          throw new AppError(503, 'DEVICE_OFFLINE', 'The machine that holds this file is offline.');
        },
      },
    );
    expect(offline.uploadState).toBe('FAILED');
    expect(offline.error).toMatch(/offline/i);
    expect(uploads).toBe(1);
    const after = await h.db
      .select()
      .from(publicationRecords)
      .where(eq(publicationRecords.variantId, variant.id));
    expect(after).toHaveLength(1);

    const matrix = await publishingMatrix(ctx, { projectId: project.id });
    expect(matrix.rows.map((r) => r.id)).toContain(variant.id);
    expect(matrix.rows.map((r) => r.id)).not.toContain(hidden.id);
    const row = matrix.rows.find((r) => r.id === variant.id)!;
    expect(row.attached).toBe(2);
    expect(row.cells.find((c) => c.accountId === yt.id)!.published).toBe(1);
    expect(row.cells.find((c) => c.accountId === tt.id)!.published).toBe(0);
  });
});
