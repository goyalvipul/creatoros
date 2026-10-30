'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
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
  Notice,
  PageHeader,
} from '@/components/ui';
import { PublishFields, parseTags } from '@/components/publish-fields';
import { del, post, refresh, useApi } from '@/lib/api';
import { title as titleCase } from '@/lib/format';

export default function PublishTitlePage() {
  const { id } = useParams<{ id: string }>();
  const page = useApi<any>(id ? `/variants/${id}/publish` : null, { refreshInterval: 4000 });
  const [linkOpen, setLinkOpen] = useState(false);
  const [form, setForm] = useState<{ item: any; account: any; draft?: any } | null>(null);

  return (
    <>
      <Async res={page}>
        {(data) => (
          <>
            <PageHeader
              title={data.title}
              subtitle={data.assetTitle}
              actions={
                <Link href="/publishing" className="text-sm text-accent hover:underline">
                  Back to plan
                </Link>
              }
            />
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">
                Attach videos, then publish each one. Nothing is sent until you press Publish. Removing a link
                does not delete the file or a post that already went out.
              </p>
              <Button variant="primary" onClick={() => setLinkOpen(true)}>
                Link a file
              </Button>
            </div>
            {data.items.length === 0 ? (
              <EmptyState title="No videos attached" action={<Button onClick={() => setLinkOpen(true)}>Link a file</Button>}>
                The list is the videos already in {data.assetTitle}.
              </EmptyState>
            ) : (
              <ul className="grid gap-3">
                {data.items.map((item: any) => (
                  <li key={item.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.fileName}</p>
                          <p className="truncate text-xs text-muted">{item.displayPath}</p>
                          <p className="text-xs text-muted">
                            {item.deviceName}
                            {item.deviceState !== 'ONLINE' ? ' · machine offline' : ''}
                          </p>
                        </div>
                        <ActionButton
                          onAction={async () => {
                            await del(`/variants/${id}/files/${item.id}`);
                            await refresh(`/variants/${id}/publish`, '/publishing/matrix');
                          }}
                          confirm="Unlink this video from the title? The file and any post already sent stay."
                        >
                          Unlink
                        </ActionButton>
                      </div>
                      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                        {data.accounts.map((account: any) => {
                          const draft = (data.drafts as any[]).find(
                            (d) => d.itemId === item.id && d.accountId === account.id,
                          );
                          return (
                            <li key={account.id} className="rounded-lg border border-border p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">
                                  {titleCase(account.platform)} · {account.handle}
                                </span>
                                {draft && <Badge tone={tone(draft.uploadState)}>{label(draft.uploadState)}</Badge>}
                              </div>
                              {draft?.error && <p className="mt-1 text-xs text-bad">{draft.error}</p>}
                              {draft?.url && (
                                <a
                                  href={draft.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 block truncate text-xs text-accent hover:underline"
                                >
                                  {draft.url}
                                </a>
                              )}
                              {!account.canPublish && (
                                <p className="mt-1 text-xs text-muted">{account.reason}</p>
                              )}
                              <Button
                                className="mt-2"
                                disabled={!account.canPublish || locked(draft?.uploadState)}
                                onClick={() => setForm({ item, account, draft })}
                              >
                                {draft?.uploadState === 'PUBLISHED' ? 'Published' : draft?.error ? 'Try again' : 'Publish'}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            {data.accounts.length === 0 && (
              <Notice tone="warn" title="No social accounts yet">
                Add accounts in Channels, then connect them in Integrations.
              </Notice>
            )}
          </>
        )}
      </Async>
      {linkOpen && id && page.data?.assetId && (
        <LinkDialog
          variantId={id}
          assetId={page.data.assetId}
          assetTitle={page.data.assetTitle}
          onClose={() => setLinkOpen(false)}
        />
      )}
      {form && id && (
        <PublishDialog
          variantId={id}
          item={form.item}
          account={form.account}
          draft={form.draft}
          onClose={() => setForm(null)}
        />
      )}
    </>
  );
}

function locked(state?: string) {
  return state === 'QUEUED' || state === 'UPLOADING' || state === 'PUBLISHED';
}

function label(state: string) {
  if (state === 'QUEUED' || state === 'UPLOADING') return 'Uploading';
  if (state === 'PUBLISHED') return 'Published';
  if (state === 'UNCERTAIN') return 'Check the platform';
  if (state === 'FAILED') return 'Failed';
  return titleCase(state);
}

function tone(state: string): 'ok' | 'bad' | 'warn' | 'neutral' {
  if (state === 'PUBLISHED') return 'ok';
  if (state === 'FAILED') return 'bad';
  if (state === 'UNCERTAIN' || state === 'QUEUED' || state === 'UPLOADING') return 'warn';
  return 'neutral';
}

function LinkDialog({
  variantId,
  assetId,
  assetTitle,
  onClose,
}: {
  variantId: string;
  assetId: string;
  assetTitle?: string;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const files = useApi<{ items: any[] }>('/library', {
    query: { kind: 'VIDEO', assetId, sameFolder: true, q, limit: 200 },
  });
  return (
    <FormDialog open onClose={onClose} title="Link a video" submitLabel="Close" onSubmit={async () => {}}>
      <p className="text-sm text-muted">
        Every video in the same folder on this machine as {assetTitle || 'this asset'}.
      </p>
      <Field label="Search this asset">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="File name or path" />
      </Field>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {(files.data?.items ?? []).map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="w-full rounded-lg border border-border px-2 py-1.5 text-left text-sm hover:border-accent"
              onClick={async () => {
                await post(`/variants/${variantId}/files`, { fileInstanceId: f.id });
                await refresh(`/variants/${variantId}/publish`, '/publishing/matrix');
                onClose();
              }}
            >
              <span className="block truncate font-medium">{f.fileName}</span>
              <span className="block truncate text-xs text-muted">
                {f.deviceName} · {f.displayPath}
              </span>
            </button>
          </li>
        ))}
        {files.data && files.data.items.length === 0 && (
          <li className="text-sm text-muted">No videos in this asset match that search.</li>
        )}
      </ul>
    </FormDialog>
  );
}

function PublishDialog({
  variantId,
  item,
  account,
  draft,
  onClose,
}: {
  variantId: string;
  item: any;
  account: any;
  draft?: any;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(draft?.title ?? '');
  const [caption, setCaption] = useState(draft?.caption ?? '');
  const [tags, setTags] = useState((draft?.hashtags ?? []).join(', '));
  const [privacy, setPrivacy] = useState(draft?.privacy ?? '');
  const [contentForm, setContentForm] = useState(draft?.contentForm ?? '');
  const platform = account.platform as string;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Publish to ${titleCase(platform)}`}
      submitLabel="Publish"
      onSubmit={async () => {
        await post('/publishing/publish', {
          itemId: item.id,
          socialAccountId: account.id,
          requestId: crypto.randomUUID(),
          title: title.trim() || null,
          caption: caption.trim() || null,
          hashtags: parseTags(tags),
          privacy: privacy || null,
          contentForm: contentForm || null,
        });
        await refresh(`/variants/${variantId}/publish`, '/publishing/matrix');
      }}
    >
      <p className="text-sm text-muted">
        {item.fileName} → {account.handle}. This sends the file. It is not moved or changed.
      </p>
      <PublishFields
        platform={platform}
        item={item}
        title={title}
        setTitle={setTitle}
        caption={caption}
        setCaption={setCaption}
        tags={tags}
        setTags={setTags}
        privacy={privacy}
        setPrivacy={setPrivacy}
        contentForm={contentForm}
        setContentForm={setContentForm}
      />
    </FormDialog>
  );
}
