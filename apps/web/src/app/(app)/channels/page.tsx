'use client';

import { Plus } from 'lucide-react';
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
  Select,
  Textarea,
} from '@/components/ui';
import { useMe } from '@/components/shell';
import { del, patch, post, refresh } from '@/lib/api';
import { title as titleCase } from '@/lib/format';
import { PLATFORMS, type Brand, useCatalog } from '@/lib/options';

type Dlg =
  | null
  | { kind: 'brand' }
  | { kind: 'channel'; brand: Brand }
  | { kind: 'account'; channelId: string; channelName: string }
  | { kind: 'edit-brand'; id: string }
  | { kind: 'edit-channel'; id: string }
  | { kind: 'edit-account'; id: string };

export default function ChannelsPage() {
  const cat = useCatalog();
  const me = useMe();
  const owner = me.data?.user.role === 'OWNER';
  const [dlg, setDlg] = useState<Dlg>(null);
  const [f, setF] = useState({
    name: '',
    description: '',
    purpose: '',
    platform: 'youtube',
    handle: '',
    profileUrl: '',
  });
  const reload = () => refresh('/catalog', '/publishing');
  const startEdit = (d: Dlg, vals: Partial<typeof f>) => {
    setF({
      name: '',
      description: '',
      purpose: '',
      platform: 'youtube',
      handle: '',
      profileUrl: '',
      ...vals,
    });
    setDlg(d);
  };
  const close = () => {
    setDlg(null);
    setF({ name: '', description: '', purpose: '', platform: 'youtube', handle: '', profileUrl: '' });
  };

  return (
    <>
      <PageHeader
        title="Channels"
        subtitle="Brands own channels; channels own the social accounts you publish to."
        actions={
          <Button variant="primary" onClick={() => setDlg({ kind: 'brand' })}>
            <Plus className="size-4" /> New brand
          </Button>
        }
      />
      <Async
        res={cat}
        empty={
          <EmptyState
            title="No brands yet"
            action={
              <Button variant="primary" onClick={() => setDlg({ kind: 'brand' })}>
                Add your first brand
              </Button>
            }
          >
            For example “Mehak” (music) and “Travel with Vipul”.
          </EmptyState>
        }
      >
        {(brands) => (
          <div className="space-y-4">
            {brands.map((b) => (
              <Card key={b.id}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{b.name}</h2>
                  {b.type && <Badge>{titleCase(b.type)}</Badge>}
                  {!b.active && <Badge tone="warn">inactive</Badge>}
                  {b.description && <span className="text-sm text-muted">{b.description}</span>}
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" onClick={() => setDlg({ kind: 'channel', brand: b })}>
                      <Plus className="size-4" /> Channel
                    </Button>
                    <ActionButton
                      size="sm"
                      onAction={async () => {
                        await patch(`/brands/${b.id}`, { active: !b.active });
                        await reload();
                      }}
                    >
                      {b.active ? 'Deactivate' : 'Activate'}
                    </ActionButton>
                    <Button
                      size="sm"
                      aria-label={`Edit brand ${b.name}`}
                      onClick={() =>
                        startEdit(
                          { kind: 'edit-brand', id: b.id },
                          { name: b.name, description: b.description ?? '' },
                        )
                      }
                    >
                      Edit
                    </Button>
                    {owner && (
                      <ActionButton
                        size="sm"
                        variant="danger"
                        aria-label={`Delete brand ${b.name}`}
                        confirm={`Delete the brand "${b.name}"? Its channels and accounts are removed from the lists. Posts, projects and deals already recorded keep their history.`}
                        onAction={async () => {
                          await del(`/brands/${b.id}`);
                          await reload();
                        }}
                        success="Brand deleted"
                      >
                        Delete
                      </ActionButton>
                    )}
                  </div>
                </div>
                {b.channels.length === 0 ? (
                  <p className="text-sm text-muted">No channels yet.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {b.channels.map((c) => (
                      <section
                        key={c.id}
                        className="rounded-xl border border-border p-3"
                        aria-label={`Channel ${c.name}`}
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <h3 className="flex-1 font-medium">{c.name}</h3>
                          <Button
                            size="sm"
                            onClick={() => setDlg({ kind: 'account', channelId: c.id, channelName: c.name })}
                          >
                            <Plus className="size-4" /> Account
                          </Button>
                          <Button
                            size="sm"
                            aria-label={`Edit channel ${c.name}`}
                            onClick={() =>
                              startEdit(
                                { kind: 'edit-channel', id: c.id },
                                { name: c.name, purpose: c.purpose ?? '' },
                              )
                            }
                          >
                            Edit
                          </Button>
                          {owner && (
                            <ActionButton
                              size="sm"
                              variant="danger"
                              aria-label={`Delete channel ${c.name}`}
                              confirm={`Delete the channel "${c.name}"? Its accounts are removed from the lists. Posts already recorded keep their history.`}
                              onAction={async () => {
                                await del(`/channels/${c.id}`);
                                await reload();
                              }}
                              success="Channel deleted"
                            >
                              Delete
                            </ActionButton>
                          )}
                        </div>
                        {c.accounts.length === 0 ? (
                          <p className="text-sm text-muted">No accounts yet.</p>
                        ) : (
                          <ul className="space-y-1">
                            {c.accounts.map((a: any) => (
                              <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                                <Badge tone="info">{titleCase(a.platform)}</Badge>
                                {a.profileUrl ? (
                                  <a
                                    className="text-accent hover:underline"
                                    href={a.profileUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {a.handle}
                                  </a>
                                ) : (
                                  a.handle
                                )}
                                {a.providerConnectionId ? (
                                  <Badge tone="ok">connected</Badge>
                                ) : (
                                  <span className="text-xs text-muted">manual</span>
                                )}
                                <span className="ml-auto flex gap-1">
                                  <Button
                                    size="sm"
                                    aria-label={`Edit account ${a.handle}`}
                                    onClick={() =>
                                      startEdit(
                                        { kind: 'edit-account', id: a.id },
                                        {
                                          handle: a.handle,
                                          profileUrl: a.profileUrl ?? '',
                                          platform: a.platform,
                                        },
                                      )
                                    }
                                  >
                                    Edit
                                  </Button>
                                  {owner && (
                                    <ActionButton
                                      size="sm"
                                      variant="danger"
                                      aria-label={`Delete account ${a.handle}`}
                                      confirm={`Delete the account ${a.handle} (${titleCase(a.platform)})? Posts already recorded for it keep their history.`}
                                      onAction={async () => {
                                        await del(`/social-accounts/${a.id}`);
                                        await reload();
                                      }}
                                      success="Account deleted"
                                    >
                                      Delete
                                    </ActionButton>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Async>
      <FormDialog
        open={dlg?.kind === 'brand'}
        onClose={close}
        title="New brand"
        submitLabel="Create"
        onSubmit={async () => {
          await post('/brands', { name: f.name.trim(), description: f.description.trim() || undefined });
          await reload();
        }}
      >
        <Field label="Brand name">
          <Input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Textarea
            rows={2}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
      </FormDialog>
      <FormDialog
        open={dlg?.kind === 'channel'}
        onClose={close}
        title={dlg?.kind === 'channel' ? `New channel for ${dlg.brand.name}` : ''}
        submitLabel="Create"
        onSubmit={async () => {
          if (dlg?.kind === 'channel')
            await post('/channels', {
              brandId: dlg.brand.id,
              name: f.name.trim(),
              purpose: f.purpose.trim() || undefined,
            });
          await reload();
        }}
      >
        <Field label="Channel name">
          <Input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Purpose">
          <Input
            value={f.purpose}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
            placeholder="e.g. Original music releases"
          />
        </Field>
      </FormDialog>
      <FormDialog
        open={dlg?.kind === 'account'}
        onClose={close}
        title={dlg?.kind === 'account' ? `Add account to ${dlg.channelName}` : ''}
        submitLabel="Add"
        onSubmit={async () => {
          if (dlg?.kind === 'account')
            await post('/social-accounts', {
              channelId: dlg.channelId,
              platform: f.platform,
              handle: f.handle.trim(),
              profileUrl: f.profileUrl.trim() || undefined,
            });
          await reload();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform">
            <Select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
              <Options values={PLATFORMS} />
            </Select>
          </Field>
          <Field label="Handle">
            <Input
              required
              value={f.handle}
              onChange={(e) => setF({ ...f, handle: e.target.value })}
              placeholder="@name"
            />
          </Field>
        </div>
        <Field label="Profile link (optional)">
          <Input
            type="url"
            value={f.profileUrl}
            onChange={(e) => setF({ ...f, profileUrl: e.target.value })}
            placeholder="https://…"
          />
        </Field>
      </FormDialog>
      <FormDialog
        open={dlg?.kind === 'edit-brand'}
        onClose={close}
        title="Edit brand"
        submitLabel="Save"
        onSubmit={async () => {
          if (dlg?.kind === 'edit-brand')
            await patch(`/brands/${dlg.id}`, {
              name: f.name.trim(),
              description: f.description.trim() || null,
            });
          await reload();
        }}
      >
        <Field label="Brand name">
          <Input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Textarea
            rows={2}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
      </FormDialog>
      <FormDialog
        open={dlg?.kind === 'edit-channel'}
        onClose={close}
        title="Edit channel"
        submitLabel="Save"
        onSubmit={async () => {
          if (dlg?.kind === 'edit-channel')
            await patch(`/channels/${dlg.id}`, { name: f.name.trim(), purpose: f.purpose.trim() || null });
          await reload();
        }}
      >
        <Field label="Channel name">
          <Input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Purpose">
          <Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
        </Field>
      </FormDialog>
      <FormDialog
        open={dlg?.kind === 'edit-account'}
        onClose={close}
        title="Edit account"
        submitLabel="Save"
        onSubmit={async () => {
          if (dlg?.kind === 'edit-account')
            await patch(`/social-accounts/${dlg.id}`, {
              handle: f.handle.trim(),
              profileUrl: f.profileUrl.trim() || null,
            });
          await reload();
        }}
      >
        <p className="text-sm text-muted">
          Platform: {titleCase(f.platform)} (to change it, add a new account).
        </p>
        <Field label="Handle">
          <Input
            required
            autoFocus
            value={f.handle}
            onChange={(e) => setF({ ...f, handle: e.target.value })}
          />
        </Field>
        <Field label="Profile link (optional)">
          <Input
            type="url"
            value={f.profileUrl}
            onChange={(e) => setF({ ...f, profileUrl: e.target.value })}
            placeholder="https://…"
          />
        </Field>
      </FormDialog>{' '}
    </>
  );
}
