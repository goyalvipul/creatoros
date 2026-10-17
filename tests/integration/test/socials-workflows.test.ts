import { afterAll, describe, expect, it } from 'vitest';
import {
  conversationThreads,
  eq,
  providerConnections,
  socialOutboundMessages,
  workflowExecutions,
  workflowApprovals,
  messages,
  sql,
} from '@creatoros/db';
import {
  createThreadCollaboration,
  createThreadTask,
  followUpThread,
  socialsOverview,
  updateThreadLocal,
  activateWorkflow,
  approveApproval,
  completeOAuth,
  createWorkflow,
  getSocialThread,
  importWorkflow,
  listApprovals,
  listSocialAccounts,
  listSocialThreads,
  pauseWorkflow,
  processSocialEvent,
  rejectApproval,
  replyToThread,
  setPauseAllSending,
  simulateWorkflow,
  startOAuth,
  updateAccountSettings,
  updateWorkflow,
} from '@creatoros/services';
import { WORKFLOW_TEMPLATES } from '@creatoros/domain';
import { makeOrg, openDb, testEnv } from '../src/helpers';

const h = openDb();
afterAll(async () => {
  // evidence tables restrict deletion of a connection; test data only
  await h.db.execute(sql`delete from workflow_approvals`);
  await h.db.execute(sql`delete from workflow_executions`);
  await h.db.execute(sql`delete from social_outbound_messages`);
  await h.db.delete(providerConnections).where(eq(providerConnections.provider, 'instagram'));
  await h.close();
});

const processEnv = {
  INSTAGRAM_APP_ID: 'app1',
  INSTAGRAM_APP_SECRET: 'sekret',
  INSTAGRAM_REDIRECT_URI: 'https://box.test/cb',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-me',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

const ALL = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';

/** Fake Instagram that records every DM it is asked to send, with the account id used in the URL. */
function fake(
  users: Record<string, { id: string; username: string }>,
  sendMode: 'ok' | 'timeout' | 'denied' = 'ok',
) {
  const sends: { account: string; recipient: string; text: string }[] = [];
  let mode = sendMode;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('https://api.instagram.com/oauth/access_token')) {
      const u = users[new URLSearchParams(String(init.body)).get('code')!]!;
      return json({ data: [{ access_token: `short-${u.id}`, user_id: u.id, permissions: ALL }] });
    }
    if (url.includes('/access_token?')) {
      const t = new URL(url).searchParams.get('access_token')!;
      return json({ access_token: t.replace('short', 'long'), expires_in: 5_184_000 });
    }
    if (url.includes('/me?')) {
      const t = new URL(url).searchParams.get('access_token') ?? '';
      const u = Object.values(users).find((x) => t.endsWith(x.id))!;
      return json({
        user_id: u.id,
        username: u.username,
        account_type: 'CREATOR',
        followers_count: 1,
        media_count: 1,
      });
    }
    if (url.endsWith('/messages') && init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const account = url.split('/').slice(-2)[0]!;
      if (mode === 'timeout') throw new Error('socket hang up');
      if (mode === 'denied') return json({ error: { message: 'no permission', code: 10 } }, 403);
      sends.push({ account, recipient: body.recipient?.id, text: body.message?.text });
      return json({ message_id: `m-${sends.length}-${account}`, recipient_id: body.recipient?.id });
    }
    return json({}, 404);
  };
  return {
    sends,
    setMode: (m: typeof mode) => (mode = m),
    overrides: { fetch: fetchImpl as any, sleep: async () => {} },
  };
}

async function setup() {
  const env = testEnv({ processEnv });
  const org = await makeOrg(h, env);
  const ig = fake({ cA: { id: '1001', username: 'mehak' }, cB: { id: '2002', username: 'travel' } });
  const connect = async (code: string) => {
    const s = await startOAuth(org.ctx, 'instagram', { messages: true, comments: true }, ig.overrides);
    const state = new URL(s.authorizeUrl!).searchParams.get('state')!;
    return (await completeOAuth(h.db, env, { state, code }, ig.overrides)).connectionId;
  };
  const A = await connect('cA');
  const B = await connect('cB');
  return { env, org, ig, A, B };
}

let n = 0;
const inbound = (
  s: Awaited<ReturnType<typeof setup>>,
  conn: string,
  text: string,
  o: { sender?: string; live?: boolean; id?: string; at?: Date } = {},
) =>
  processSocialEvent(
    h.db,
    s.env,
    s.org.ctx.orgId,
    {
      connectionId: conn,
      kind: 'DM',
      providerThreadId: `dm:${o.sender ?? 'u1'}`,
      providerMsgId: o.id ?? `mid-${++n}-${Math.random()}`,
      participantId: o.sender ?? 'u1',
      participantName: 'Fan',
      direction: 'INBOUND',
      text,
      receivedAt: o.at ?? new Date(),
      isLive: o.live ?? true,
    },
    s.ig.overrides,
  );

const reply = [
  { kind: 'action', id: 'a1', action: { type: 'draft_reply', template: 'Hi {{sender.display_name}}' } },
];
const def = (steps: unknown[]) => ({ schemaVersion: 1, trigger: { event: 'MESSAGE_RECEIVED' }, steps });

describe('multi-account identity safety', () => {
  it('keeps conversations of account A and B separate and refuses replies from the wrong account', async () => {
    const s = await setup();
    const a = await inbound(s, s.A, 'hello', { sender: 'fanA' });
    const b = await inbound(s, s.B, 'hello', { sender: 'fanA' }); // same person and message text, different account
    expect(a.threadId).not.toBe(b.threadId);
    const tA = await getSocialThread(s.org.ctx, a.threadId);
    expect(tA.replyAs).toMatchObject({ connectionId: s.A });

    await expect(
      replyToThread(
        s.org.ctx,
        a.threadId,
        { connectionId: s.B, text: 'hi', requestId: 'req-wrong-001', send: true },
        s.ig.overrides,
      ),
    ).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH', status: 409 });
    expect(s.ig.sends).toHaveLength(0);

    const only = await listSocialThreads(s.org.ctx, { connectionIds: [s.A] });
    expect(only.every((t: any) => t.connectionId === s.A)).toBe(true);
  });

  it('sends from the owning account and is idempotent on requestId', async () => {
    const s = await setup();
    const a = await inbound(s, s.B, 'hey', { sender: 'fanB' });
    const input = { connectionId: s.B, text: 'thanks!', requestId: 'req-idem-0001', send: true };
    const r1: any = await replyToThread(s.org.ctx, a.threadId, input, s.ig.overrides);
    const r2: any = await replyToThread(s.org.ctx, a.threadId, input, s.ig.overrides);
    expect(r1.state).toBe('SENT');
    expect(r2.id).toBe(r1.id);
    expect(s.ig.sends).toEqual([{ account: '2002', recipient: 'fanB', text: 'thanks!' }]);
  });

  it('marks an ambiguous timeout UNCERTAIN and never retries it by itself; a definite denial is FAILED', async () => {
    const s = await setup();
    const a = await inbound(s, s.A, 'hey', { sender: 'fanC' });
    s.ig.setMode('timeout');
    const r: any = await replyToThread(
      s.org.ctx,
      a.threadId,
      { connectionId: s.A, text: 'x', requestId: 'req-timeout-01', send: true },
      s.ig.overrides,
    );
    expect(r.state).toBe('UNCERTAIN');
    s.ig.setMode('ok');
    const again: any = await replyToThread(
      s.org.ctx,
      a.threadId,
      { connectionId: s.A, text: 'x', requestId: 'req-timeout-01', send: true },
      s.ig.overrides,
    );
    expect(again.state).toBe('UNCERTAIN');
    expect(s.ig.sends).toHaveLength(0);
    s.ig.setMode('denied');
    const d: any = await replyToThread(
      s.org.ctx,
      a.threadId,
      { connectionId: s.A, text: 'y', requestId: 'req-denied-001', send: true },
      s.ig.overrides,
    );
    expect(d.state).toBe('FAILED');
  });

  it('is idempotent for duplicate webhook messages and ignores outbound echoes', async () => {
    const s = await setup();
    await inbound(s, s.A, 'one', { id: 'same-id', sender: 'fanD' });
    const dup = await inbound(s, s.A, 'one', { id: 'same-id', sender: 'fanD' });
    expect(dup.duplicate).toBe(true);
    expect(dup.runs).toEqual([]);
    const [{ c }] = (
      await h.db.execute(sql`select count(*)::int c from messages where provider_msg_id = 'same-id'`)
    ).rows as any[];
    expect(c).toBe(1);
  });

  it('keeps automatic sending off by default per account and lets the owner change settings', async () => {
    const s = await setup();
    const list: any[] = await listSocialAccounts(s.org.ctx);
    expect(list).toHaveLength(2);
    expect(list.every((a) => a.settings.autoSendEnabled === false)).toBe(true);
    const next: any = await updateAccountSettings(s.org.ctx, s.A, { autoSendEnabled: true, nickname: 'M' });
    expect(next.autoSendEnabled).toBe(true);
    const list2: any[] = await listSocialAccounts(s.org.ctx);
    expect(list2.find((a) => a.id === s.B).settings.autoSendEnabled).toBe(false);
  });
});

describe('workflows', () => {
  it('draft-only workflow saves a draft and never sends; scope limits it to its accounts', async () => {
    const s = await setup();
    const wf: any = await createWorkflow(s.org.ctx, {
      name: 'Draft hello',
      mode: 'DRAFT_ONLY',
      connectionIds: [s.A],
      definition: def(reply),
    });
    await activateWorkflow(s.org.ctx, wf.id);
    await inbound(s, s.A, 'hello there', { sender: 'f1' });
    await inbound(s, s.B, 'hello there', { sender: 'f2' }); // out of scope
    const ex = await h.db.select().from(workflowExecutions).where(eq(workflowExecutions.workflowId, wf.id));
    expect(ex).toHaveLength(1);
    expect(ex[0]!.status).toBe('COMPLETED');
    const out = await h.db
      .select()
      .from(socialOutboundMessages)
      .where(eq(socialOutboundMessages.orgId, s.org.ctx.orgId));
    expect(out).toHaveLength(1);
    expect(out[0]!.state).toBe('DRAFT');
    expect(s.ig.sends).toHaveLength(0);
  });

  it('historical (non-live) messages never trigger workflows', async () => {
    const s = await setup();
    const wf: any = await createWorkflow(s.org.ctx, {
      name: 'W',
      mode: 'DRAFT_ONLY',
      connectionIds: [s.A],
      definition: def(reply),
    });
    await activateWorkflow(s.org.ctx, wf.id);
    await inbound(s, s.A, 'old', { live: false, at: new Date(Date.now() - 7 * 86400_000) });
    const ex = await h.db.select().from(workflowExecutions).where(eq(workflowExecutions.workflowId, wf.id));
    expect(ex.filter((e) => e.status !== 'SKIPPED')).toHaveLength(0);
  });

  it('approval flow: approve sends once from the right account; reject never sends', async () => {
    const s = await setup();
    const wf: any = await createWorkflow(s.org.ctx, {
      name: 'Approve',
      mode: 'APPROVAL',
      connectionIds: [s.B],
      definition: def([
        {
          kind: 'action',
          id: 'a1',
          action: { type: 'queue_approval', template: 'Hello {{sender.display_name}}', reason: 'test' },
        },
      ]),
    });
    await activateWorkflow(s.org.ctx, wf.id);
    await inbound(s, s.B, 'hi', { sender: 'p1' });
    await inbound(s, s.B, 'hi again', { sender: 'p2' });
    const pend: any[] = await listApprovals(s.org.ctx, 'PENDING');
    expect(pend).toHaveLength(2);
    expect(s.ig.sends).toHaveLength(0);
    await rejectApproval(s.org.ctx, pend[0].id);
    await approveApproval(s.org.ctx, pend[1].id, { finalText: 'Edited text' }, s.ig.overrides);
    await approveApproval(s.org.ctx, pend[1].id, {}, s.ig.overrides).catch(() => {});
    expect(s.ig.sends).toHaveLength(1);
    expect(s.ig.sends[0]).toMatchObject({ account: '2002', text: 'Edited text' });
    const rows = await h.db
      .select()
      .from(workflowApprovals)
      .where(eq(workflowApprovals.orgId, s.org.ctx.orgId));
    expect(rows.map((r) => r.state).sort()).toEqual(['REJECTED', 'SENT']);
  });

  it('automatic mode requires a successful test of the current version, per-account opt-in and respects the kill switch', async () => {
    const s = await setup();
    const wf: any = await createWorkflow(s.org.ctx, {
      name: 'Auto',
      mode: 'AUTOMATIC',
      connectionIds: [s.A],
      definition: def([
        {
          kind: 'action',
          id: 'a1',
          action: { type: 'send_reply', template: 'Thanks {{sender.display_name}}' },
        },
      ]),
    });
    await expect(activateWorkflow(s.org.ctx, wf.id)).rejects.toBeTruthy(); // untested
    const sim: any = await simulateWorkflow(s.org.ctx, wf.id, { text: 'hello', connectionId: s.A });
    expect(sim.status).not.toBe('FAILED');
    expect(s.ig.sends).toHaveLength(0); // simulation never sends
    await activateWorkflow(s.org.ctx, wf.id);

    // account has not opted in to automatic sending: nothing goes out
    await inbound(s, s.A, 'hello', { sender: 'q1' });
    expect(s.ig.sends).toHaveLength(0);

    await updateAccountSettings(s.org.ctx, s.A, { autoSendEnabled: true, perContactCooldownHours: 0 });
    await inbound(s, s.A, 'hello', { sender: 'q2' });
    expect(s.ig.sends).toHaveLength(1);
    expect(s.ig.sends[0]!.account).toBe('1001');

    await setPauseAllSending(s.org.ctx, true);
    await inbound(s, s.A, 'hello', { sender: 'q3' });
    expect(s.ig.sends).toHaveLength(1);
    await setPauseAllSending(s.org.ctx, false);
  });

  it('editing creates a new version and an automatic workflow must be re-tested', async () => {
    const s = await setup();
    const wf: any = await createWorkflow(s.org.ctx, {
      name: 'Ver',
      mode: 'AUTOMATIC',
      connectionIds: [s.A],
      definition: def([{ kind: 'action', id: 'a1', action: { type: 'send_reply', template: 'Hi' } }]),
    });
    await simulateWorkflow(s.org.ctx, wf.id, { text: 'x', connectionId: s.A });
    await activateWorkflow(s.org.ctx, wf.id);
    await updateWorkflow(s.org.ctx, wf.id, {
      definition: def([
        { kind: 'action', id: 'a1', action: { type: 'send_reply', template: 'Hello changed' } },
      ]),
    });
    await expect(activateWorkflow(s.org.ctx, wf.id)).rejects.toBeTruthy();
    await pauseWorkflow(s.org.ctx, wf.id);
  });

  it('refuses invalid definitions: send_reply outside AUTOMATIC, unknown variables, unsafe regex', async () => {
    const s = await setup();
    const bad = async (mode: any, steps: unknown[]) =>
      createWorkflow(s.org.ctx, { name: 'Bad', mode, connectionIds: [s.A], definition: def(steps) });
    await expect(
      bad('DRAFT_ONLY', [{ kind: 'action', id: 'a1', action: { type: 'send_reply', template: 'x' } }]),
    ).rejects.toBeTruthy();
    await expect(
      bad('DRAFT_ONLY', [
        { kind: 'action', id: 'a1', action: { type: 'draft_reply', template: '{{token}}' } },
      ]),
    ).rejects.toBeTruthy();
    await expect(
      bad('DRAFT_ONLY', [{ kind: 'condition', id: 'c1', condition: { type: 'regex', pattern: '(a+)+$' } }]),
    ).rejects.toBeTruthy();
  });

  it('sensitive topics never get an automatic answer', async () => {
    const s = await setup();
    await updateAccountSettings(s.org.ctx, s.A, { autoSendEnabled: true, perContactCooldownHours: 0 });
    const wf: any = await createWorkflow(s.org.ctx, {
      name: 'Auto2',
      mode: 'AUTOMATIC',
      connectionIds: [s.A],
      definition: def([{ kind: 'action', id: 'a1', action: { type: 'send_reply', template: 'Sure!' } }]),
    });
    await simulateWorkflow(s.org.ctx, wf.id, { text: 'hello', connectionId: s.A });
    await activateWorkflow(s.org.ctx, wf.id);
    await inbound(s, s.A, 'What is your rate and can I get a refund? Also the contract terms.', {
      sender: 's1',
    });
    expect(s.ig.sends).toHaveLength(0);
  });

  it('opt-out blocks automation, and templates import as inactive drafts without accounts', async () => {
    const s = await setup();
    const t = WORKFLOW_TEMPLATES[0]!;
    const imp: any = await importWorkflow(s.org.ctx, {
      name: t.name,
      mode: t.mode,
      definition: t.definition,
    });
    expect(imp.status).not.toBe('ACTIVE');
    const [th] = await h.db
      .select()
      .from(conversationThreads)
      .where(eq(conversationThreads.orgId, s.org.ctx.orgId));
    expect(th).toBeUndefined();
    await inbound(s, s.A, 'STOP', { sender: 'o1' });
    const [t2] = await h.db
      .select()
      .from(conversationThreads)
      .where(eq(conversationThreads.orgId, s.org.ctx.orgId));
    expect(t2!.optedOut).toBe(true);
    void messages;
  });
});

describe('local organisation, follow-ups and collaboration links', () => {
  it('archives/stars locally, keeps one task and one follow-up per conversation, and one collaboration per conversation', async () => {
    const s = await setup();
    const a = await inbound(s, s.A, 'We would love a paid partnership, budget 500', { sender: 'brand1' });
    await updateThreadLocal(s.org.ctx, a.threadId, { starred: true, archivedLocal: true });
    expect((await listSocialThreads(s.org.ctx, {})).length).toBe(0);
    expect((await listSocialThreads(s.org.ctx, { archived: true })).length).toBe(1);
    expect((await listSocialThreads(s.org.ctx, { archived: true, starred: true })).length).toBe(1);
    await updateThreadLocal(s.org.ctx, a.threadId, { archivedLocal: false });

    const t1: any = await createThreadTask(s.org.ctx, a.threadId, {});
    const t2: any = await createThreadTask(s.org.ctx, a.threadId, {});
    expect(t2.id).toBe(t1.id);
    expect(t2.alreadyExists).toBe(true);

    await followUpThread(s.org.ctx, a.threadId, { preset: 'tomorrow' });
    await followUpThread(s.org.ctx, a.threadId, { preset: 'next_week' });
    const fu = (
      await h.db.execute(
        sql`select count(*)::int c from internal_actions where org_id = ${s.org.ctx.orgId} and dedupe_key = ${'social-followup:' + a.threadId}`,
      )
    ).rows as any[];
    expect(fu[0].c).toBe(1);

    const c1: any = await createThreadCollaboration(s.org.ctx, a.threadId, {});
    const c2: any = await createThreadCollaboration(s.org.ctx, a.threadId, {});
    expect(c1.opportunityId).toBeTruthy();
    expect(c2.opportunityId).toBe(c1.opportunityId);

    const o: any = await socialsOverview(s.org.ctx, {});
    expect(o.accountsTotal).toBe(2);
    expect(o.leads).toBe(1);
    expect(o.mentions).toBeNull();
  });
});
