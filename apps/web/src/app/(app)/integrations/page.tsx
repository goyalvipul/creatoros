'use client';

import { useEffect, useState } from 'react';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  Field,
  FormDialog,
  Input,
  Notice,
  PageHeader,
  StateBadge,
} from '@/components/ui';
import { IdentityLink } from '@/components/identity-link';
import { post, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase } from '@/lib/format';
import { PlatformLogo } from '@/components/platform-logo';
import { PermissionConnect } from '@/components/permission-picker';
import { OAUTH_PERMISSIONS } from '@creatoros/domain';

const NAMES: Record<string, string> = {
  gmail: 'Gmail',
  youtube: 'YouTube',
  todo: 'Todo app',
  instagram: 'Instagram',
  facebook: 'Facebook Pages',
  threads: 'Threads',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  google: 'Google (umbrella)',
};
const OAUTH = ['gmail', 'youtube'];

/** The card badge follows a real account. An empty later attempt does not make a connected provider look unconfigured. */
function summaryState(row: { state?: string; connections?: { state?: string }[] }) {
  const live = (row.connections ?? []).map((c) => c.state);
  const order = ['ACTIVE', 'PARTIAL_SYNC', 'PAUSED', 'AUTH_EXPIRED', 'OFFLINE', 'ERROR'];
  return order.find((s) => live.includes(s)) ?? row.state;
}

function connectedFirst(a: { state?: string; connections?: { state?: string }[] }, b: typeof a) {
  const rank = (row: typeof a) =>
    ['ACTIVE', 'PARTIAL_SYNC', 'PAUSED', 'AUTH_EXPIRED', 'OFFLINE'].includes(summaryState(row) ?? '') ? 0 : 1;
  return rank(a) - rank(b);
}
const CAP_LABELS: Record<string, string> = {
  importMedia: 'Import posts',
  insights: 'Insights',
  publish: 'Publish',
  comments: 'Comments',
  messages: 'Messages',
};
const KEYED: Record<
  string,
  {
    fields: {
      name: 'baseUrl' | 'apiKey' | 'accessToken' | 'igUserId' | 'signingSecret';
      label: string;
      type?: string;
      hint?: string;
    }[];
  }
> = {
  todo: {
    fields: [
      {
        name: 'baseUrl',
        label: 'Workspace OS address',
        type: 'url',
        hint: 'The address Workspace OS publishes, for example http://100.108.120.8:4390. Not localhost.',
      },
      { name: 'apiKey', label: 'Access token', type: 'password', hint: 'The creatoros token, shown once.' },
      {
        name: 'signingSecret',
        label: 'Signing secret',
        type: 'password',
        hint: 'Starts with wos_whsec_. Shown once in Workspace OS → CreatorOS → Connect.',
      },
    ],
  },
};

export default function IntegrationsPage() {
  const res = useApi<any[]>('/integrations');
  const [setup, setSetup] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const reload = () => refresh('/integrations');
  const [focus, setFocus] = useState<string[]>([]);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
    const q = new URLSearchParams(window.location.search);
    const names = (q.get('focus') ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    setFocus(names);
    if (q.get('error'))
      setResult({ ok: false, text: `${q.get('error')}${q.get('detail') ? `: ${q.get('detail')}` : ''}` });
    else if (q.get('connected')) setResult({ ok: true, text: `${q.get('connected')} connected.` });
  }, []);
  useEffect(() => {
    const first = focus[0];
    if (!first || !res.data) return;
    document.getElementById(`integration-${first}`)?.scrollIntoView({ block: 'center' });
  }, [focus, res.data]);

  const connect = async (provider: string) => {
    const r = await post(`/integrations/${provider}/oauth/start`, {});
    if (r.authorizeUrl) window.location.href = r.authorizeUrl;
    else throw new Error(r.steps?.[0] ?? 'This integration is not available yet.');
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Everything is optional. A connection only shows as connected after the provider confirms it; missing pieces are listed so you know exactly what to do."
      />
      {result && (
        <Notice
          dismissible
          onDismiss={() => window.history.replaceState(null, '', window.location.pathname)}
          tone={result.ok ? 'ok' : 'bad'}
          title={result.ok ? 'Connected' : 'Connection failed'}
        >
          {result.text}
        </Notice>
      )}
      <Notice tone="info" title="Safe by design" dismissible dismissKey="integrations-safe">
        Gmail is read-only unless you choose “Enable sending” for an account, and even then an e-mail is only
        sent when you press Send on a reply. A video is uploaded only when you press Publish on that file.
        Nothing is paid on its own. Credentials are stored encrypted on your machine.
      </Notice>
      <div className="mt-4">
        <Async res={res}>
          {(rows) => (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows
                .filter((p) => p.provider !== 'google' && p.provider !== 'postiz' && p.provider !== 'meta')
                .sort(connectedFirst)
                .map((p) => {
                  const caps = p.capabilities;
                  const conn = p.connection;
                  const connected =
                    summaryState(p) === 'ACTIVE' || summaryState(p) === 'PARTIAL_SYNC';
                  const cell = `min-w-0 ${focus.includes(p.provider) ? 'rounded-xl ring-2 ring-accent' : ''}`;
                  if (p.provider === 'snapchat')
                    return (
                      <li key={p.provider} id={`integration-${p.provider}`} className={cell}>
                        <SnapchatCard row={p} reload={reload} origin={origin} />
                      </li>
                    );
                  if (p.provider === 'tiktok')
                    return (
                      <li key={p.provider} id={`integration-${p.provider}`} className={cell}>
                        <TikTokCard row={p} reload={reload} origin={origin} />
                      </li>
                    );
                  if (p.provider === 'instagram')
                    return (
                      <li key={p.provider} id={`integration-${p.provider}`} className={cell}>
                        <InstagramCard row={p} connect={connect} reload={reload} />
                      </li>
                    );
                  if (p.provider === 'facebook')
                    return (
                      <li key={p.provider} id={`integration-${p.provider}`} className={cell}>
                        <FacebookCard row={p} connect={connect} reload={reload} />
                      </li>
                    );
                  if (p.provider === 'threads')
                    return (
                      <li key={p.provider} id={`integration-${p.provider}`} className={cell}>
                        <ThreadsCard row={p} connect={connect} reload={reload} />
                      </li>
                    );
                  return (
                    <li key={p.provider} id={`integration-${p.provider}`} className={cell}>
                      <Card className="h-full">
                        <div className="flex items-start gap-2">
                          <h2 className="flex flex-1 items-center gap-2 font-semibold">
                            <PlatformLogo platform={p.provider} />
                            {NAMES[p.provider] ?? titleCase(p.provider)}
                          </h2>
                          <StateBadge state={summaryState(p)} />
                        </div>
                        {conn?.principalHint && (
                          <p className="mt-1 text-sm text-muted">Account: {conn.principalHint}</p>
                        )}
                        {conn?.lastError && <p className="mt-1 text-sm text-bad">{conn.lastError}</p>}
                        {conn?.identity && conn.identity.status !== 'LINKED' && (
                          <IdentityLink connectionId={conn.id} identity={conn.identity} />
                        )}
                        {caps.blockers?.length > 0 && (
                          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
                            {caps.blockers.map((b: string) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        )}
                        {!connected && caps.setupSteps?.length > 0 && (
                          <details className="mt-2 text-sm">
                            <summary className="cursor-pointer text-accent">How to set this up</summary>
                            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
                              {caps.setupSteps.map((s: string) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ol>
                          </details>
                        )}
                        {p.cursors?.length > 0 && (
                          <p className="mt-2 text-xs text-muted">
                            {p.cursors
                              .map(
                                (c: any) =>
                                  `${c.scope}: ${c.lastSuccessAt ? ago(c.lastSuccessAt) : 'never synced'}`,
                              )
                              .join(' · ')}
                          </p>
                        )}
                        {p.provider === 'gmail' && (p.connections ?? []).length > 0 && (
                          <ul className="mt-3 space-y-2">
                            {p.connections.map((c: any) => {
                              const canSend = (c.scopes ?? []).includes(
                                'https://www.googleapis.com/auth/gmail.send',
                              );
                              return (
                                <li
                                  key={c.id}
                                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                                >
                                  <span className="min-w-0 flex-1 truncate font-medium">
                                    {c.principalHint ?? 'Gmail account'}
                                  </span>
                                  <StateBadge state={c.state} />
                                  <Badge tone={canSend ? 'ok' : 'neutral'}>
                                    {canSend ? 'Can send replies' : 'Read-only'}
                                  </Badge>
                                  {!canSend && (
                                    <ActionButton
                                      size="sm"
                                      onAction={async () => {
                                        const r = await post('/integrations/gmail/oauth/start', {
                                          send: true,
                                          loginHint: c.principalHint ?? undefined,
                                        });
                                        if (r.authorizeUrl) window.location.href = r.authorizeUrl;
                                      }}
                                    >
                                      Enable sending
                                    </ActionButton>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {p.provider === 'youtube' && conn && connected && (
                          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <Badge
                              tone={
                                (conn.scopes ?? []).includes(
                                  'https://www.googleapis.com/auth/youtube.force-ssl',
                                )
                                  ? 'ok'
                                  : 'neutral'
                              }
                            >
                              {(conn.scopes ?? []).includes(
                                'https://www.googleapis.com/auth/youtube.force-ssl',
                              )
                                ? 'Comments: read and reply enabled'
                                : 'Comments: not enabled'}
                            </Badge>
                            <Badge
                              tone={
                                (conn.scopes ?? []).includes('https://www.googleapis.com/auth/youtube.upload')
                                  ? 'ok'
                                  : 'neutral'
                              }
                            >
                              {(conn.scopes ?? []).includes('https://www.googleapis.com/auth/youtube.upload')
                                ? 'Uploads enabled'
                                : 'Uploads: not enabled'}
                            </Badge>
                            <Badge
                              tone={
                                (conn.scopes ?? []).includes(
                                  'https://www.googleapis.com/auth/yt-analytics.readonly',
                                )
                                  ? 'ok'
                                  : 'neutral'
                              }
                            >
                              {(conn.scopes ?? []).includes(
                                'https://www.googleapis.com/auth/yt-analytics.readonly',
                              )
                                ? 'Watch time enabled'
                                : 'Watch time: not enabled'}
                            </Badge>
                            <span>
                              Comments appear in Socials (polled; YouTube has no direct messages). Replies are
                              sent only when you press send. A video is uploaded only when you press Publish.
                            </span>
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {p.provider === 'youtube' && conn && connected && (
                            <ActionButton
                              variant="primary"
                              onAction={async () => {
                                const scopes: string[] = conn.scopes ?? [];
                                const r = await post('/integrations/youtube/oauth/start', {
                                  comments: scopes.includes(
                                    'https://www.googleapis.com/auth/youtube.force-ssl',
                                  ),
                                  upload: scopes.includes('https://www.googleapis.com/auth/youtube.upload'),
                                });
                                if (r.authorizeUrl) window.location.href = r.authorizeUrl;
                              }}
                            >
                              Reconnect
                            </ActionButton>
                          )}
                          {OAUTH.includes(p.provider) && !connected && p.state !== 'UNSUPPORTED' && (
                            <ActionButton variant="primary" onAction={() => connect(p.provider)}>
                              Connect
                            </ActionButton>
                          )}
                          {p.provider === 'gmail' && connected && (
                            <ActionButton onAction={() => connect('gmail')}>
                              Add another Gmail account
                            </ActionButton>
                          )}
                          {p.provider === 'todo' && origin && (
                            <p className="mt-2 break-all text-xs text-muted">
                              Webhook address to paste into Workspace OS:{' '}
                              {origin}/api/v1/integrations/workspace-os/webhook
                            </p>
                          )}
                          {KEYED[p.provider] && (
                            <Button
                              variant={connected ? 'secondary' : 'primary'}
                              onClick={() => {
                                setVals({});
                                setSetup(p.provider);
                              }}
                            >
                              {conn ? 'Edit settings' : 'Configure'}
                            </Button>
                          )}
                          {conn && (
                            <ActionButton
                              onAction={async () => {
                                await post(`/integrations/${p.provider}/test`, {});
                                await reload();
                              }}
                              success="Connection checked"
                            >
                              Test
                            </ActionButton>
                          )}
                          {p.provider === 'youtube' &&
                            conn &&
                            connected &&
                            !(conn.scopes ?? []).includes(
                              'https://www.googleapis.com/auth/youtube.force-ssl',
                            ) && (
                              <ActionButton
                                variant="primary"
                                onAction={async () => {
                                  const scopes: string[] = conn.scopes ?? [];
                                  const r = await post('/integrations/youtube/oauth/start', {
                                    comments: true,
                                    analytics: scopes.includes(
                                      'https://www.googleapis.com/auth/yt-analytics.readonly',
                                    ),
                                    upload: scopes.includes('https://www.googleapis.com/auth/youtube.upload'),
                                  });
                                  if (r.authorizeUrl) window.location.href = r.authorizeUrl;
                                }}
                              >
                                Enable comments
                              </ActionButton>
                            )}
                          {p.provider === 'youtube' &&
                            conn &&
                            connected &&
                            !(conn.scopes ?? []).includes('https://www.googleapis.com/auth/youtube.upload') && (
                              <ActionButton
                                variant="primary"
                                onAction={async () => {
                                  const scopes: string[] = conn.scopes ?? [];
                                  const r = await post('/integrations/youtube/oauth/start', {
                                    upload: true,
                                    comments: scopes.includes(
                                      'https://www.googleapis.com/auth/youtube.force-ssl',
                                    ),
                                    analytics: scopes.includes(
                                      'https://www.googleapis.com/auth/yt-analytics.readonly',
                                    ),
                                  });
                                  if (r.authorizeUrl) window.location.href = r.authorizeUrl;
                                }}
                              >
                                Enable uploads
                              </ActionButton>
                            )}
                          {p.provider === 'youtube' &&
                            conn &&
                            connected &&
                            (conn.scopes ?? []).includes(
                              'https://www.googleapis.com/auth/youtube.force-ssl',
                            ) && (
                              <ActionButton
                                variant="primary"
                                onAction={async () => {
                                  await post(`/socials/accounts/${conn.id}/sync`);
                                  await reload();
                                }}
                                success="Comments synced"
                              >
                                Sync comments
                              </ActionButton>
                            )}
                          {conn && connected && (
                            <ActionButton
                              onAction={async () => {
                                await post(`/connections/${conn.id}/sync`, {});
                                await reload();
                              }}
                              success="Sync requested"
                            >
                              Sync now
                            </ActionButton>
                          )}
                          {conn && (
                            <ActionButton
                              onAction={async () => {
                                await post(`/connections/${conn.id}/pause`, {
                                  paused: conn.state !== 'PAUSED',
                                });
                                await reload();
                              }}
                            >
                              {conn.state === 'PAUSED' ? 'Resume' : 'Pause'}
                            </ActionButton>
                          )}
                          {conn && (
                            <ActionButton
                              variant="danger"
                              confirm="Disconnect and delete the stored credentials?"
                              onAction={async () => {
                                await post(`/connections/${conn.id}/disconnect`, {});
                                await reload();
                              }}
                            >
                              Disconnect
                            </ActionButton>
                          )}
                        </div>
                        {p.state === 'UNSUPPORTED' && <Badge>no public API</Badge>}
                      </Card>
                    </li>
                  );
                })}
            </ul>
          )}
        </Async>
      </div>

      {setup && (
        <FormDialog
          open
          onClose={() => setSetup(null)}
          title={`Configure ${NAMES[setup] ?? setup}`}
          submitLabel="Save"
          onSubmit={async () => {
            const config: Record<string, unknown> = {};
            if (vals.baseUrl) config.baseUrl = vals.baseUrl.trim();
            if (vals.igUserId) config.igUserId = vals.igUserId.trim();
            if (setup === 'todo') config.mode = 'workspace-os';
            await post(`/integrations/${setup}/key`, {
              apiKey: vals.apiKey || undefined,
              accessToken: vals.accessToken || undefined,
              signingSecret: vals.signingSecret || undefined,
              config,
            });
            await post(`/integrations/${setup}/test`, {}).catch(() => undefined);
            await reload();
          }}
        >
          {KEYED[setup]!.fields.map((fl) => (
            <Field key={fl.name} label={fl.label} hint={fl.hint}>
              <Input
                type={fl.type ?? 'text'}
                autoComplete="off"
                value={vals[fl.name] ?? ''}
                onChange={(e) => setVals({ ...vals, [fl.name]: e.target.value })}
              />
            </Field>
          ))}
          <p className="text-xs text-muted">
            Leave a secret field empty to keep the stored value. Secrets are encrypted and never shown again.
          </p>
        </FormDialog>
      )}
    </>
  );
}

const TOKEN_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  OK: 'ok',
  RENEWAL_DUE: 'warn',
  EXPIRED: 'bad',
  UNKNOWN: 'neutral',
};

/** Snapchat Public Profile API. The client secret stays on the server. Connect opens Snapchat. */
function SnapchatCard({
  row,
  reload,
  origin,
}: {
  row: any;
  reload: () => unknown;
  origin: string;
}) {
  const caps = row.capabilities ?? {};
  const ready = Boolean(caps.flags?.appConfigured);
  const accounts: any[] = row.connections ?? [];
  const loginRedirect =
    (typeof caps.flags?.redirectUri === 'string' && caps.flags.redirectUri) ||
    (origin ? `${origin}/api/v1/integrations/snapchat/callback` : '');
  return (
    <Card className="h-full min-w-0">
      <div className="flex items-start gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-semibold">
          <PlatformLogo platform="snapchat" />
          Snapchat
        </h2>
        <StateBadge state={summaryState(row)} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Connect opens the Public Profile login only for the box you check. Posting and analytics stay off until a Snapchat
        call for that capability succeeds. You can still paste a Snapchat link as a manual post.
      </p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-muted">Redirect URL, for the Snapchat portal</dt>
          <dd className="break-all">{loginRedirect || 'Open this page in the browser to see the address.'}</dd>
        </div>
      </dl>
      {accounts.length === 0 && caps.blockers?.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {caps.blockers.map((b: string) => (
            <li key={b} className="break-words">
              {b}
            </li>
          ))}
        </ul>
      )}
      {accounts.length === 0 && caps.setupSteps?.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-accent">How to set this up</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
            {caps.setupSteps.map((s: string) => (
              <li key={s} className="break-words">
                {s}
              </li>
            ))}
          </ol>
        </details>
      )}
      {accounts.length > 0 && (
        <ul className="mt-3 space-y-2">
          {accounts.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.config?.username ? `@${String(c.config.username).replace(/^@/, '')}` : c.label || 'Snapchat profile'}</span>
                <StateBadge state={c.state} />
              </div>
              {c.lastError && <p className="mt-1 text-bad">{c.lastError}</p>}
              <IdentityLink connectionId={c.id} identity={c.identity} />
              <div className="mt-2 flex flex-wrap gap-1">
                {(c.scopes ?? []).map((scope: string) => (
                  <Badge key={scope} tone="ok">
                    {scope}
                  </Badge>
                ))}
                <Badge tone={caps.flags?.publicProfile ? 'ok' : 'neutral'}>Profile {caps.flags?.publicProfile ? 'allowed' : 'not confirmed'}</Badge>
                <Badge tone={caps.flags?.stories ? 'ok' : 'neutral'}>Stories {caps.flags?.stories ? 'allowed' : 'not confirmed'}</Badge>
                <Badge tone="neutral">Posting off</Badge>
                <Badge tone="neutral">Analytics off</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <ActionButton
                  onAction={async () => {
                    await post('/integrations/snapchat/test', { connectionId: c.id });
                    await reload();
                  }}
                  success="Connection checked"
                >
                  Test
                </ActionButton>
                <PermissionConnect provider="snapchat" granted={c.scopes ?? []} label="Reconnect" />
                <ActionButton
                  variant="danger"
                  confirm="Disconnect this Snapchat profile? Posts you recorded stay."
                  onAction={async () => {
                    await post(`/connections/${c.id}/disconnect`, {});
                    await reload();
                  }}
                >
                  Disconnect
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {accounts.length === 0 && (
        <div className="mt-3">
          {ready ? (
            <PermissionConnect provider="snapchat" granted={[]} extra={['snapchat-profile-api']} label="Connect Snapchat" variant="primary" />
          ) : (
            <p className="text-sm text-muted">
              Connect appears after the server has SNAPCHAT_CLIENT_ID and SNAPCHAT_CLIENT_SECRET.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** TikTok Login Kit. The client secret stays on the server. Connect opens TikTok; there is no token to paste. */
function TikTokCard({
  row,
  reload,
  origin,
}: {
  row: any;
  reload: () => unknown;
  origin: string;
}) {
  const caps = row.capabilities ?? {};
  const ready = Boolean(caps.flags?.appConfigured);
  const accounts: any[] = row.connections ?? [];
  const loginRedirect = origin ? `${origin}/api/v1/integrations/tiktok/callback` : '';
  const webhook = origin ? `${origin}/api/v1/integrations/tiktok/webhook` : '';
  return (
    <Card className="h-full min-w-0">
      <div className="flex items-start gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-semibold"><PlatformLogo platform="tiktok" />TikTok</h2>
        <StateBadge state={summaryState(row)} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Connect asks only for the permissions you check. A permission turned on in the TikTok portal is not on this
        login until you reconnect and check it. Direct messages are not available.
      </p>
      {caps.blockers?.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {caps.blockers.map((b: string) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-muted">Login redirect, for the TikTok portal</dt>
          <dd className="break-all">{loginRedirect || 'Open this page in the browser to see the address.'}</dd>
        </div>
        <div>
          <dt className="text-muted">Webhook</dt>
          <dd className="break-all">{webhook || 'Open this page in the browser to see the address.'}</dd>
        </div>
      </dl>
      {accounts.length > 0 && (
        <ul className="mt-3 space-y-2">
          {accounts.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.config?.displayName || c.label || 'TikTok account'}</span>
                <StateBadge state={c.state} />
              </div>
              {c.lastError && <p className="mt-1 text-bad">{c.lastError}</p>}
              <IdentityLink connectionId={c.id} identity={c.identity} />
              <div className="mt-2 flex flex-wrap gap-1">
                {(c.scopes ?? []).map((scope: string) => (
                  <Badge key={scope} tone="ok">
                    {scope}
                  </Badge>
                ))}
              </div>
              {OAUTH_PERMISSIONS.tiktok.some((item) => !(c.scopes ?? []).includes(item.scope)) && (
                <p className="mt-1 break-words text-xs text-muted">
                  Not on this login:{' '}
                  {OAUTH_PERMISSIONS.tiktok
                    .filter((item) => !(c.scopes ?? []).includes(item.scope))
                    .map((item) => item.scope)
                    .join(', ')}
                  . Reconnect and check the ones you want.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <ActionButton
                  onAction={async () => {
                    await post('/integrations/tiktok/test', { connectionId: c.id });
                    await reload();
                  }}
                  success="Connection checked"
                >
                  Test
                </ActionButton>
                <PermissionConnect provider="tiktok" granted={c.scopes ?? []} label="Reconnect" />
                <ActionButton
                  variant="danger"
                  confirm="Disconnect this TikTok account? Imported videos stay."
                  onAction={async () => {
                    await post(`/connections/${c.id}/disconnect`, {});
                    await reload();
                  }}
                >
                  Disconnect
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {accounts.length === 0 && (
        <div className="mt-3">
          {ready ? (
            <PermissionConnect
              provider="tiktok"
              granted={accounts[0]?.scopes ?? []}
              label={accounts.length ? 'Connect another TikTok account' : 'Connect TikTok'}
              variant="primary"
            />
          ) : (
            <p className="text-sm text-muted">
              Connect appears after the server has the TikTok client key and client secret.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** Threads API. Same Meta app as Facebook, separate Threads login. */
function ThreadsCard({
  row,
  connect,
  reload,
}: {
  row: any;
  connect: (provider: string, body?: Record<string, unknown>) => Promise<void>;
  reload: () => unknown;
}) {
  const accounts: any[] = row.connections ?? [];
  const caps = row.capabilities;
  const redirect = caps.flags?.redirectUri as string | null | undefined;
  return (
    <Card className="h-full min-w-0">
      <div className="flex items-start gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-semibold"><PlatformLogo platform="threads" />Threads</h2>
        <StateBadge state={summaryState(row)} />
      </div>
      <p className="mt-1 break-words text-sm text-muted">
        Threads login on the Meta app. The Facebook Page connection does not grant this. Connect asks for profile,
        posts, insights, replies, mentions, discovery, publish, delete, and share to Instagram. A post is sent only
        when you confirm it.
      </p>
      {redirect && (
        <div className="mt-2 space-y-1 break-all text-xs text-muted">
          <p>Redirect callback: {redirect}</p>
          {caps.flags?.deauthorizeUrl && <p>Uninstall callback: {caps.flags.deauthorizeUrl}</p>}
          {caps.flags?.dataDeletionUrl && <p>Delete callback: {caps.flags.dataDeletionUrl}</p>}
        </div>
      )}
      {accounts.length === 0 && caps.blockers?.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {caps.blockers.map((b: string) => (
            <li key={b} className="break-words">{b}</li>
          ))}
        </ul>
      )}
      {accounts.length === 0 && caps.setupSteps?.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-accent">How to set this up</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
            {caps.setupSteps.map((s: string) => (
              <li key={s} className="break-words">{s}</li>
            ))}
          </ol>
        </details>
      )}
      <ul className="mt-3 space-y-3">
        {accounts.map((c) => {
          const a = c.account ?? {};
          return (
            <li key={c.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-medium">{a.username ? `@${a.username}` : c.label}</p>
                <StateBadge state={c.state} />
              </div>
              <p className="mt-1 break-words text-xs text-muted">Granted: {a.grantedPermissions?.join(', ') || 'none recorded'}</p>
              {a.missingPermissions?.length > 0 && (
                <p className="mt-1 break-words text-xs text-muted">Not granted: {a.missingPermissions.join(', ')}. Reconnect to add them.</p>
              )}
              {c.lastError && <p className="mt-1 break-words text-sm text-bad">{c.lastError}</p>}
              <IdentityLink connectionId={c.id} identity={c.identity} />
              <div className="mt-2 flex flex-wrap gap-2">
                <PermissionConnect provider="threads" granted={a.grantedPermissions ?? c.scopes ?? []} label="Reconnect" size="sm" />
                <ActionButton
                  size="sm"
                  onAction={async () => {
                    await post(`/connections/${c.id}/sync`, {});
                    await reload();
                  }}
                  success="Posts imported"
                >
                  Import posts
                </ActionButton>
              </div>
            </li>
          );
        })}
      </ul>
      {caps.flags?.appConfigured && (
        <div className="mt-3">
          <PermissionConnect
            provider="threads"
            granted={accounts[0]?.account?.grantedPermissions ?? accounts[0]?.scopes ?? []}
            label={accounts.length ? 'Connect another Threads account' : 'Connect Threads'}
            variant="primary"
          />
        </div>
      )}
    </Card>
  );
}

/** Instagram API with Instagram Login: one block per connected account, with permissions, capabilities and token health. */
function InstagramCard({
  row,
  connect,
  reload,
}: {
  row: any;
  connect: (provider: string) => Promise<void>;
  reload: () => unknown;
}) {
  const accounts: any[] = row.connections ?? [];
  const caps = row.capabilities;
  return (
    <Card className="h-full min-w-0">
      <div className="flex items-start gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-semibold"><PlatformLogo platform="instagram" />Instagram</h2>
        <StateBadge state={summaryState(row)} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Instagram API with Instagram Login for professional (Creator/Business) accounts. No Facebook Page is
        needed. Connect more than one account to manage several brands.
      </p>
      {accounts.length === 0 && caps.blockers?.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {caps.blockers.map((b: string) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {accounts.length === 0 && caps.setupSteps?.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-accent">How to set this up</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
            {caps.setupSteps.map((s: string) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>
      )}
      <ul className="mt-3 space-y-3">
        {accounts.map((c) => {
          const a = c.account;
          return (
            <li key={c.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                {a.profilePictureUrl ? (
                  <img
                    src={a.profilePictureUrl}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="h-10 w-10 rounded-full bg-panel2" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.username ? `@${a.username}` : c.label}</p>
                  <p className="truncate text-xs text-muted">
                    {a.name ? `${a.name} · ` : ''}
                    ID {a.accountId}
                    {a.accountType ? ` · ${a.accountType}` : ''}
                  </p>
                </div>
                <StateBadge state={c.state} />
              </div>
              {c.lastError && <p className="mt-2 text-sm text-bad">{c.lastError}</p>}
              <IdentityLink connectionId={c.id} identity={c.identity} />
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(CAP_LABELS).map(([k, label]) => (
                  <Badge key={k} tone={a.capabilities?.[k] ? 'ok' : 'neutral'}>
                    {a.capabilities?.[k] ? label : `${label}: off`}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 break-words text-xs text-muted">Granted: {a.grantedPermissions.join(', ') || 'none'}</p>
              {a.missingPermissions.length > 0 && (
                <p className="mt-1 break-words text-xs text-muted">
                  Missing: {a.missingPermissions.join(', ')}. Reconnect to grant them; for accounts that are
                  not your own testers Meta App Review is required.
                </p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone={TOKEN_TONE[a.token.status] ?? 'neutral'}>
                  Token {a.token.status === 'OK' ? 'healthy' : titleCase(a.token.status)}
                </Badge>
                {a.token.expiresAt && (
                  <span>
                    expires {new Date(a.token.expiresAt).toLocaleDateString()} ({a.token.daysRemaining} days)
                  </span>
                )}
                <span>Last API check: {a.lastApiCheckAt ? ago(a.lastApiCheckAt) : 'never'}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton
                  onAction={async () => {
                    await post('/integrations/instagram/test', { connectionId: c.id });
                    await reload();
                  }}
                  success="Connection checked"
                >
                  Test
                </ActionButton>
                <PermissionConnect provider="instagram" granted={a.grantedPermissions ?? c.scopes ?? []} label="Reconnect" />
                <ActionButton
                  variant="danger"
                  confirm="Disconnect this Instagram account and delete the stored token? Imported posts stay."
                  onAction={async () => {
                    await post(`/connections/${c.id}/disconnect`, {});
                    await reload();
                  }}
                >
                  Disconnect
                </ActionButton>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3">
        <PermissionConnect
          provider="instagram"
          granted={accounts[0]?.account?.grantedPermissions ?? accounts[0]?.scopes ?? []}
          label={accounts.length ? 'Connect another account' : 'Connect Instagram'}
          variant="primary"
        />
      </div>
    </Card>
  );
}

/** Facebook Pages: one block per connected Page. Messenger + Page comments, read and reply. Never tokens. */
function FacebookCard({
  row,
  connect,
  reload,
}: {
  row: any;
  connect: (provider: string) => Promise<void>;
  reload: () => unknown;
}) {
  const pages: any[] = row.connections ?? [];
  const caps = row.capabilities;
  return (
    <Card className="h-full min-w-0">
      <div className="flex items-start gap-2">
        <h2 className="flex flex-1 items-center gap-2 font-semibold"><PlatformLogo platform="facebook" />Facebook Pages</h2>
        <StateBadge state={summaryState(row)} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Read and reply to Messenger messages and comments on your Page posts. Nothing is sent until you press
        send on a reply.
      </p>
      {pages.length === 0 && caps.blockers?.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {caps.blockers.map((b: string) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {pages.length === 0 && caps.setupSteps?.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-accent">How to set this up</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
            {caps.setupSteps.map((s: string) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>
      )}
      <ul className="mt-3 space-y-3">
        {pages.map((c) => {
          const cfg = c.config ?? {};
          const missing: string[] = cfg.webhook?.missing ?? [];
          const sync = cfg.social?.sync;
          return (
            <li key={c.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{cfg.pageName ?? c.label}</p>
                  <p className="truncate text-xs text-muted">
                    Page ID {c.principalHint}
                    {cfg.category ? ` · ${cfg.category}` : ''}
                  </p>
                </div>
                <StateBadge state={c.state} />
              </div>
              {c.lastError && <p className="mt-2 text-sm text-bad">{c.lastError}</p>}
              <IdentityLink connectionId={c.id} identity={c.identity} />
              <p className="mt-2 break-words text-xs text-muted">Granted: {(c.scopes ?? []).join(', ') || 'none'}</p>
              {cfg.declinedPermissions?.length > 0 && (
                <p className="mt-1 text-xs text-muted">
                  Not granted: {cfg.declinedPermissions.join(', ')}. Reconnect and allow them.
                </p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone={cfg.webhook && missing.length === 0 ? 'ok' : 'neutral'}>
                  {cfg.webhook
                    ? missing.length === 0
                      ? 'Webhooks subscribed'
                      : `Webhooks missing: ${missing.join(', ')}`
                    : 'Webhooks not checked'}
                </Badge>
                <span>Last sync: {c.lastSyncAt ? ago(c.lastSyncAt) : 'never'}</span>
              </p>
              {sync?.counts && (
                <p className="mt-1 text-xs text-muted">
                  Last import: {sync.counts.posts ?? 0} posts, {sync.counts.comments ?? 0} comments,{' '}
                  {sync.counts.messages ?? 0} messages.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton
                  variant="primary"
                  onAction={async () => {
                    await post(`/socials/accounts/${c.id}/sync`);
                    await reload();
                  }}
                  success="Sync finished"
                >
                  Sync now
                </ActionButton>
                <ActionButton
                  onAction={async () => {
                    await post(`/socials/accounts/${c.id}/facebook/test`);
                    await reload();
                  }}
                  success="Connection checked"
                >
                  Test
                </ActionButton>
                <ActionButton
                  onAction={async () => {
                    await post(`/socials/accounts/${c.id}/facebook/subscribe`);
                    await reload();
                  }}
                  success="Webhooks subscribed"
                >
                  Subscribe webhooks
                </ActionButton>
                {!(c.scopes ?? []).includes('pages_manage_posts') && (
                  <PermissionConnect
                    provider="facebook"
                    granted={c.scopes ?? []}
                    extra={['pages_manage_posts']}
                    label="Enable Page videos"
                    variant="primary"
                  />
                )}
                <PermissionConnect provider="facebook" granted={c.scopes ?? []} label="Reconnect" />
                <ActionButton
                  variant="danger"
                  confirm="Disconnect this Page and delete the stored token? Imported messages stay."
                  onAction={async () => {
                    await post(`/connections/${c.id}/disconnect`, {});
                    await reload();
                  }}
                >
                  Disconnect
                </ActionButton>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3">
        <PermissionConnect
          provider="facebook"
          granted={pages[0]?.scopes ?? []}
          label={pages.length ? 'Connect another Page' : 'Connect Facebook Page'}
          variant="primary"
        />
      </div>
    </Card>
  );
}
