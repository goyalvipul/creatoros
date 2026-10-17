'use client';

import { useState } from 'react';
import { ActionButton, Async, Badge, Card, EmptyState, PageHeader, Textarea } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { ago } from '@/lib/format';

function Item({ a }: { a: any }) {
  const [text, setText] = useState(a.finalText ?? a.proposedText);
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
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton
          variant="primary"
          success="Approved"
          confirm={`Send this as @${a.accountUsername}?`}
          onAction={async () => {
            await post(`/workflows/approvals/${a.id}/approve`, { finalText: text });
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
  const res = useApi<any[]>('/workflows/approvals');
  return (
    <div>
      <PageHeader
        title="Approval queue"
        subtitle="Nothing here is sent until you approve it. Eligibility is checked again at approval time."
      />
      <Async res={res} empty={<EmptyState title="Nothing waiting for approval" />}>
        {(rows) => (
          <ul className="space-y-3">
            {rows.map((a) => (
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
