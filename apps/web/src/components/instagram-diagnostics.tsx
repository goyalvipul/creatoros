'use client';

import { ActionButton, Async, Badge, Card, CardTitle } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { when } from '@/lib/format';

const TONE: Record<string, 'ok' | 'bad' | 'warn' | 'neutral'> = {
  BLOCKED_BY_META: 'bad',
  DATA_RECEIVED: 'ok',
  REACHABLE: 'neutral',
  REACHABLE_NO_DATA: 'warn',
  IMPORTED: 'ok',
  END_TO_END: 'ok',
  INCOMPLETE: 'warn',
  RECEIVED_OTHER: 'warn',
  VERIFIED_LIVE: 'ok',
  FAILED: 'bad',
  NOT_RUN: 'neutral',
  NOT_RECEIVED: 'warn',
  YES_CODE_MOCK_TESTED: 'warn',
  NO: 'neutral',
};
const WORDS: Record<string, string> = {
  BLOCKED_BY_META: 'Blocked by Meta',
  DATA_RECEIVED: 'Data received',
  REACHABLE: 'API reachable',
  REACHABLE_NO_DATA: 'Reachable, no data',
  IMPORTED: 'Imported successfully',
  END_TO_END: 'Imported + webhook verified',
  INCOMPLETE: 'Incomplete',
  RECEIVED_OTHER: 'Received, other account',
  VERIFIED_LIVE: 'Webhook delivery verified',
  FAILED: 'Failed',
  NOT_RUN: 'Not run',
  NOT_RECEIVED: 'Not received',
  YES_CODE_MOCK_TESTED: 'Built, mock-tested only',
  NO: 'No',
};

export function InstagramDiagnostics({ id, username }: { id: string; username?: string | null }) {
  const res = useApi<any>(`/socials/accounts/${id}/diagnostics`);
  return (
    <Card className="mt-3">
      <CardTitle
        action={
          <ActionButton
            size="sm"
            success="Live checks finished"
            onAction={async () => {
              await post(`/socials/accounts/${id}/diagnostics`);
              await refresh('/socials');
            }}
          >
            Run live checks
          </ActionButton>
        }
      >
        Instagram diagnostics{username ? ` · @${username}` : ''}
      </CardTitle>
      <p className="mb-2 text-xs text-muted">
        Live checks are read-only requests to Instagram. They never send, post or change anything. Anything
        marked "mock-tested" has only been exercised against fake responses.
      </p>
      <p className="mb-2 text-xs text-muted">
        Three levels are kept apart: <b>API reachable</b> (HTTP 200 only), <b>data imported</b> (real records
        stored in CreatorOS) and <b>verified end to end</b> (imported and a real webhook event processed).
        HTTP 200 with zero records is never counted as imported.
      </p>
      <Async res={res}>
        {(d) => (
          <>
            <p className="mb-2 text-xs text-muted">
              {d.ranAt
                ? `Last live run ${when(d.ranAt)} (API ${d.graphVersion})`
                : 'Live checks have not been run.'}
            </p>
            <ul className="divide-y divide-border text-sm">
              {d.items.map((i: any) => (
                <li key={i.key} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span>{i.label}</span>
                    <Badge tone={TONE[i.verdict] ?? 'neutral'}>{WORDS[i.verdict] ?? i.verdict}</Badge>
                  </div>
                  {i.reachable != null && (
                    <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                      <Badge tone={i.reachable ? 'ok' : 'bad'}>
                        API reachable: {i.reachable ? 'yes' : 'no'}
                      </Badge>
                      <Badge tone={i.permissionVerified ? 'ok' : 'warn'}>
                        Permission: {i.permissionVerified ? 'verified' : 'not verified'}
                      </Badge>
                      <Badge tone={i.apiRecords > 0 ? 'ok' : 'warn'}>
                        Data received: {i.apiRecords ?? 0}
                      </Badge>
                      <Badge tone={i.imported > 0 ? 'ok' : 'warn'}>Imported: {i.imported}</Badge>
                      <Badge tone={i.endToEnd ? 'ok' : 'neutral'}>
                        Webhook: {i.endToEnd ? 'verified' : 'not verified'}
                      </Badge>
                    </div>
                  )}
                  <div className="text-xs text-muted">{i.detail}</div>
                </li>
              ))}
            </ul>
            {d.items.some((i: any) => i.key === 'webhookSubscription' && i.verdict === 'INCOMPLETE') && (
              <div className="mt-3">
                <ActionButton
                  size="sm"
                  confirm="Subscribe this account to comments, messages, reactions, seen and postbacks? This only changes the webhook subscription list at Meta; nothing is sent or posted."
                  success="Subscription updated"
                  onAction={async () => {
                    const r = await post(`/socials/accounts/${id}/webhook-subscription`);
                    await refresh('/socials');
                    if (r?.missing?.length) throw new Error(`Still missing: ${r.missing.join(', ')}`);
                  }}
                >
                  Subscribe to comments and messages
                </ActionButton>
              </div>
            )}
            <p className="mt-3 text-sm font-medium">Approvals and permissions still needed</p>
            <ul className="list-disc pl-5 text-xs text-muted">
              {d.approvals.map((a: string) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {d.sync && (
              <p className="mt-3 text-xs text-muted">
                Last sync: {d.sync.state}
                {d.sync.lastSuccessAt ? `, last success ${when(d.sync.lastSuccessAt)}` : ', never succeeded'}.
                Imported {d.sync.counts?.media ?? 0} posts, {d.sync.counts?.comments ?? 0} comments,{' '}
                {d.sync.counts?.messages ?? 0} messages.
                {d.sync.lastError ? ` Error: ${d.sync.lastError}` : ''}
                {(d.sync.steps ?? [])
                  .filter((x: any) => x.note)
                  .map((x: any) => (
                    <span key={x.key} className="mt-1 block">
                      {x.key}: {x.note}
                    </span>
                  ))}
              </p>
            )}
          </>
        )}
      </Async>
    </Card>
  );
}
