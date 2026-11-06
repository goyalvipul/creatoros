'use client';

import { useState } from 'react';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormDialog,
  Input,
  Options,
  PageHeader,
  Provenance,
  Select,
  Tabs,
} from '@/components/ui';
import { AnalyticsBoard } from '@/components/analytics-board';
import { patch, post, refresh, useApi } from '@/lib/api';
import { title as titleCase } from '@/lib/format';

const PERIODS = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'];
const METRICS = [
  'RELEASES',
  'VIDEOS_PUBLISHED',
  'WATCH_HOURS',
  'REPLY_SLA_HOURS',
  'REVENUE_MINOR',
  'FOLLOWERS',
  'CUSTOM',
];
const statusTone = { ON_TRACK: 'ok', AHEAD: 'ok', BEHIND: 'warn', AT_RISK: 'bad' } as const;

const VIEWS = ['overview', 'content', 'audience', 'platforms', 'recommendations', 'goals', 'health', 'kit'] as const;

export default function AnalyticsPage() {
  const [tab, setTab] = useState<(typeof VIEWS)[number]>('overview');
  const [platform, setPlatform] = useState('');
  const res = useApi<any>('/analytics', { query: platform ? { platform } : {} });
  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Stored platform numbers only. A missing permission stays visible instead of becoming a zero."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted" htmlFor="analytics-platform">Platform</label>
        <Select id="analytics-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">All</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="youtube">YouTube</option>
        </Select>
      </div>
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'content', label: 'Content' },
          { id: 'audience', label: 'Audience' },
          { id: 'platforms', label: 'Platforms' },
          { id: 'recommendations', label: 'Recommendations' },
          { id: 'goals', label: 'Goals' },
          { id: 'health', label: 'Data health' },
          { id: 'kit', label: 'Media kit' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'goals' ? (
        <Goals />
      ) : (
        <Async res={res}>
          {(a) => <AnalyticsBoard tab={tab} detail={a.detail} detailError={a.detailError} />}
        </Async>
      )}
    </>
  );
}

function Goals() {
  const res = useApi<any[]>('/goals');
  const [adding, setAdding] = useState(false);
  const [obs, setObs] = useState<any>(null);
  const [actual, setActual] = useState('');
  const [f, setF] = useState({
    name: '',
    period: 'MONTH',
    metric: 'VIDEOS_PUBLISHED',
    target: '',
    customMetric: '',
  });
  return (
    <>
      <div className="mb-4 flex">
        <Button variant="primary" className="ml-auto" onClick={() => setAdding(true)}>
          New goal
        </Button>
      </div>
      <Async
        res={res}
        empty={
          <EmptyState title="No goals yet">
            Set a simple target like “publish 4 videos this month”. Progress is computed from your real
            records.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows
              .filter((g) => g.active)
              .map((g) => {
                const p = g.progress;
                return (
                  <li key={g.id}>
                    <Card className="h-full">
                      <div className="flex items-start gap-2">
                        <h3 className="flex-1 font-medium">{g.name}</h3>
                        <Badge tone={statusTone[p.status as keyof typeof statusTone] ?? 'neutral'}>
                          {titleCase(p.status)}
                        </Badge>
                      </div>
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-sm">
                          <span>
                            {p.actual ?? 0} of {p.target} {g.unit !== 'count' ? g.unit : ''}
                          </span>
                          <span className="text-muted">{Math.round(p.pct)}%</span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-full bg-panel2">
                          <div className="h-full bg-accent" style={{ width: `${Math.min(100, p.pct)}%` }} />
                          {p.expectedPct != null && (
                            <div
                              className="absolute top-0 h-full w-0.5 bg-text/50"
                              style={{ left: `${Math.min(100, p.expectedPct)}%` }}
                              title="Where you'd be on a steady pace"
                            />
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Provenance value={p.provenance} /> {titleCase(g.period)} goal
                        {p.needsManualEntry && <span className="text-warn">needs a number from you</span>}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setActual('');
                            setObs(g);
                          }}
                        >
                          Enter progress
                        </Button>
                        <ActionButton
                          size="sm"
                          confirm="Stop tracking this goal?"
                          onAction={async () => {
                            await patch(`/goals/${g.id}`, { active: false });
                            await refresh('/goals');
                          }}
                        >
                          Archive
                        </ActionButton>
                      </div>
                    </Card>
                  </li>
                );
              })}
          </ul>
        )}
      </Async>
      <FormDialog
        open={adding}
        onClose={() => setAdding(false)}
        title="New goal"
        submitLabel="Create"
        onSubmit={async () => {
          await post('/goals', {
            name: f.name.trim(),
            period: f.period,
            metric: f.metric,
            targetValue: Number(f.target),
            customMetric: f.metric === 'CUSTOM' ? f.customMetric.trim() : undefined,
            kind: 'ACTIVITY',
          });
          setF({ name: '', period: 'MONTH', metric: 'VIDEOS_PUBLISHED', target: '', customMetric: '' });
          await refresh('/goals');
        }}
      >
        <Field label="Name">
          <Input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Measure">
            <Select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>
              <Options values={METRICS} />
            </Select>
          </Field>
          <Field label="Period">
            <Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
              <Options values={PERIODS} />
            </Select>
          </Field>
        </div>
        {f.metric === 'CUSTOM' && (
          <Field label="What are you measuring?">
            <Input
              required
              value={f.customMetric}
              onChange={(e) => setF({ ...f, customMetric: e.target.value })}
            />
          </Field>
        )}
        <Field label="Target">
          <Input
            required
            type="number"
            min={0}
            step="any"
            value={f.target}
            onChange={(e) => setF({ ...f, target: e.target.value })}
          />
        </Field>
      </FormDialog>
      <FormDialog
        open={Boolean(obs)}
        onClose={() => setObs(null)}
        title={`Progress: ${obs?.name ?? ''}`}
        submitLabel="Save"
        onSubmit={async () => {
          await post(`/goals/${obs.id}/observations`, { actual: Number(actual) });
          await refresh('/goals');
        }}
      >
        <Field label="Where are you now?">
          <Input
            required
            type="number"
            step="any"
            autoFocus
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted">Saved as “entered by you”.</p>
      </FormDialog>
    </>
  );
}
