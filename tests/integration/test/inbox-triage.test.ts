import { afterAll, describe, expect, it } from 'vitest';
import { eq, providerConnections, sql } from '@creatoros/db';
import {
  backfillReplyCategories,
  encryptJson,
  ingestSocialEvent,
  listSocialThreads,
  socialThreadCounts,
} from '@creatoros/services';
import { makeOrg, openDb } from '../src/helpers';

const h = openDb();
afterAll(async () => {
  await h.db.delete(providerConnections).where(eq(providerConnections.provider, 'instagram'));
  await h.close();
});

describe('inbox counts and reply triage', () => {
  it('counts views and "what to reply to" categories from the same data as the list', async () => {
    const org = await makeOrg(h);
    const ctx = org.ctx;
    const acct = `17${Math.floor(Math.random() * 1e12)}`;
    const [conn] = await h.db
      .insert(providerConnections)
      .values({
        orgId: ctx.orgId,
        provider: 'instagram',
        label: '@triage',
        principalHint: acct,
        state: 'ACTIVE',
        scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
        config: { username: 'triage' },
        encryptedTokenRef: encryptJson({ accessToken: 't' }, ctx.env.encryptionKey),
      })
      .returning();
    const msgs = [
      ['u1', 'What camera do you use?'],
      ['u2', 'love your voice'],
      ['u3', 'Hi we are a brand, paid collab? mail brand@studio.com'],
      ['u4', 'follow back https://spam.example'],
      ['u5', '🔥🔥'],
    ];
    for (const [id, text] of msgs)
      await ingestSocialEvent(ctx, {
        connectionId: conn!.id,
        kind: 'DM',
        providerThreadId: `dm:${id}`,
        providerMsgId: `m-${acct}-${id}`,
        participantId: id!,
        participantName: id,
        direction: 'INBOUND',
        text: text!,
        receivedAt: new Date(),
        isLive: false,
      });
    const c: any = await socialThreadCounts(ctx, { connectionIds: [conn!.id] });
    expect(c).toMatchObject({ all: 5, needReply: 5, starred: 0, archived: 0 });
    expect(c.reply).toMatchObject({ QUESTION: 1, COMPLIMENT: 1, BUSINESS: 1, SPAM: 1, EMOJI: 1 });

    const q = await listSocialThreads(ctx, { connectionIds: [conn!.id], category: 'QUESTION' });
    expect(q).toHaveLength(1);
    expect((q[0] as any).replyCategory).toBe('QUESTION');

    await h.db.execute(sql`update conversation_threads set starred = true where id = ${(q[0] as any).id}`);
    expect(((await socialThreadCounts(ctx, { connectionIds: [conn!.id] })) as any).starred).toBe(1);
    expect(await listSocialThreads(ctx, { connectionIds: [conn!.id], starred: true })).toHaveLength(1);

    // older threads without a category are filled from their latest inbound message
    await h.db.execute(
      sql`update conversation_threads set reply_category = null where org_id = ${ctx.orgId}`,
    );
    expect((await backfillReplyCategories(ctx)).updated).toBe(5);
    expect(((await socialThreadCounts(ctx, { connectionIds: [conn!.id] })) as any).reply.BUSINESS).toBe(1);
  });
});
