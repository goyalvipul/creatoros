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

const NAMES: Record<string, string> = {
  gmail: 'Gmail',
  youtube: 'YouTube',
  postiz: 'Postiz (scheduling)',
  todo: 'Todo app',
  meta: 'Instagram (legacy: Facebook Login token)',
  instagram: 'Instagram',
  facebook: 'Facebook Pages',
  threads: 'Threads',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  google: 'Google (umbrella)',
};
const OAUTH = ['gmail', 'youtube'];
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
  postiz: {
    fields: [
      { name: 'baseUrl', label: 'Postiz URL', type: 'url' },
      { name: 'apiKey', label: 'Public API key', type: 'password' },
    ],
  },
  meta: {
    fields: [
      { name: 'accessToken', label: 'Long-lived access token', type: 'password' },
      { name: 'igUserId', label: 'Instagram user id' },
    ],
  },
  tiktok: { fields: [{ name: 'accessToken', label: 'Access token', type: 'password' }] },
};

export default function IntegrationsPage() {
  const res = useApi<any[]>('/integrations');
  const [setup, setSetup] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const reload = () => refresh('/integrations');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
    const q = new URLSearchParams(window.location.search);
    if (q.get('error'))
      setResult({ ok: false, text: `${q.get('error')}${q.get('detail') ? `: ${q.get('detail')}` : ''}` });
    else if (q.get('connected')) setResult({ ok: true, text: `${q.get('connected')} connected.` });
  }, []);

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
                .filter((p) => p.provider !== 'google')
                .map((p) => {
                  const caps = p.capabilities;
                  const conn = p.connection;
                  const connected = p.state === 'ACTIVE' || p.state === 'PARTIAL_SYNC';
                  if (p.provider === 'instagram')
                    return (
                      <li key={p.provider} className="md:col-span-2">
                        <InstagramCard row={p} connect={connect} reload={reload} />
                      </li>
                    );
                  if (p.provider === 'facebook')
                    return (
                      <li key={p.provider} className="md:col-span-2">
                        <FacebookCard row={p} connect={connect} reload={reload} />
                      </li>
                    );
                  return (
                    <li key={p.provider}>
                      <Card className="h-full">
                        <div className="flex items-start gap-2">
                          <h2 className="flex-1 font-semibold">
                            {NAMES[p.provider] ?? titleCase(p.provider)}
                          </h2>
                          <StateBadge state={p.state} />
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
                            <span>
                              Comments appear in Socials (polled; YouTube has no direct messages). Replies are
                              sent only when you press send. A video is uploaded only when you press Publish.
                            </span>
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
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
    <Card>
      <div className="flex items-start gap-2">
        <h2 className="flex-1 font-semibold">Instagram</h2>
        <StateBadge state={row.state} />
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
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
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
              <p className="mt-2 text-xs text-muted">Granted: {a.grantedPermissions.join(', ') || 'none'}</p>
              {a.missingPermissions.length > 0 && (
                <p className="mt-1 text-xs text-muted">
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
                <ActionButton onAction={() => connect('instagram')}>Reconnect</ActionButton>
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
        <ActionButton variant="primary" onAction={() => connect('instagram')}>
          {accounts.length ? 'Connect another account' : 'Connect Instagram'}
        </ActionButton>
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
    <Card>
      <div className="flex items-start gap-2">
        <h2 className="flex-1 font-semibold">Facebook Pages</h2>
        <StateBadge state={row.state} />
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
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
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
              <p className="mt-2 text-xs text-muted">Granted: {(c.scopes ?? []).join(', ') || 'none'}</p>
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
                  <ActionButton
                    variant="primary"
                    onAction={async () => {
                      const r = await post('/integrations/facebook/oauth/start', { videos: true });
                      if (r.authorizeUrl) window.location.href = r.authorizeUrl;
                    }}
                  >
                    Enable Page videos
                  </ActionButton>
                )}
                <ActionButton onAction={() => connect('facebook')}>Reconnect</ActionButton>
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
        <ActionButton variant="primary" onAction={() => connect('facebook')}>
          {pages.length ? 'Connect another Page' : 'Connect Facebook Page'}
        </ActionButton>
      </div>
    </Card>
  );
}
