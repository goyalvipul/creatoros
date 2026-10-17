'use client';

import { useState } from 'react';
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
import { post, refresh, useApi } from '@/lib/api';
import { ago, title as titleCase } from '@/lib/format';

const NAMES: Record<string, string> = {
  gmail: 'Gmail (read-only)',
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
      name: 'baseUrl' | 'apiKey' | 'accessToken' | 'igUserId';
      label: string;
      type?: string;
      hint?: string;
    }[];
  }
> = {
  todo: {
    fields: [
      { name: 'baseUrl', label: 'Todo API base URL', type: 'url', hint: 'e.g. http://localhost:5000/api' },
      { name: 'apiKey', label: 'API token', type: 'password' },
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
      <Notice tone="info" title="Safe by design">
        Gmail access is read-only. Creator OS never sends e-mail, posts to social platforms or pays anything
        on its own. Credentials are stored encrypted on your machine.
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
                        <div className="mt-3 flex flex-wrap gap-2">
                          {OAUTH.includes(p.provider) && !connected && p.state !== 'UNSUPPORTED' && (
                            <ActionButton variant="primary" onAction={() => connect(p.provider)}>
                              Connect
                            </ActionButton>
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
            await post(`/integrations/${setup}/key`, {
              apiKey: vals.apiKey || undefined,
              accessToken: vals.accessToken || undefined,
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
