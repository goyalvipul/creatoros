'use client';

import { useState } from 'react';
import { ActionButton, Badge, Notice } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';

const MATCH: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  VERIFIED_ID: { label: 'Verified ID match', tone: 'ok' },
  USERNAME_ONLY: { label: 'Username only: not verified', tone: 'warn' },
  UNVERIFIED: { label: 'Different name', tone: 'neutral' },
};

/** Shows how a connection maps to a Channels account; lets the owner confirm a link. Never merges silently. */
export function IdentityLink({ connectionId, identity }: { connectionId: string; identity: any }) {
  const [open, setOpen] = useState(false);
  const detail = useApi<any>(open ? `/integrations/connections/${connectionId}/identity` : null);
  const [channelId, setChannelId] = useState('');
  const reload = async () => {
    await refresh('/integrations');
    await refresh('/social-accounts');
  };
  if (!identity) return null;
  if (identity.status === 'LINKED')
    return (
      <p className="mt-2 text-xs text-muted">
        Linked to {identity.linked.brand ? `${identity.linked.brand} › ` : ''}
        {identity.linked.channel} › @{identity.linked.handle}
      </p>
    );
  const cands: any[] = identity.candidates ?? [];
  return (
    <div className="mt-2">
      <Notice tone="warn" title="Not linked to a channel account">
        This connection works, but it is not tied to a channel account yet, so imports and replies cannot use
        it.
      </Notice>
      <ActionButton onAction={async () => setOpen(!open)}>
        {open ? 'Hide' : 'Connect existing channel'}
      </ActionButton>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border p-3 text-sm">
          {cands.length === 0 && <p className="text-muted">No unlinked account exists for this platform.</p>}
          {cands.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                @{c.handle}{' '}
                <span className="text-muted">{[c.brand, c.channel].filter(Boolean).join(' › ')}</span>
              </span>
              <Badge tone={MATCH[c.match].tone}>{MATCH[c.match].label}</Badge>
              <ActionButton
                confirm={`Link @${c.handle} to this connection? This one-time confirmation stores the provider's verified account ID on it.`}
                onAction={async () => {
                  await post(`/integrations/connections/${connectionId}/link-account`, {
                    socialAccountId: c.id,
                  });
                  await reload();
                }}
                success="Linked"
              >
                Confirm link
              </ActionButton>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <label className="text-muted" htmlFor={`ch-${connectionId}`}>
              Or create the account under existing channel
            </label>
            <select
              id={`ch-${connectionId}`}
              className="rounded border border-border bg-panel px-2 py-1"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              <option value="">Choose channel…</option>
              {(detail.data?.channels ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {[c.brand, c.name].filter(Boolean).join(' › ')}
                </option>
              ))}
            </select>
            <ActionButton
              disabled={!channelId}
              onAction={async () => {
                await post(`/integrations/connections/${connectionId}/create-account`, { channelId });
                await reload();
              }}
              success="Account created and linked"
            >
              Create and link
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}
