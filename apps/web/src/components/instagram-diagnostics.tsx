'use client';

import { ActionButton, Async, Badge, Card, CardTitle } from '@/components/ui';
import { post, refresh, useApi } from '@/lib/api';
import { when } from '@/lib/format';

const TONE: Record<string, 'ok' | 'bad' | 'warn' | 'neutral'> = {
  VERIFIED_LIVE: 'ok',
  FAILED: 'bad',
  NOT_RUN: 'neutral',
  NOT_RECEIVED: 'warn',
  YES_CODE_MOCK_TESTED: 'warn',
  NO: 'neutral',
};
const WORDS: Record<string, string> = {
  VERIFIED_LIVE: 'Verified live',
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
                  <div className="text-xs text-muted">{i.detail}</div>
                </li>
              ))}
            </ul>
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
