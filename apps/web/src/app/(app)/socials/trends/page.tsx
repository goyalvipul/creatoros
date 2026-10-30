'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { Badge, Button, Card, CardTitle, EmptyState, Notice, PageHeader, Select } from '@/components/ui';
import { ago, title as titleCase } from '@/lib/format';

type Trend = {
  id: string;
  title: string;
  summary: string;
  count: number;
  share: number;
  needReply: number;
  commentCount: number;
  dmCount: number;
  platforms: { platform: string; count: number }[];
  phrases: { phrase: string; count: number }[];
};

type Report = {
  days: number;
  lookedAt: number;
  newestAt: string | null;
  notes: string[];
  accounts: { provider: string; state: string; label: string | null; lastSyncAt: string | null }[];
  trends: Trend[];
};

export default function TrendsPage() {
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);

  async function analyse() {
    setBusy(true);
    setError('');
    try {
      setReport(await post<Report>('/socials/trends', { days: Number(days) }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Analyse failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Trends"
        subtitle="Analyse reads the DMs and comments already saved here. Open a group to read every message before you create a workflow. Nothing is sent."
        actions={
          <Button variant="primary" busy={busy} onClick={analyse}>
            Analyse
          </Button>
        }
      />
      <div className="mb-4 max-w-xs">
        <Select aria-label="How far back" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {!report ? (
        <EmptyState title="Press Analyse when you want a fresh read">
          Sync an account in Integrations first if the inbox is empty or old. Each group opens on its own page so
          you can read the messages, then decide whether to create a workflow.
        </EmptyState>
      ) : report.accounts.length === 0 ? (
        <EmptyState
          title="No social account is connected"
          action={
            <Link href="/integrations">
              <Button variant="primary">Open Integrations</Button>
            </Link>
          }
        >
          Connect Instagram, a Facebook Page or YouTube, sync it, then Analyse again.
        </EmptyState>
      ) : report.lookedAt === 0 ? (
        <EmptyState title={`No DMs or comments are stored for the last ${report.days} days`}>
          {report.accounts.map((a) => (
            <span key={`${a.provider}-${a.label}`} className="mr-2 inline-block">
              {titleCase(a.provider)} {a.label ? `(${a.label})` : ''} is {titleCase(a.state)}.
              {a.lastSyncAt ? ` Last sync ${ago(a.lastSyncAt)}.` : ' It has not synced.'}
            </span>
          ))}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-muted">
            {report.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p>
              Looked at {report.lookedAt} messages from the last {report.days} days
              {report.newestAt ? `, newest ${ago(report.newestAt)}` : ''}.
            </p>
          </div>
          {report.trends.length === 0 ? (
            <EmptyState title="Nothing repeats often enough yet">
              A group needs at least two similar messages. Analyse again after more comments and DMs arrive.
            </EmptyState>
          ) : (
            report.trends.map((trend) => (
              <Link key={trend.id} href={`/socials/trends/${trend.id}?days=${report.days}`} className="block">
                <Card className="hover:bg-panel2">
                  <CardTitle>
                    {trend.title} <Badge>{trend.count}</Badge>
                    {trend.needReply ? <Badge tone="warn">{trend.needReply} need reply</Badge> : null}
                  </CardTitle>
                  <p className="text-sm">{trend.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    {trend.platforms.map((p) => `${titleCase(p.platform)} ${p.count}`).join(' · ')}
                    {trend.phrases.length
                      ? ` · ${trend.phrases
                          .slice(0, 3)
                          .map((p) => `${p.phrase} (${p.count})`)
                          .join(', ')}`
                      : ''}
                  </p>
                  <p className="mt-2 text-sm font-medium">Read all {trend.count} messages</p>
                </Card>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
