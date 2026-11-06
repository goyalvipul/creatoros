'use client';

import { useState } from 'react';
import { ActionButton, Badge, Button, Card, CardTitle, EmptyState, Field, Input, Provenance, Textarea } from '@/components/ui';
import { post, put, refresh, useApi } from '@/lib/api';
import { title as titleCase } from '@/lib/format';
import { PlatformLogo } from '@/components/platform-logo';

type Metric = { state: 'VALUE' | 'ZERO' | 'UNAVAILABLE' | 'UNKNOWN'; value: number | null };
type Post = {
  id: string;
  title: string | null;
  url: string | null;
  platform: string;
  handle: string;
  publishedAt: string | null;
  provenance: string;
  thumb: string | null;
  project: string | null;
  collectedAt: string | null;
  endpoint: string | null;
  metrics: { views: Metric; likes: Metric; comments: Metric; shares: Metric; reach: Metric; saves: Metric; watchTime: Metric; avgView: Metric };
  details: Record<string, number>;
  mediaKind: string | null;
  note: string | null;
};
type Account = {
  id: string;
  platform: string;
  handle: string;
  url: string | null;
  state: string | null;
  token: string;
  lastSync: string | null;
  lastStatus: string | null;
  lastError: string | null;
  capabilities: { metric: string; level: string; status: string; reason: string; additive: boolean }[];
};
type Detail = {
  range: { from: string; to: string };
  content: Post[];
  byDay: { day: string; posts: number; views: number | null }[];
  accounts: Account[];
  followers: {
    accountId: string;
    metric: string;
    value: number | null;
    state: string;
    collectedAt: string;
    reportingOn: string | null;
    endpoint: string | null;
    detail: { dimension: string; label: string; value: number }[] | null;
  }[];
  notes: string[];
};

function num(m: Metric) {
  if (m.state === 'VALUE' || m.state === 'ZERO') return m.value!.toLocaleString();
  if (m.state === 'UNAVAILABLE') return 'Unavailable';
  return 'Unknown';
}

function Bars({ rows }: { rows: { day: string; posts: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.posts));
  if (rows.length === 0)
    return <EmptyState title="No posts in this period">Published posts show here by the day they went out.</EmptyState>;
  return (
    <div className="flex h-36 items-end gap-1" role="img" aria-label="Posts per day">
      {rows.map((r) => (
        <div key={r.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${r.day}: ${r.posts} posts`}>
          <div className="w-full rounded-sm bg-accent" style={{ height: `${Math.max(4, Math.round((112 * r.posts) / max))}px` }} />
          <span className="w-full truncate text-center text-[10px] text-muted">{r.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsBoard({
  tab,
  detail,
  detailError,
}: {
  tab: string;
  detail: Detail | null;
  detailError?: string | null;
}) {
  const [syncing, setSyncing] = useState(false);
  if (detailError) return <EmptyState title="Analytics data is not ready">{detailError}</EmptyState>;
  if (!detail) return null;
  const posts = detail.content;
  const refreshNow = async (force = false) => {
    setSyncing(true);
    try {
      await post('/analytics/sync', { force });
      await refresh('/analytics');
    } finally {
      setSyncing(false);
    }
  };
  if (tab === 'overview')
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted">
            {new Date(detail.range.from).toLocaleDateString()} – {new Date(detail.range.to).toLocaleDateString()}
          </p>
          <Button className="ml-auto" size="sm" disabled={syncing} onClick={() => void refreshNow(true)}>
            {syncing ? 'Refreshing…' : 'Refresh metrics'}
          </Button>
        </div>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card><CardTitle>Posts</CardTitle><p className="text-2xl font-semibold tabular-nums">{posts.length}</p></Card>
          <Card><CardTitle>With views</CardTitle><p className="text-2xl font-semibold tabular-nums">{posts.filter((p) => p.metrics.views.value != null).length}</p></Card>
          <Card><CardTitle>Views unavailable</CardTitle><p className="text-2xl font-semibold tabular-nums">{posts.filter((p) => p.metrics.views.state === 'UNAVAILABLE').length}</p></Card>
          <Card><CardTitle>Source not recorded</CardTitle><p className="text-2xl font-semibold tabular-nums">{posts.filter((p) => p.provenance === 'UNKNOWN').length}</p></Card>
        </section>
        <Card>
          <CardTitle>Posts per day</CardTitle>
          <Bars rows={detail.byDay} />
          <p className="mt-2 text-xs text-muted">Each bar is a post that was published that day. It is not views gained that day.</p>
        </Card>
        {detail.notes.map((n) => (
          <p key={n} className="text-xs text-muted">{n}</p>
        ))}
      </div>
    );
  if (tab === 'content') return <Content posts={posts} />;
  if (tab === 'audience') return <Audience detail={detail} />;
  if (tab === 'platforms') return <Platforms detail={detail} onSync={() => void refreshNow(true)} busy={syncing} />;
  if (tab === 'recommendations') return <Recommendations />;
  if (tab === 'health') return <Health detail={detail} />;
  if (tab === 'kit') return <KitEditor />;
  return null;
}

const DETAIL_LABELS: Record<string, string> = {
  reach: 'Reach',
  saves: 'Saves',
  shares: 'Shares',
  totalInteractions: 'Interactions',
  follows: 'Follows',
  profileVisits: 'Profile visits',
  profileActivity: 'Profile activity',
  replies: 'Replies',
  reposts: 'Reposts',
  quotes: 'Quotes',
  avgWatchSeconds: 'Average watch',
  totalWatchSeconds: 'Total watch time',
  clicks: 'Clicks',
  videoViews: 'Video views',
  periodViews: 'Views in period',
  periodLikes: 'Likes in period',
  periodComments: 'Comments in period',
  periodShares: 'Shares in period',
  subscribersGained: 'Subscribers gained',
  subscribersLost: 'Subscribers lost',
  averageViewDurationSeconds: 'Average view',
  averageViewPercentage: 'Watched',
  impressions: 'Impressions',
  impressionClickPercentage: 'Thumbnail click rate',
  reactionLike: 'Like',
  reactionLove: 'Love',
  reactionCare: 'Care',
  reactionWow: 'Wow',
  reactionHaha: 'Haha',
  reactionSorry: 'Sad',
  reactionAnger: 'Angry',
};

const ACCOUNT_LABELS: Record<string, string> = {
  followers: 'Followers',
  subscribers: 'Subscribers',
  watch_time: 'Minutes watched',
  views_period: 'Views in period',
  subscribers_gained: 'Subscribers gained',
  subscribers_lost: 'Subscribers lost',
  avg_view_duration: 'Average view, seconds',
  shares_period: 'Shares in period',
  impressions_period: 'Impressions in period',
  reach_28d: 'Reach, last 28 days',
  views_28d: 'Views, last 28 days',
  accounts_engaged_28d: 'Accounts engaged, last 28 days',
  interactions_28d: 'Interactions, last 28 days',
  page_media_views: 'Page media views, latest day',
  page_engagements: 'Page engagements, latest day',
  page_views: 'Page views, latest day',
};

function kindLabel(kind: string | null) {
  const value = (kind ?? '').toUpperCase();
  if (value === 'REELS') return 'Reel';
  if (value === 'STORY') return 'Story';
  if (value === 'CAROUSEL_ALBUM') return 'Carousel';
  if (value === 'IMAGE') return 'Photo';
  if (value === 'VIDEO') return 'Video';
  if (value === 'FEED') return 'Feed';
  return kind;
}

function detailValue(key: string, value: number) {
  if (key.endsWith('Seconds')) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }
  if (key.endsWith('Percentage')) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function Content({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return <EmptyState title="No posts in this period" />;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {posts.map((p) => {
        const facts = Object.entries(p.details ?? {}).filter(([key, value]) => Number.isFinite(value) && !['reach', 'saves', 'shares', 'periodShares', 'replies'].includes(key));
        return (
        <li key={p.id}>
          <Card className="h-full">
            <div className="flex gap-3">
              {p.thumb ? (
                <img src={p.thumb} alt="" className="size-16 rounded-md object-cover" />
              ) : (
                <div className="grid size-16 place-items-center rounded-md bg-panel2 text-[10px] text-muted">No still</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {p.url ? <a className="hover:underline" href={p.url} target="_blank" rel="noreferrer">{p.title || p.url}</a> : p.title || 'Untitled'}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <PlatformLogo platform={p.platform} className="size-3.5" />
                  <span>{p.handle}{kindLabel(p.mediaKind) ? ` · ${kindLabel(p.mediaKind)}` : ''}{p.project ? ` · ${p.project}` : ''}</span>
                </div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-xs text-muted">Views</dt><dd>{num(p.metrics.views)}</dd></div>
              <div><dt className="text-xs text-muted">{p.platform === 'facebook' ? 'Reactions' : 'Likes'}</dt><dd>{num(p.metrics.likes)}</dd></div>
              <div><dt className="text-xs text-muted">{p.platform === 'threads' ? 'Replies' : 'Comments'}</dt><dd>{num(p.metrics.comments)}</dd></div>
              {p.metrics.shares.state !== 'UNAVAILABLE' && (
                <div><dt className="text-xs text-muted">{p.platform === 'youtube' ? 'Shares in period' : 'Shares'}</dt><dd>{num(p.metrics.shares)}</dd></div>
              )}
              {p.metrics.reach.state !== 'UNAVAILABLE' && (
                <div><dt className="text-xs text-muted">Reach</dt><dd>{num(p.metrics.reach)}</dd></div>
              )}
              {p.metrics.saves.state !== 'UNAVAILABLE' && (
                <div><dt className="text-xs text-muted">Saves</dt><dd>{num(p.metrics.saves)}</dd></div>
              )}
            </dl>
            {facts.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {facts.map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs text-muted">{DETAIL_LABELS[key] ?? key}</dt>
                    <dd>{detailValue(key, value)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {p.note && <p className="mt-2 text-xs text-muted">{p.note}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Provenance value={p.provenance} />
              {p.collectedAt && <span>Synced {new Date(p.collectedAt).toLocaleString()}</span>}
              {p.endpoint && <span className="truncate">{p.endpoint}</span>}
            </div>
          </Card>
        </li>
        );
      })}
    </ul>
  );
}

function Audience({ detail }: { detail: Detail }) {
  const rows = detail.followers.filter((f) => f.metric !== 'demographics');
  const breakdowns = detail.followers.filter((f) => f.metric === 'demographics' && f.detail && f.detail.length > 0);
  if (rows.length === 0 && breakdowns.length === 0)
    return (
      <EmptyState title="No follower history yet">
        Refresh metrics after an account is connected. Counts stay blank until a platform returns them. They are not added across Instagram, Facebook and YouTube.
      </EmptyState>
    );
  const byAccount = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byAccount.get(`${row.accountId}:${row.metric}`) ?? [];
    list.push(row);
    byAccount.set(`${row.accountId}:${row.metric}`, list);
  }
  const latestBreakdown = new Map<string, (typeof breakdowns)[number]>();
  for (const row of breakdowns) latestBreakdown.set(row.accountId, row);
  return (
    <div className="space-y-4">
      {[...byAccount.entries()].map(([key, list]) => {
        const account = detail.accounts.find((a) => a.id === list[0]!.accountId);
        const latest = list[list.length - 1]!;
        const label = ACCOUNT_LABELS[latest.metric] ?? latest.metric.replaceAll('_', ' ');
        const shown = latest.state === 'UNAVAILABLE' || latest.value == null ? 'Unavailable' : latest.value.toLocaleString();
        return (
          <Card key={key}>
            <CardTitle>
              {account ? <span className="inline-flex items-center gap-1.5"><PlatformLogo platform={account.platform} className="size-4" />{account.handle}</span> : 'Account'}
              {' · '}{label}
            </CardTitle>
            <p className="text-2xl font-semibold tabular-nums">{shown}</p>
            <p className="text-xs text-muted">{latest.endpoint} · {new Date(latest.collectedAt).toLocaleString()}</p>
            {(latest.metric === 'followers' || latest.metric === 'subscribers') && (
              <Bars rows={list.filter((r) => r.reportingOn && r.value != null).map((r) => ({ day: r.reportingOn!, posts: r.value ?? 0 }))} />
            )}
          </Card>
        );
      })}
      {[...latestBreakdown.values()].map((row) => {
        const account = detail.accounts.find((a) => a.id === row.accountId);
        const slices = row.detail ?? [];
        return (
          <Card key={`${row.accountId}-demo`}>
            <CardTitle>
              {account ? <span className="inline-flex items-center gap-1.5"><PlatformLogo platform={account.platform} className="size-4" />{account.handle}</span> : 'Account'}
              {' · Audience'}
            </CardTitle>
            <p className="text-xs text-muted">{row.endpoint}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {slices.slice(0, 12).map((slice) => (
                <li key={`${slice.dimension}-${slice.label}`} className="flex justify-between gap-3">
                  <span>{slice.dimension} · {slice.label}</span>
                  <span className="tabular-nums">{slice.value.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function Platforms({ detail, onSync, busy }: { detail: Detail; onSync: () => void; busy: boolean }) {
  const extra = [
    { platform: 'tiktok', handle: 'Not connected', capabilities: [] as Account['capabilities'], lastSync: null, lastError: 'No TikTok connector is configured.', token: 'unknown', state: null, id: 'tiktok', url: null },
    { platform: 'threads', handle: 'Not connected', capabilities: [] as Account['capabilities'], lastSync: null, lastError: 'Connect Threads under Integrations. Facebook Page permissions do not include it.', token: 'unknown', state: null, id: 'threads', url: null },
  ];
  const rows = [...detail.accounts, ...extra.filter((e) => !detail.accounts.some((a) => a.platform === e.platform))];
  return (
    <div className="space-y-3">
      <Button size="sm" disabled={busy} onClick={onSync}>{busy ? 'Refreshing…' : 'Refresh all accounts'}</Button>
      {rows.map((a) => (
        <Card key={a.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-1.5 font-medium">
              <PlatformLogo platform={a.platform} className="size-4" />
              {a.handle === 'Not connected' ? titleCase(a.platform) : a.handle}
            </h3>
            {a.lastSync && <span className="text-xs text-muted">Last sync {new Date(a.lastSync).toLocaleString()}</span>}
            {a.token === 'expired' && <Badge tone="bad">Token expired</Badge>}
          </div>
          {a.lastError && <p className="mt-1 text-sm text-warn">{a.lastError}</p>}
          <ul className="mt-2 space-y-1 text-sm">
            {a.capabilities.length === 0 && <li className="text-muted">No metrics are collected for this platform.</li>}
            {a.capabilities.map((c) => (
              <li key={c.metric} className="flex flex-wrap gap-2">
                <span className="w-28 font-medium">{c.metric}</span>
                <Badge tone={c.status === 'AVAILABLE' ? 'ok' : 'warn'}>{c.status.replaceAll('_', ' ').toLowerCase()}</Badge>
                <span className="text-muted">{c.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function Recommendations() {
  const res = useApi<any[]>('/analytics/recommendations');
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ActionButton
        variant="primary"
        onAction={async () => {
          const out = await post<any>('/analytics/recommendations', {});
          setNote(out.note ?? (out.algorithm === 'rules' ? 'Calculated from stored view counts. Not a model.' : null));
          await refresh('/analytics/recommendations');
        }}
      >
        Generate from stored data
      </ActionButton>
      {note && <p className="text-xs text-muted">{note}</p>}
      <ul className="space-y-3">
        {(res.data ?? []).map((row) => {
          const rec = row.body ?? {};
          return (
            <li key={row.id}>
              <Card>
                <h3 className="font-medium">{rec.title}</h3>
                <p className="mt-2 text-sm">{rec.observed}</p>
                <p className="mt-2 text-sm text-muted">{rec.hypothesis}</p>
                <p className="mt-2 text-xs text-muted">Sample {rec.sampleSize}. Review {rec.reviewOn}. {rec.uncertainty}</p>
                <p className="mt-2 text-sm">Try: {rec.action}</p>
                <div className="mt-3">
                  <ActionButton
                    size="sm"
                    onAction={async () => {
                      await post(`/analytics/recommendations/${row.id}/experiment`, {});
                    }}
                  >
                    Make this a task
                  </ActionButton>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {(res.data ?? []).length === 0 && <EmptyState title="No recommendations yet">Generate uses the view counts already stored. It does not call a platform.</EmptyState>}
    </div>
  );
}

function Health({ detail }: { detail: Detail }) {
  return (
    <div className="space-y-3">
      {detail.accounts.map((a) => (
        <Card key={a.id}>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <PlatformLogo platform={a.platform} className="size-4" />
              {a.handle}
            </span>
          </CardTitle>
          <p className="text-sm">Connection {a.state ?? 'not linked'} · token {a.token}</p>
          <p className="text-sm text-muted">Last sync {a.lastSync ? new Date(a.lastSync).toLocaleString() : 'never'} {a.lastStatus ? `(${a.lastStatus})` : ''}</p>
          {a.lastError && <p className="text-sm text-warn">{a.lastError}</p>}
        </Card>
      ))}
      {detail.accounts.length === 0 && <EmptyState title="No social accounts" />}
    </div>
  );
}

function KitEditor() {
  const res = useApi<any>('/media-kit');
  const [bio, setBio] = useState('');
  const [positioning, setPositioning] = useState('');
  const [email, setEmail] = useState('');
  const [showFollowers, setShowFollowers] = useState(true);
  const [showTop, setShowTop] = useState(true);
  const [collab, setCollab] = useState('');
  const loaded = res.data;
  const slug = loaded?.slug ?? 'mehak';
  return (
    <Card>
      <CardTitle>Public media kit</CardTitle>
      <p className="mb-3 text-sm text-muted">
        The public page reads only what you publish. Follower counts are copied from verified snapshots at publish time. Private messages, tokens and unpaid deals are not included.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await put('/media-kit', {
            slug,
            artistName: 'Mehak',
            positioning,
            bio,
            showFollowers,
            showTopContent: showTop,
            contactEmail: email || null,
            collaborations: collab
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((name) => ({ name, note: '' })),
          });
          await refresh('/media-kit');
        }}
      >
        <Field label="Positioning">
          <Input value={positioning} onChange={(e) => setPositioning(e.target.value)} />
        </Field>
        <Field label="Bio">
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={5} />
        </Field>
        <Field label="Contact email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Collaborations you want listed (one name per line)">
          <Textarea value={collab} onChange={(e) => setCollab(e.target.value)} rows={3} />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showFollowers} onChange={(e) => setShowFollowers(e.target.checked)} /> Show verified follower counts</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showTop} onChange={(e) => setShowTop(e.target.checked)} /> Show top posts that have verified views</label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary">Save draft</Button>
          <ActionButton onAction={async () => { await put('/media-kit', { slug, artistName: 'Mehak', positioning, bio, showFollowers, showTopContent: showTop, contactEmail: email || null }); await post('/media-kit/publish', { published: true }); await refresh('/media-kit'); }}>Publish</ActionButton>
          <ActionButton onAction={async () => { await post('/media-kit/publish', { published: false }); await refresh('/media-kit'); }}>Unpublish</ActionButton>
        </div>
      </form>
      <p className="mt-3 text-sm">{loaded?.published ? `Published at /kit/${slug}` : 'Not published.'}</p>
    </Card>
  );
}
