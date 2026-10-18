import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { eq, invoices, providerConnections, sql } from '@creatoros/db';
import {
  acceptInvoiceSuggestion,
  createInvoice,
  deleteInvoice,
  dismissInvoiceSuggestion,
  encryptJson,
  followUpThread,
  ingestMessage,
  ingestSocialEvent,
  listInvoiceSuggestions,
  listThreads,
  mailAccounts,
  moveMailThread,
  recordPayment,
  replyToEmail,
  scanEmailInvoices,
  updateInvoice,
  updateThreadLocal,
  createThreadTask,
} from '@creatoros/services';
import { makeOrg, openDb } from '../src/helpers';

const h = openDb();
/** Connections are removed (with their outbound rows, which restrict deletion) so the worker sync test never sees fake tokens. */
const made: string[] = [];
async function cleanup() {
  for (const id of made.splice(0)) {
    await h.db.execute(sql`delete from social_outbound_messages where connection_id = ${id}::uuid`);
    await h.db.delete(providerConnections).where(eq(providerConnections.id, id));
  }
}
afterAll(async () => {
  await cleanup();
  await h.close();
});

const SEND = 'https://www.googleapis.com/auth/gmail.send';
const READ = 'https://www.googleapis.com/auth/gmail.readonly';

async function gmail(ctx: any, email: string, scopes: string[], withToken = false) {
  const [c] = await h.db
    .insert(providerConnections)
    .values({
      orgId: ctx.orgId,
      provider: 'gmail',
      label: email,
      principalHint: email,
      state: 'ACTIVE',
      scopes,
      encryptedTokenRef: withToken
        ? encryptJson({ accessToken: 't', expiresAt: Date.now() + 3_600_000, scopes }, ctx.env.encryptionKey)
        : null,
    })
    .returning();
  made.push(c!.id);
  return c!;
}

async function mail(ctx: any, conn: any, id: string, o: Record<string, unknown> = {}) {
  return ingestMessage(ctx, {
    source: 'GMAIL',
    principal: conn.principalHint,
    providerThreadId: `th-${id}`,
    providerMsgId: `msg-${id}`,
    direction: 'INBOUND',
    receivedAt: new Date(),
    fromEmail: `brand-${id}@acme.com`,
    fromName: 'Acme Brand',
    toEmails: [conn.principalHint],
    subject: `Hello ${id}`,
    body: 'Hi there',
    providerConnectionId: conn.id,
    ...o,
  } as any);
}

describe('email inbox: accounts, tabs, moves, tasks', () => {
  it('names each mailbox, hides social threads and keeps tab counts consistent', async () => {
    const { ctx } = await makeOrg(h);
    const a = await gmail(ctx, 'a@example.com', [READ]);
    const b = await gmail(ctx, 'b@example.com', [READ, SEND]);
    const ta = (await mail(ctx, a, 'a1')).threadId;
    const tb = (await mail(ctx, b, 'b1')).threadId;
    await mail(ctx, b, 'b2');
    const [ig] = await h.db
      .insert(providerConnections)
      .values({ orgId: ctx.orgId, provider: 'instagram', label: 'ig', principalHint: 'ig1', state: 'ACTIVE' })
      .returning();
    made.push(ig!.id);
    await ingestSocialEvent(ctx, {
      connectionId: ig!.id,
      kind: 'DM',
      providerThreadId: 'dm:x',
      providerMsgId: 'ig-m1',
      participantId: 'x',
      participantName: 'x',
      direction: 'INBOUND',
      text: 'hey',
      receivedAt: new Date(),
      isLive: false,
    });

    const acc = await mailAccounts(ctx);
    expect(acc.accounts.map((x) => x.label).sort()).toEqual(['a@example.com', 'b@example.com']);
    expect(acc.accounts.find((x) => x.email === 'b@example.com')).toMatchObject({ canSend: true });
    expect(acc.accounts.find((x) => x.email === 'a@example.com')).toMatchObject({ canSend: false });
    expect(acc.totals.inbox).toBe(3); // the Instagram DM is not counted

    expect(await listThreads(ctx, { scope: 'mail' })).toHaveLength(3);
    expect(await listThreads(ctx, { scope: 'mail', connectionId: b.id })).toHaveLength(2);

    await updateThreadLocal(ctx, tb, { starred: true }, { mail: true });
    expect((await listThreads(ctx, { scope: 'mail', folder: 'starred' })).map((t) => t.id)).toEqual([tb]);
    // social threads are refused by the email routes
    const igThread = (await listThreads(ctx, { scope: 'all' })).find((t) => t.source === 'INSTAGRAM');
    await expect(
      updateThreadLocal(ctx, igThread.id, { starred: true }, { mail: true }),
    ).rejects.toMatchObject({
      status: 404,
    });

    await moveMailThread(ctx, ta, 'ARCHIVE');
    expect((await listThreads(ctx, { scope: 'mail', folder: 'archived' })).map((t) => t.id)).toEqual([ta]);
    expect((await mailAccounts(ctx)).totals).toMatchObject({ inbox: 2, archived: 1, starred: 1 });
    await moveMailThread(ctx, ta, 'INBOX');
    expect((await mailAccounts(ctx)).totals).toMatchObject({ inbox: 3, archived: 0 });

    const r: any = await moveMailThread(ctx, ta, 'PIPELINE');
    expect(r.opportunityId).toBeTruthy();
    expect((await listThreads(ctx, { scope: 'mail', folder: 'pipeline' })).map((t) => t.id)).toEqual([ta]);
    expect((await mailAccounts(ctx)).totals).toMatchObject({ inbox: 2, pipeline: 1 });
    await expect(moveMailThread(ctx, ta, 'INBOX')).rejects.toMatchObject({ code: 'IN_PIPELINE' });
    const again: any = await moveMailThread(ctx, ta, 'PIPELINE');
    expect(again.opportunityId).toBe(r.opportunityId);
  });

  it('creates one task and one follow-up per email, linked back to the email', async () => {
    const { ctx } = await makeOrg(h);
    const a = await gmail(ctx, 'tasks@example.com', [READ]);
    const t = (await mail(ctx, a, 't1')).threadId;
    const task: any = await createThreadTask(ctx, t, {}, { mail: true });
    expect(task.deepLink).toBe(`/collaborations/threads/${t}`);
    expect((await createThreadTask(ctx, t, {}, { mail: true })).alreadyExists).toBe(true);
    await followUpThread(ctx, t, { preset: 'tomorrow' }, { mail: true });
    await followUpThread(ctx, t, { preset: 'next_week' }, { mail: true });
    const n = await h.db.execute(
      sql`select count(*)::int as n from internal_actions where org_id = ${ctx.orgId} and source_id = ${t}`,
    );
    expect((n.rows[0] as any).n).toBe(2);
    expect((await listThreads(ctx, { scope: 'mail', folder: 'followup' })).map((x) => x.id)).toEqual([t]);
  });
});

describe('replying to an email', () => {
  afterEach(cleanup);
  const okJson = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  function fakeGmail(failSend?: number) {
    const sent: any[] = [];
    const fetch = async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/messages/send')) {
        if (failSend) return new Response('{"error":{"message":"nope"}}', { status: failSend });
        const body = JSON.parse(init.body);
        sent.push(body);
        return okJson({ id: `sent-${sent.length}`, threadId: 'th-r1' });
      }
      if (u.includes('/messages/')) {
        return okJson({
          id: 'msg-r1',
          payload: {
            headers: [
              { name: 'Message-ID', value: '<abc@mail.example>' },
              { name: 'Reply-To', value: 'Partner <partner@acme.com>' },
            ],
          },
        });
      }
      return new Response('{}', { status: 404 });
    };
    return { fetch: fetch as any, sleep: async () => {}, sent };
  }

  it('refuses without the send permission', async () => {
    const { ctx } = await makeOrg(h);
    const c = await gmail(ctx, 'ro@example.com', [READ], true);
    const t = (await mail(ctx, c, 'r0')).threadId;
    await expect(
      replyToEmail(ctx, t, { text: 'hi', requestId: 'req-ro-0001' }, fakeGmail()),
    ).rejects.toMatchObject({ code: 'SEND_NOT_GRANTED' });
  });

  it('sends once in the same thread, records it, and is idempotent on requestId', async () => {
    const { ctx } = await makeOrg(h);
    const c = await gmail(ctx, 'rw@example.com', [READ, SEND], true);
    const t = (await mail(ctx, c, 'r1')).threadId;
    const f = fakeGmail();
    const r = await replyToEmail(ctx, t, { text: 'Thanks, yes!', requestId: 'req-rw-0001' }, f);
    expect(r).toMatchObject({ state: 'SENT', to: 'partner@acme.com', duplicate: false });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].threadId).toBe('th-r1');
    const raw = Buffer.from(f.sent[0].raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: partner@acme.com');
    expect(raw).toContain('In-Reply-To: <abc@mail.example>');
    const again = await replyToEmail(ctx, t, { text: 'Thanks, yes!', requestId: 'req-rw-0001' }, f);
    expect(again.duplicate).toBe(true);
    expect(f.sent).toHaveLength(1);
    const th: any = (await listThreads(ctx, { scope: 'mail' })).find((x) => x.id === t);
    expect(th.state).toBe('WAITING_FOR_BRAND');
  });

  it('marks a refused send FAILED and an unknown outcome UNCERTAIN, never retrying', async () => {
    const { ctx } = await makeOrg(h);
    const c = await gmail(ctx, 'fail@example.com', [READ, SEND], true);
    const t = (await mail(ctx, c, 'r2')).threadId;
    const f = fakeGmail(403);
    await expect(replyToEmail(ctx, t, { text: 'x', requestId: 'req-f-0001' }, f)).rejects.toMatchObject({
      code: 'SEND_FAILED',
    });
    const f2 = fakeGmail(503);
    await expect(replyToEmail(ctx, t, { text: 'x', requestId: 'req-f-0002' }, f2)).rejects.toMatchObject({
      code: 'SEND_UNCERTAIN',
    });
  });
});

describe('invoices from email, and invoice edit/delete', () => {
  it('suggests invoices from email text and lets the owner accept or dismiss them', async () => {
    const { ctx } = await makeOrg(h);
    const c = await gmail(ctx, 'inv@example.com', [READ]);
    await mail(ctx, c, 'i1', {
      subject: 'Invoice INV-2026-0042',
      body: 'Please find attached the invoice.\nTotal due: $1,200.00 USD\nDue date: Dec 1, 2026',
    });
    await mail(ctx, c, 'i2', { subject: 'Hello', body: 'just saying hi' });
    await mail(ctx, c, 'i3', {
      subject: 'Invoice #77 for studio rental',
      body: 'Amount due: CAD 90.00',
    });
    const scan = await scanEmailInvoices(ctx, {});
    expect(scan.found).toBe(2);
    expect((await scanEmailInvoices(ctx, {})).found).toBe(0); // idempotent
    const list = await listInvoiceSuggestions(ctx);
    expect(list).toHaveLength(2);
    const big = list.find((s) => s.invoiceNo === 'INV-2026-0042')!;
    expect(big).toMatchObject({ amountMinor: 120000, currency: 'USD', direction: 'BILL_TO_ME' });
    const small = list.find((s) => s.amountMinor === 9000)!;

    const acc: any = await acceptInvoiceSuggestion(ctx, big.id, { as: 'INVOICE' });
    expect(acc.acceptedInvoiceId).toBeTruthy();
    await expect(acceptInvoiceSuggestion(ctx, big.id, { as: 'INVOICE' })).rejects.toMatchObject({
      code: 'ALREADY_HANDLED',
    });
    const exp: any = await acceptInvoiceSuggestion(ctx, small.id, { as: 'EXPENSE' });
    expect(exp.acceptedExpenseId).toBeTruthy();
    expect(await listInvoiceSuggestions(ctx)).toHaveLength(0);

    await mail(ctx, c, 'i4', { subject: 'Invoice 5005', body: 'Total: $5.00' });
    await scanEmailInvoices(ctx, {});
    const [s4] = await listInvoiceSuggestions(ctx);
    await dismissInvoiceSuggestion(ctx, s4.id);
    expect(await listInvoiceSuggestions(ctx)).toHaveLength(0);
    expect((await scanEmailInvoices(ctx, {})).found).toBe(0); // dismissed stays dismissed
  });

  it('edits and deletes invoices safely', async () => {
    const { ctx } = await makeOrg(h);
    const inv = await createInvoice(ctx, { amountMinor: 10000, currency: 'CAD', invoiceNo: 'E-1' });
    const edited = await updateInvoice(ctx, inv.id, {
      amountMinor: 12000,
      notes: 'revised',
      invoiceNo: 'E-1b',
    });
    expect(edited).toMatchObject({ amountMinor: 12000, invoiceNo: 'E-1b', notes: 'revised' });
    await createInvoice(ctx, { amountMinor: 100, invoiceNo: 'E-2' });
    await expect(updateInvoice(ctx, inv.id, { invoiceNo: 'E-2' })).rejects.toMatchObject({
      code: 'DUPLICATE_INVOICE_NO',
    });
    await recordPayment(ctx, inv.id, { amountMinor: 5000 });
    await expect(updateInvoice(ctx, inv.id, { amountMinor: 4000 })).rejects.toMatchObject({
      code: 'BELOW_PAID',
    });
    await expect(updateInvoice(ctx, inv.id, { currency: 'USD' })).rejects.toMatchObject({
      code: 'HAS_PAYMENTS',
    });
    await expect(deleteInvoice(ctx, inv.id)).rejects.toMatchObject({ code: 'HAS_PAYMENTS' });
    // editing the amount down to exactly what was paid settles it
    expect((await updateInvoice(ctx, inv.id, { amountMinor: 5000 })).status).toBe('PAID');
    const plain = await createInvoice(ctx, { amountMinor: 700, invoiceNo: 'E-3' });
    expect(await deleteInvoice(ctx, plain.id)).toMatchObject({ deleted: true });
    const gone = await h.db.select().from(invoices).where(eq(invoices.id, plain.id));
    expect(gone).toHaveLength(0);
  });
});

describe('gmail stars and deep invoice search', () => {
  afterEach(cleanup);
  it('marks existing threads starred from Gmail, imports missing starred mail, and finds invoices with full text', async () => {
    const { ctx } = await makeOrg(h);
    const c = await gmail(ctx, 'deep@example.com', [READ], true);
    const old = (await mail(ctx, c, 'old1', { subject: 'Old thread' })).threadId;
    const body = (s: string) => Buffer.from(s).toString('base64url');
    const msgs: Record<string, any> = {
      'msg-old1': { id: 'msg-old1', threadId: 'th-old1' },
      'msg-new-star': {
        id: 'msg-new-star',
        threadId: 'th-new-star',
        labelIds: ['INBOX', 'STARRED'],
        internalDate: String(Date.now()),
        payload: {
          headers: [
            { name: 'Subject', value: 'Starred new' },
            { name: 'From', value: 'A <a@x.com>' },
          ],
        },
      },
      'msg-inv': {
        id: 'msg-inv',
        threadId: 'th-inv',
        labelIds: ['INBOX', 'CATEGORY_UPDATES'],
        internalDate: String(Date.now()),
        snippet: 'Your invoice',
        payload: {
          headers: [
            { name: 'Subject', value: 'Your invoice from Studio' },
            { name: 'From', value: 'Studio <billing@studio.com>' },
          ],
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: body('Invoice INV-9001\nAmount due: $450.00 USD\nDue date: 2026-12-01') },
            },
            {
              mimeType: 'application/pdf',
              filename: 'Invoice-9001.pdf',
              body: { attachmentId: 'a1', size: 10 },
            },
          ],
        },
      },
    };
    const fetch = (async (url: any) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/messages')) {
        const q = u.searchParams.get('q') ?? '';
        const ids = q.includes('is:starred') ? ['msg-old1', 'msg-new-star'] : ['msg-inv'];
        return new Response(
          JSON.stringify({ messages: ids.map((i) => ({ id: i, threadId: msgs[i].threadId })) }),
          {
            status: 200,
          },
        );
      }
      const id = decodeURIComponent(u.pathname.split('/').pop()!);
      return new Response(JSON.stringify(msgs[id]), { status: 200 });
    }) as any;
    const [conn] = await h.db.select().from(providerConnections).where(eq(providerConnections.id, c.id));
    const {
      syncGmailStars,
      syncGmailInvoices,
      listInvoiceSuggestions: list,
    } = await import('@creatoros/services');
    const st = await syncGmailStars(ctx, conn!, { fetch });
    expect(st).toMatchObject({ starredInGmail: 2, newlyStarred: 2, imported: 1 });
    const starred = await listThreads(ctx, { scope: 'mail', folder: 'starred' });
    expect(starred).toHaveLength(2);
    expect(starred.map((t) => t.id)).toContain(old);

    const inv = await syncGmailInvoices(ctx, conn!, { deep: true }, { fetch });
    expect(inv).toMatchObject({ candidates: 1, checked: 1, found: 1 });
    const [s] = await list(ctx);
    expect(s).toMatchObject({ invoiceNo: 'INV-9001', amountMinor: 45000, currency: 'USD' });
    // the invoice-only thread did not flood the Inbox
    const inbox = await listThreads(ctx, { scope: 'mail', folder: 'inbox' });
    expect(inbox.map((t) => t.id)).not.toContain(s.threadId);
    // idempotent
    expect((await syncGmailInvoices(ctx, conn!, { deep: true }, { fetch })).found).toBe(0);
  });
});
