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
import { patch, post, refresh } from '@/lib/api';
import { title as titleCase } from '@/lib/format';
import { PLATFORMS, type Brand, useCatalog } from '@/lib/options';

type Dlg =
  | null
  | { kind: 'brand' }
  | { kind: 'channel'; brand: Brand }
  | { kind: 'account'; channelId: string; channelName: string };

export default function ChannelsPage() {
  const cat = useCatalog();
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
    </>
  );
}
