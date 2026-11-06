'use client';

import { ActionButton, Async, Badge, Card, EmptyState, PageHeader, Textarea } from '@/components/ui';
import { ApiError, post, refresh, useApi } from '@/lib/api';
import { approveAllResult, ignoreAllResult, ignoreApprovals, sendApprovals } from '@/lib/approve-all';
import { ago } from '@/lib/format';

type Approval = {
  id: string;
  accountUsername: string | null;
  participantName: string | null;
  recipientId: string;
  workflowName: string;
  createdAt: string;
  originalMessage: string | null;
  reason: string | null;
  finalText: string | null;
  proposedText: string;
};

const drafts = new Map<string, string>();

function replyText(a: Approval): string {
  return drafts.get(a.id) ?? a.finalText ?? a.proposedText ?? '';
}

function Item({ a }: { a: Approval }) {
  const initial = a.finalText ?? a.proposedText ?? '';
  if (!drafts.has(a.id)) drafts.set(a.id, initial);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>@{a.accountUsername}</Badge>
        <span className="text-muted">to</span>
        <strong>{a.participantName ?? a.recipientId}</strong>
        <span className="text-xs text-muted">
          · {a.workflowName} · {ago(a.createdAt)}
        </span>
      </div>
      <p className="mt-2 rounded-lg bg-panel2 p-2 text-sm">{a.originalMessage}</p>
      {a.reason && <p className="mt-1 text-xs text-muted">Why: {a.reason}</p>}
      <Textarea
        aria-label="Proposed reply"
        className="mt-2"
        rows={3}
        maxLength={1000}
        defaultValue={initial}
        onChange={(e) => drafts.set(a.id, e.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton
          variant="primary"
          success="Approved"
          confirm={`Send this as @${a.accountUsername}?`}
          onAction={async () => {
            await post(`/workflows/approvals/${a.id}/approve`, { finalText: replyText(a) });
            drafts.delete(a.id);
            await refresh('/workflows');
          }}
        >
          Approve and send
        </ActionButton>
        <ActionButton
          onAction={async () => {
            await post(`/workflows/approvals/${a.id}/snooze`, { hours: 24 });
            await refresh('/workflows');
          }}
        >
          Snooze 24 h
        </ActionButton>
        <ActionButton
          variant="danger"
          onAction={async () => {
            await post(`/workflows/approvals/${a.id}/reject`);
            drafts.delete(a.id);
            await refresh('/workflows');
          }}
        >
          Reject
        </ActionButton>
      </div>
    </Card>
  );
}

export default function Approvals() {
  const res = useApi<Approval[]>('/workflows/approvals');
  const rows = res.data ?? [];
  return (
    <div>
      <PageHeader
        title="Approval queue"
        subtitle="Nothing here is sent until you approve it. Eligibility is checked again at approval time."
        actions={
          rows.length > 0 ? (
            <>
              <ActionButton
                variant="danger"
                success={`Ignored ${rows.length}`}
                confirm={`Ignore all ${rows.length} waiting replies? Nothing is sent, and they leave the queue.`}
                onAction={async () => {
                  const result = await ignoreApprovals(
                    rows.map((a) => ({ id: a.id, label: a.participantName ?? a.recipientId })),
                    async (id) => {
                      await post(`/workflows/approvals/${id}/reject`);
                      drafts.delete(id);
                    },
                  );
                  await refresh('/workflows');
                  const note = ignoreAllResult(result.ignored, result.failed);
                  if (note) throw new ApiError(409, 'PARTIAL', note);
                }}
              >
                Ignore all
              </ActionButton>
              {rows.length > 1 ? (
                <ActionButton
                  variant="primary"
                  success={`Sent ${rows.length}`}
                  confirm={`Send all ${rows.length} replies now? Each box is sent as it is written.`}
                  onAction={async () => {
                    const result = await sendApprovals(
                      rows.map((a) => ({
                        id: a.id,
                        text: replyText(a),
                        label: a.participantName ?? a.recipientId,
                      })),
                      async (item) => {
                        await post(`/workflows/approvals/${item.id}/approve`, { finalText: item.text });
                        drafts.delete(item.id);
                      },
                    );
                    await refresh('/workflows');
                    const note = approveAllResult(result.sent, result.failed);
                    if (note) throw new ApiError(409, 'PARTIAL', note);
                  }}
                >
                  Approve all and send
                </ActionButton>
              ) : null}
            </>
          ) : null
        }
      />
      <Async res={res} empty={<EmptyState title="Nothing waiting for approval" />}>
        {(list) => (
          <ul className="space-y-3">
            {list.map((a) => (
              <li key={a.id}>
                <Item a={a} />
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}
