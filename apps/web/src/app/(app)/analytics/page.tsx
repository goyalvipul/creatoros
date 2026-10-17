'use client';

import { useState } from 'react';
import { ActionButton, Async, Badge, Button, Card, CardTitle, EmptyState, Field, FormDialog, Input, Options, PageHeader, Provenance, Select, Stat, Table, Tabs, Td } from '@/components/ui';
import { patch, post, refresh, useApi } from '@/lib/api';
import { title as titleCase } from '@/lib/format';

const PERIODS = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'];
const METRICS = ['RELEASES', 'VIDEOS_PUBLISHED', 'WATCH_HOURS', 'REPLY_SLA_HOURS', 'REVENUE_MINOR', 'FOLLOWERS', 'CUSTOM'];
const statusTone = { ON_TRACK: 'ok', AHEAD: 'ok', BEHIND: 'warn', AT_RISK: 'bad' } as const;

export default function AnalyticsPage() {
  const [tab, setTab] = useState<'overview' | 'goals'>('overview');
  return (
    <>
      <PageHeader title="Analytics" subtitle="Only numbers that exist. Every figure shows whether the platform confirmed it or you entered it." />
      <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'goals', label: 'Goals' }]} value={tab} onChange={setTab} />
      {tab === 'overview' ? <Overview /> : <Goals />}
    </>
  );
}

function Overview() {
  const res = useApi<any>('/analytics');
  return (
    <Async res={res}>
      {(a) => {
        const platforms = Object.entries(a.byPlatform ?? {}) as [string, any][];
        const days = Object.entries(a.byDay ?? {}).sort(([x], [y]) => x.localeCompare(y)) as [string, any][];
        const max = Math.max(1, ...days.map(([, v]) => v.verified + v.manual));
        return (
          <div className="space-y-5">
            <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Posts published (30 days)" value={a.totals.published} />
              <Stat label="Confirmed by platform" value={a.totals.verified} tone="ok" />
              <Stat label="Marked by you" value={a.totals.manual} />
              <Stat label="Posts with view data" value={a.totals.postsWithViewData} />
            </section>
            {a.totals.published === 0 ? (
              <EmptyState title="No published posts in this period">Mark a planned post as published in Publishing, or connect YouTube to import real statistics.</EmptyState>
            ) : (
              <>
                <Card>
                  <CardTitle>Posts per day</CardTitle>
                  <div className="flex h-28 items-end gap-1" role="img" aria-label="Bar chart of posts per day">
                    {days.map(([d, v]) => (
                      <div key={d} className="flex min-w-3 flex-1 flex-col justify-end" title={`${d}: ${v.verified} verified, ${v.manual} manual`}>
                        <div className="bg-accent/50" style={{ height: `${(100 * v.manual) / max}%` }} />
                        <div className="bg-ok" style={{ height: `${(100 * v.verified) / max}%` }} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted"><span className="mr-1 inline-block size-2 bg-ok" /> platform-confirmed <span className="mx-1 inline-block size-2 bg-accent/50" /> marked by you</p>
                </Card>
                <Card>
                  <CardTitle>By platform</CardTitle>
                  <Table head={['Platform', 'Confirmed', 'Marked by you', 'Views']}>
                    {platforms.map(([p, v]) => <tr key={p}><Td className="font-medium">{titleCase(p)}</Td><Td>{v.verified}</Td><Td>{v.manual}</Td><Td>{v.views != null ? v.views.toLocaleString() : '—'}</Td></tr>)}
                  </Table>
                </Card>
                <Card>
                  <CardTitle>Top posts</CardTitle>
                  <ul className="divide-y divide-border">
                    {a.topPosts.map((p: any) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.url ? <a className="hover:underline" href={p.url} target="_blank" rel="noreferrer">{p.title ?? p.url}</a> : p.title}</div><div className="text-xs text-muted">{titleCase(p.platform)}</div></div>
                        <div className="tabular-nums">{p.views != null ? `${p.views.toLocaleString()} views` : '—'}</div>
                        <Provenance value={p.statsProvenance} />
                      </li>
                    ))}
                  </ul>
                </Card>
              </>
            )}
            {a.notes?.map((n: string) => <p key={n} className="text-xs text-muted">{n}</p>)}
          </div>
        );
      }}
    </Async>
  );
}

function Goals() {
  const res = useApi<any[]>('/goals');
  const [adding, setAdding] = useState(false);
  const [obs, setObs] = useState<any>(null);
  const [actual, setActual] = useState('');
  const [f, setF] = useState({ name: '', period: 'MONTH', metric: 'VIDEOS_PUBLISHED', target: '', customMetric: '' });
  return (
    <>
      <div className="mb-4 flex"><Button variant="primary" className="ml-auto" onClick={() => setAdding(true)}>New goal</Button></div>
      <Async res={res} empty={<EmptyState title="No goals yet">Set a simple target like “publish 4 videos this month”. Progress is computed from your real records.</EmptyState>}>
        {(rows) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows.filter((g) => g.active).map((g) => {
              const p = g.progress;
              return (
                <li key={g.id}>
                  <Card className="h-full">
                    <div className="flex items-start gap-2"><h3 className="flex-1 font-medium">{g.name}</h3><Badge tone={statusTone[p.status as keyof typeof statusTone] ?? 'neutral'}>{titleCase(p.status)}</Badge></div>
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-sm"><span>{p.actual ?? 0} of {p.target} {g.unit !== 'count' ? g.unit : ''}</span><span className="text-muted">{Math.round(p.pct)}%</span></div>
                      <div className="relative h-2 overflow-hidden rounded-full bg-panel2"><div className="h-full bg-accent" style={{ width: `${Math.min(100, p.pct)}%` }} />{p.expectedPct != null && <div className="absolute top-0 h-full w-0.5 bg-text/50" style={{ left: `${Math.min(100, p.expectedPct)}%` }} title="Where you'd be on a steady pace" />}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Provenance value={p.provenance} /> {titleCase(g.period)} goal
                      {p.needsManualEntry && <span className="text-warn">needs a number from you</span>}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => { setActual(''); setObs(g); }}>Enter progress</Button>
                      <ActionButton size="sm" confirm="Stop tracking this goal?" onAction={async () => { await patch(`/goals/${g.id}`, { active: false }); await refresh('/goals'); }}>Archive</ActionButton>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Async>
      <FormDialog open={adding} onClose={() => setAdding(false)} title="New goal" submitLabel="Create" onSubmit={async () => {
        await post('/goals', { name: f.name.trim(), period: f.period, metric: f.metric, targetValue: Number(f.target), customMetric: f.metric === 'CUSTOM' ? f.customMetric.trim() : undefined, kind: 'ACTIVITY' });
        setF({ name: '', period: 'MONTH', metric: 'VIDEOS_PUBLISHED', target: '', customMetric: '' });
        await refresh('/goals');
      }}>
        <Field label="Name"><Input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Measure"><Select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}><Options values={METRICS} /></Select></Field>
          <Field label="Period"><Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><Options values={PERIODS} /></Select></Field>
        </div>
        {f.metric === 'CUSTOM' && <Field label="What are you measuring?"><Input required value={f.customMetric} onChange={(e) => setF({ ...f, customMetric: e.target.value })} /></Field>}
        <Field label="Target"><Input required type="number" min={0} step="any" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
      </FormDialog>
      <FormDialog open={Boolean(obs)} onClose={() => setObs(null)} title={`Progress: ${obs?.name ?? ''}`} submitLabel="Save" onSubmit={async () => { await post(`/goals/${obs.id}/observations`, { actual: Number(actual) }); await refresh('/goals'); }}>
        <Field label="Where are you now?"><Input required type="number" step="any" autoFocus value={actual} onChange={(e) => setActual(e.target.value)} /></Field>
        <p className="text-xs text-muted">Saved as “entered by you”.</p>
      </FormDialog>
    </>
  );
}

