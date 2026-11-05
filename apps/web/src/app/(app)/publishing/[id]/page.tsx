'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FileDownload } from '@/components/file-download';
import { VideoTrim } from '@/components/video-trim';
import {
  ActionButton,
  Async,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FormDialog,
  Input,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui';
import { PublishFields, parseTags } from '@/components/publish-fields';
import { ApiError, del, post, refresh, useApi } from '@/lib/api';
import { title as titleCase } from '@/lib/format';
import { useRoots } from '@/lib/options';

export default function PublishTitlePage() {
  const { id } = useParams<{ id: string }>();
  const page = useApi<any>(id ? `/variants/${id}/publish` : null, { refreshInterval: 4000 });
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [play, setPlay] = useState<{ id: string; fileName: string; online: boolean } | null>(null);
  const [trimId, setTrimId] = useState<string | null>(null);
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
              <div className="flex gap-2">
                <Button onClick={() => setUploadOpen(true)}>Upload</Button>
                <Button variant="primary" onClick={() => setLinkOpen(true)}>
                  Link a file
                </Button>
              </div>
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
                          <button
                            type="button"
                            className="truncate font-medium text-accent hover:underline"
                            onClick={() =>
                              setPlay({
                                id: item.fileInstanceId,
                                fileName: item.fileName,
                                online: item.deviceState === 'ONLINE',
                              })
                            }
                          >
                            {item.fileName}
                          </button>
                          <p className="truncate text-xs text-muted">{item.displayPath}</p>
                          <p className="text-xs text-muted">
                            {item.deviceName}
                            {item.deviceState !== 'ONLINE' ? ' · machine offline' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.deviceState === 'ONLINE' && item.fileInstanceId && (
                            <FileDownload
                              href={`/api/v1/files/${item.fileInstanceId}/stream?download=1`}
                              name={item.fileName}
                            />
                          )}
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
      {uploadOpen && id && (
        <UploadDialog
          variantId={id}
          onClose={() => setUploadOpen(false)}
        />
      )}
      {play && (
        <Dialog open onClose={() => setPlay(null)} title={play.fileName} wide>
          {play.online ? (
            <div className="space-y-3">
              <video className="max-h-80 w-full rounded-lg bg-black object-contain" controls autoPlay preload="metadata" src={`/api/v1/files/${play.id}/stream`} />
              <Button size="sm" onClick={() => { setTrimId(play.id); setPlay(null); }}>
                Edit video
              </Button>
            </div>
          ) : (
            <Notice tone="info" title="That PC is off">
              The video plays when the machine that holds it is back on. It is not missing.
            </Notice>
          )}
        </Dialog>
      )}
      {trimId && id ? <VideoTrim fileId={trimId} variantId={id} onClose={() => setTrimId(null)} /> : null}
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

function UploadDialog({ variantId, onClose }: { variantId: string; onClose: () => void }) {
  const roots = useRoots();
  const [rootId, setRootId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const choices = (roots.data ?? []).filter((r) => r.state === 'ACTIVE' && r.deviceState === 'ONLINE');
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Upload a video"
      submitLabel="Upload and link"
      onSubmit={async () => {
        if (!file || !rootId) throw new ApiError(400, 'BAD_REQUEST', 'Choose a video and a folder on a PC that is on.');
        const res = await fetch(
          `/api/v1/variants/${variantId}/upload?rootId=${encodeURIComponent(rootId)}&name=${encodeURIComponent(file.name)}`,
          {
            method: 'POST',
            headers: { 'x-requested-with': 'creatoros', 'content-type': 'application/x-creatoros-file' },
            body: file,
          },
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new ApiError(res.status, json?.error?.code ?? 'UPLOAD', json?.error?.message ?? 'The upload did not finish.');
        }
        await refresh(`/variants/${variantId}/publish`, '/publishing/matrix', '/library');
        onClose();
      }}
    >
      <p className="text-sm text-muted">
        The original file is copied into a folder that PC already indexes. It is not compressed or resized. Publish
        then sends that copy. The PC has to be on, and its scanner has to be the current one.
      </p>
      <Field label="Folder on the PC">
        <Select value={rootId} onChange={(e) => setRootId(e.target.value)}>
          <option value="">Choose a folder</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.deviceName} · {r.label} · {r.displayPath}
            </option>
          ))}
        </Select>
      </Field>
      {roots.data && choices.length === 0 && (
        <p className="text-sm text-muted">No scanned folder has its PC on right now.</p>
      )}
      <Field label="Video">
        <input
          type="file"
          accept=".mp4,.mov,.mkv,.webm,.m4v,video/mp4,video/quicktime,video/webm"
          className="block w-full text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      {file && <p className="text-xs text-muted">{file.name}</p>}
    </FormDialog>
  );
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
