'use client';

import { useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { post, useApi } from '@/lib/api';

const path = '/integrations/ai-gateway/events';
type Subscription = {
  id: string;
  verifiedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastDelivery: string | null;
  lastAcknowledgement: string | null;
};
type Diagnostic = {
  id: string;
  createdAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
  httpStatus: number | null;
  attempts: number;
};
const stamp = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');

export function McpEventsCard() {
  const { data, error, mutate } = useApi<{
    configured: boolean;
    enabled: boolean;
    subscriptions: Subscription[];
    verificationError: { code: string; failedAt: string } | null;
    history: Diagnostic[];
  }>(path, { refreshInterval: 5000 });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [queued, setQueued] = useState<string>();
  const [selected, setSelected] = useState('');
  const active =
    data?.enabled && data.configured
      ? data.subscriptions.filter((item) => !item.revokedAt && Date.parse(item.expiresAt) > Date.now())
      : [];
  const subscriptionId = active.find((item) => item.id === selected)?.id ?? active[0]?.id ?? '';
  const send = async () => {
    setSending(true);
    setSendError(undefined);
    setQueued(undefined);
    try {
      const result = await post<{ requestId: string }>(path + '/send', {
        subscriptionId,
        requestId: crypto.randomUUID(),
      });
      setQueued(result.requestId);
      await mutate();
    } catch (failure) {
      setSendError(failure instanceof Error ? failure.message : 'Diagnostic request failed.');
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="mt-4 space-y-2 border-t border-border pt-3" aria-labelledby="mcp-events-title">
      <h3 id="mcp-events-title" className="font-semibold">
        MCP Events
      </h3>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error.message}
        </p>
      )}
      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge tone={data.enabled ? 'ok' : 'warn'}>
              {!data.configured
                ? 'Site event identity not configured'
                : data.enabled
                  ? 'Diagnostic scopes enabled'
                  : 'Diagnostic scopes inactive'}
            </Badge>
            <Badge>{active.length} active subscriptions</Badge>
            <Badge>
              {data.history.filter((item) => !item.completedAt && !item.failedAt).length} recent pending
            </Badge>
            <Badge>{data.history.filter((item) => item.failedAt).length} recent failed</Badge>
          </div>
          {data.verificationError && (
            <p role="alert" className="text-sm text-bad">
              Callback verification failed {stamp(data.verificationError.failedAt)} ·{' '}
              {data.verificationError.code}
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm">Subscriptions</summary>
            {data.subscriptions.length === 0 && <p className="text-sm text-muted">No verified callbacks.</p>}
            {data.subscriptions.map((item) => (
              <div key={item.id} className="mt-2 text-xs">
                <p>
                  {item.id.slice(0, 12)} ·{' '}
                  {item.revokedAt
                    ? 'Revoked'
                    : Date.parse(item.expiresAt) <= Date.now()
                      ? 'Expired'
                      : 'Verified callback'}
                </p>
                <p>
                  Verified {stamp(item.verifiedAt)} · Expires {stamp(item.expiresAt)}
                </p>
                <p>
                  Last delivery {stamp(item.lastDelivery)} · Last acknowledgement{' '}
                  {stamp(item.lastAcknowledgement)}
                </p>
              </div>
            ))}
          </details>
          {active.length > 1 && (
            <label className="block text-sm">
              Subscription
              <select
                value={subscriptionId}
                onChange={(event) => setSelected(event.target.value)}
                className="ml-2"
              >
                {active.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id.slice(0, 12)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button disabled={sending || !subscriptionId} onClick={() => void send()}>
            {sending ? 'Queuing…' : 'Send Diagnostic'}
          </Button>
          {queued && (
            <p role="status" className="break-all text-xs">
              Queued {queued}
            </p>
          )}
          {sendError && (
            <p role="alert" className="text-sm text-bad">
              {sendError}
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm">Diagnostic execution history</summary>
            {data.history.length === 0 && <p className="text-sm text-muted">No diagnostic requests.</p>}
            {data.history.map((item) => (
              <div key={item.id} className="mt-2 break-all text-xs">
                <p>
                  {item.id} ·{' '}
                  {item.completedAt
                    ? 'Completed'
                    : item.failedAt
                      ? 'Failed'
                      : item.deliveredAt
                        ? 'Awaiting acknowledgement'
                        : item.dispatchedAt
                          ? 'Dispatched'
                          : 'Queued'}
                </p>
                <p>
                  Created {stamp(item.createdAt)} · Dispatched {stamp(item.dispatchedAt)} · Delivered{' '}
                  {stamp(item.deliveredAt)}
                </p>
                <p>
                  Acknowledged {stamp(item.acknowledgedAt)} · Completed {stamp(item.completedAt)} · Attempts{' '}
                  {item.attempts}
                </p>
                {item.errorCode && (
                  <p className="text-bad">
                    {item.errorCode}
                    {item.httpStatus ? ` (HTTP ${item.httpStatus})` : ''}
                  </p>
                )}
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
