'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { canOpen } from '@/components/nav';
import { useMe } from '@/components/shell';
import { Async, Badge, Card, CardTitle, EmptyState, Notice, PageHeader, Stat } from '@/components/ui';
import { useApi } from '@/lib/api';
import { when } from '@/lib/format';

const COUNT_LINKS: Record<string, { label: string; href: string; tone?: 'warn' | 'bad' }> = {
  needReply: { label: 'Need a reply', href: '/collaborations', tone: 'warn' },
  possibleCollabs: { label: 'Possible collaborations to review', href: '/collaborations' },
  overdueInvoices: { label: 'Overdue invoices', href: '/collaborations?tab=invoices', tone: 'bad' },
  dueToday: { label: 'Due today', href: '/today' },
  openActions: { label: 'Open actions', href: '/today' },
  scheduledToday: { label: 'Scheduled today', href: '/calendar' },
  devicesOffline: { label: 'Devices offline', href: '/storage', tone: 'warn' },
  unlinkedMedia: { label: 'Files not linked to an asset', href: '/library?linked=false' },
  unmatchedPublications: { label: 'Posts to match', href: '/publishing' },
};

export default function HomePage() {
  const me = useMe();
  const briefing = useApi<any>('/briefing', { refreshInterval: 60_000 });
  const health = useApi<any>('/system/health', { refreshInterval: 60_000 });
  const tz = me.data?.organization?.timezone;
  const role = me.data?.user?.role as string | undefined;

  const problems = Object.entries(health.data?.checks ?? {}).filter(([, c]: any) => !c.ok);

  return (
    <>
      <PageHeader
        title={`Hello${me.data ? `, ${String(me.data.user.name).split(' ')[0]}` : ''}`}
        subtitle="What deserves your attention right now."
      />
      {me.data?.organization?.demoLoaded && (
        <div className="mb-4">
          <Notice tone="info" title="Demo data is loaded">
            Records starting with “DEMO” are samples. Remove them any time in Settings → Demo data.
          </Notice>
        </div>
      )}

      <Async res={briefing}>
        {(b) => (
          <div className="space-y-5">
            <Card>
              <CardTitle action={<span className="text-xs text-muted">{b.today}</span>}>
                Your top {Math.min(3, b.top.length) || 3} right now
              </CardTitle>
              {b.top.length === 0 ? (
                <EmptyState title="Nothing urgent">
                  You're clear. Capture an idea, plan a post, or check the library.
                </EmptyState>
              ) : (
                <ol className="space-y-2">
                  {b.top.slice(0, 3).map((t: any, i: number) => (
                    <li key={t.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{t.title}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {t.reasons?.map((r: string) => (
                            <Badge key={r}>{r}</Badge>
                          ))}
                          {t.dueAt && <Badge tone="info">{when(t.dueAt, tz, false)}</Badge>}
                        </div>
                      </div>
                      {t.deepLink && canOpen(role, String(t.deepLink).split('?')[0]) && (
                        <Link
                          href={t.deepLink}
                          className="shrink-0 text-sm text-accent"
                          aria-label={`Open ${t.title}`}
                        >
                          <ArrowRight className="size-4" />
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <section aria-label="Counts" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {Object.entries(b.counts).map(([k, v]) => {
                const meta = COUNT_LINKS[k];
                if (!meta || !canOpen(role, meta.href.split('?')[0] ?? '/')) return null;
                const n = Number(v);
                return (
                  <Link key={k} href={meta.href} className="block rounded-xl focus-visible:outline-2">
                    <Stat label={meta.label} value={n} tone={n > 0 ? meta.tone : undefined} />
                  </Link>
                );
              })}
            </section>
          </div>
        )}
      </Async>

      {problems.length > 0 && (
        <div className="mt-5 space-y-2">
          <h2 className="text-sm font-semibold">System status</h2>
          {problems.map(([name, c]: any) => (
            <Notice key={name} tone="warn" title={`${name}: needs attention`}>
              {c.detail ?? 'See Settings → System for details.'}
            </Notice>
          ))}
        </div>
      )}
    </>
  );
}
