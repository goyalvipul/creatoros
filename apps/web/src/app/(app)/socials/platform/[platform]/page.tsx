'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Async, Badge, Button, Card, EmptyState, Notice, PageHeader } from '@/components/ui';
import { InstagramDiagnostics } from '@/components/instagram-diagnostics';
import { useApi } from '@/lib/api';
import { title as titleCase } from '@/lib/format';

const TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'bad'> = {
  LIVE_VERIFIED_END_TO_END: 'ok',
  LIVE_IMPORTED: 'ok',
  REACHABLE_NO_DATA: 'warn',
  BUILT_MOCK_TESTED_ONLY: 'warn',
  BUILT_NOT_VERIFIED: 'warn',
  NOT_BUILT: 'neutral',
  UNSUPPORTED_BY_API: 'bad',
};

export default function PlatformPage() {
  const { platform } = useParams<{ platform: string }>();
  const cat = useApi<any[]>('/socials/platforms');
  const accounts = useApi<any[]>('/socials/accounts');
  return (
    <Async res={cat}>
      {(rows) => {
        const p = rows.find((r) => r.platform === platform);
        if (!p) return <EmptyState title="Unknown platform" />;
        const mine = (accounts.data ?? []).filter((a) => a.platform.toLowerCase() === platform);
        return (
          <div>
            <PageHeader title={p.name} subtitle={p.note} />
            <Notice
              tone={p.status === 'AVAILABLE_WHEN_CONNECTED' ? 'info' : 'warn'}
              title={titleCase(p.status)}
            >
              {p.status === 'AVAILABLE_WHEN_CONNECTED'
                ? 'Each row shows how far it is proven: reachable (HTTP 200 only), real data imported, or verified end to end with a real webhook event. HTTP 200 with zero records is never shown as imported. Mock-tested rows have not been tried for real.'
                : 'Not working in CreatorOS. Use the native app for this platform.'}
            </Notice>
            <Card className="mt-4">
              <ul className="divide-y divide-border text-sm">
                {Object.entries(p.capabilities).map(([k, v]: [string, any]) => (
                  <li key={k} className="flex items-center justify-between py-1.5">
                    {k}
                    <Badge tone={TONE[v] ?? 'neutral'}>{titleCase(v)}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
            <div className="mt-4 flex flex-wrap gap-2">
              {mine.length > 0 && (
                <Link href="/socials/inbox">
                  <Button variant="primary">Open inbox</Button>
                </Link>
              )}
              {platform === 'instagram' && (
                <Link href="/integrations">
                  <Button>Connect or reconnect account</Button>
                </Link>
              )}
              {p.nativeInbox && (
                <a href={p.nativeInbox} target="_blank" rel="noreferrer">
                  <Button>Open native inbox</Button>
                </a>
              )}
            </div>
            {platform === 'instagram' &&
              mine.map((a) => <InstagramDiagnostics key={a.id} id={a.id} username={a.username} />)}
            {mine.length > 0 && (
              <ul className="mt-4 text-sm">
                {mine.map((a) => (
                  <li key={a.id}>
                    @{a.username ?? a.accountId} · {titleCase(a.state)} · {a.needReply} need reply
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </Async>
  );
}
