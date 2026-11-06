'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ApiError, api, post } from '@/lib/api';
import { THREADS_REPLIES, TIKTOK_PRIVACY, threadsTextUnits, tiktokCaption, tiktokInteractionForm, tiktokInteractions } from '@creatoros/domain';

const PRIVACY = [
  { id: 'PUBLIC', label: 'Public' },
  { id: 'UNLISTED', label: 'Unlisted' },
  { id: 'PRIVATE', label: 'Private' },
];

export function shortNote(item: { width?: number | null; height?: number | null; durationMs?: number | null }) {
  const w = Number(item.width);
  const h = Number(item.height);
  const ms = Number(item.durationMs);
  const size = w > 0 && h > 0 ? `${w}×${h}` : '';
  const length = ms > 0 ? `${Math.round(ms / 1000)}s` : '';
  const measured = [size, length].filter(Boolean).join(', ');
  const fits = w > 0 && h > 0 && h >= w && ms > 0 && ms <= 180_000;
  if (fits) return 'This file is vertical and 3 minutes or shorter, so YouTube can list it as a Short.';
  if (measured)
    return `This file is ${measured}. YouTube only lists a Short when the picture is vertical or square and the video is 3 minutes or shorter. A wide file still posts as a normal video.`;
  return 'YouTube only lists a Short when the picture is vertical or square and the video is 3 minutes or shorter. A wide file still posts as a normal video.';
}

export function parseTags(tags: string): string[] {
  return String(tags)
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, ''))
    .filter(Boolean);
}

export function publishHashtags(platform: string, tags: string): string[] {
  if (platform === 'threads') {
    const topic = tags.trim().replace(/^#/, '');
    return topic ? [topic] : [];
  }
  return parseTags(tags);
}

export function publishPrivacy(platform: string, privacy: string): string | null {
  if (platform === 'threads') return privacy || 'everyone';
  return privacy || null;
}

/** The same boxes the live Publish dialog asks for, by platform. */
export function PublishFields({
  platform,
  item,
  title,
  setTitle,
  caption,
  setCaption,
  tags,
  setTags,
  privacy,
  setPrivacy,
  contentForm,
  setContentForm,
  accountId,
  playlistIds,
  setPlaylistIds,
  aiUse,
  setAiUse,
}: {
  platform: string;
  item?: { width?: number | null; height?: number | null; durationMs?: number | null } | null;
  title: string;
  setTitle: (v: string) => void;
  caption: string;
  setCaption: (v: string) => void;
  tags: string;
  setTags: (v: string) => void;
  privacy: string;
  setPrivacy: (v: string) => void;
  contentForm: string;
  setContentForm: (v: string) => void;
  accountId?: string;
  playlistIds?: string[];
  setPlaylistIds?: (v: string[]) => void;
  aiUse?: string;
  setAiUse?: (v: string) => void;
}) {
  if (platform === 'youtube') {
    return (
      <>
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Field label="Tags">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="song, mehak" />
        </Field>
        <p className="text-xs text-muted">Tags are sent as YouTube tags. The description is only the text above.</p>
        <Field label="Type">
          <Select required value={contentForm} onChange={(e) => setContentForm(e.target.value)}>
            <option value="">Choose…</option>
            <option value="VIDEO">Video</option>
            <option value="SHORT">Short</option>
          </Select>
        </Field>
        <p className="text-xs text-muted">
          {contentForm === 'SHORT'
            ? `${shortNote(item ?? {})} Choosing Short adds #Shorts to the title. The file is not cropped.`
            : contentForm === 'VIDEO'
              ? 'Posts as a normal video.'
              : 'Choose Video or Short. YouTube lists a Short when the file is vertical or square and at most 3 minutes.'}
        </p>
        <Field label="Privacy">
          <Select required value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            <option value="">Choose…</option>
            {PRIVACY.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {accountId && setPlaylistIds ? (
          <YoutubePlaylists accountId={accountId} playlistIds={playlistIds ?? []} setPlaylistIds={setPlaylistIds} />
        ) : null}
        <Field label="AI use">
          <Select required value={aiUse ?? ''} onChange={(e) => setAiUse?.(e.target.value)}>
            <option value="">Choose…</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </Select>
        </Field>
        <p className="text-xs text-muted">
          YouTube asks if the video uses altered or synthetic media. Yes and No are sent with the upload. Nothing is sent until you schedule or publish.
        </p>
      </>
    );
  }
  if (platform === 'instagram') {
    return (
      <>
        <Field label="Post title (optional)">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Caption / description">
          <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Field label="Hashtags">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="music, newrelease" />
        </Field>
        <p className="text-xs text-muted">Posted as a Reel. The title is kept with the draft. The caption is what Instagram shows.</p>
      </>
    );
  }
  if (platform === 'threads') {
    const units = threadsTextUnits(caption);
    return (
      <>
        <Field label="Post text">
          <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Optional with a photo or video" />
        </Field>
        <p className={units > 500 ? 'text-xs text-bad' : 'text-xs text-muted'}>
          {units} / 500. Threads counts an emoji as more than one character. A JPEG, PNG, MP4, or MOV is posted with this text. A video can be at most 5 minutes.
        </p>
        <Field label="Topic">
          <Input value={tags.replace(/^#/, '')} onChange={(e) => setTags(e.target.value.replace(/[#\s]/g, ''))} placeholder="newsong" />
        </Field>
        <p className="text-xs text-muted">One topic, with no spaces, period, or &. Leave it blank for no topic.</p>
        <Field label="Who can reply">
          <Select required value={privacy || 'everyone'} onChange={(e) => setPrivacy(e.target.value)}>
            {THREADS_REPLIES.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="AI label">
          <Select required value={aiUse ?? ''} onChange={(e) => setAiUse?.(e.target.value)}>
            <option value="">Choose…</option>
            <option value="YES">Yes, label this as AI</option>
            <option value="NO">No</option>
          </Select>
        </Field>
        <p className="text-xs text-muted">Yes asks Threads to show the AI info label. A link card is only available on a text-only post, so this file post does not attach one.</p>
      </>
    );
  }
  if (platform === 'tiktok') {
    return (
      <TikTokFields
        accountId={accountId}
        caption={caption}
        setCaption={setCaption}
        tags={tags}
        setTags={setTags}
        privacy={privacy}
        setPrivacy={setPrivacy}
        contentForm={contentForm}
        setContentForm={setContentForm}
      />
    );
  }
  if (platform === 'facebook') {
    return (
      <>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
      </>
    );
  }
  return (
    <Field label="Caption">
      <Textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} />
    </Field>
  );
}

function TikTokFields({
  accountId,
  caption,
  setCaption,
  tags,
  setTags,
  privacy,
  setPrivacy,
  contentForm,
  setContentForm,
}: {
  accountId?: string;
  caption: string;
  setCaption: (v: string) => void;
  tags: string;
  setTags: (v: string) => void;
  privacy: string;
  setPrivacy: (v: string) => void;
  contentForm: string;
  setContentForm: (v: string) => void;
}) {
  const flags = tiktokInteractions(contentForm);
  const [options, setOptions] = useState<{
    privacyOptions: string[];
    commentDisabled: boolean;
    duetDisabled: boolean;
    stitchDisabled: boolean;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const length = tiktokCaption(caption, parseTags(tags)).length;
  const choices = TIKTOK_PRIVACY.filter((row) => !options?.privacyOptions.length || options.privacyOptions.includes(row.id));

  useEffect(() => {
    if (!contentForm || contentForm === 'VIDEO' || contentForm === 'SHORT') setContentForm('comments,duet,stitch');
    // Once, so clearing every box later stays cleared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let gone = false;
    void api<{ privacyOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean }>(
      `/social-accounts/${accountId}/tiktok/creator`,
    )
      .then((page) => {
        if (gone || !page) return;
        setOptions(page);
        const allowed = page.privacyOptions ?? [];
        if (allowed.length === 1) setPrivacy(allowed[0] ?? '');
        else if (privacy && allowed.length && !allowed.includes(privacy)) setPrivacy('');
        const next = tiktokInteractions(contentForm);
        setContentForm(
          tiktokInteractionForm({
            comments: page.commentDisabled ? false : next.comments,
            duet: page.duetDisabled ? false : next.duet,
            stitch: page.stitchDisabled ? false : next.stitch,
          }),
        );
      })
      .catch((e) => {
        if (!gone) setNotice(e instanceof ApiError ? e.message : 'TikTok did not return who can watch this video.');
      });
    return () => {
      gone = true;
    };
    // Load once per account. Later checkbox edits must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const toggle = (key: 'comments' | 'duet' | 'stitch') => {
    setContentForm(tiktokInteractionForm({ ...flags, [key]: !flags[key] }));
  };

  return (
    <>
      <Field label="Caption">
        <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      <Field label="Hashtags">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="song, mehak" />
      </Field>
      <p className={length > 2200 ? 'text-xs text-bad' : 'text-xs text-muted'}>{length} / 2200, including hashtags. TikTok shows this as the video caption.</p>
      <Field label="Who can watch">
        <Select required value={choices.some((row) => row.id === privacy) ? privacy : ''} onChange={(e) => setPrivacy(e.target.value)}>
          <option value="">Choose…</option>
          {choices.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-muted">An app TikTok has not audited is often allowed to post as Only me. The list is what TikTok returns for this account.</p>
      {notice ? <p className="text-xs text-warn">{notice}</p> : null}
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={flags.comments && !options?.commentDisabled} disabled={options?.commentDisabled} onChange={() => toggle('comments')} />
          Comments
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={flags.duet && !options?.duetDisabled} disabled={options?.duetDisabled} onChange={() => toggle('duet')} />
          Duet
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={flags.stitch && !options?.stitchDisabled} disabled={options?.stitchDisabled} onChange={() => toggle('stitch')} />
          Stitch
        </label>
      </div>
      <p className="text-xs text-muted">A box TikTok turns off for this account stays off. Nothing is sent until you schedule or publish.</p>
    </>
  );
}

function YoutubePlaylists({
  accountId,
  playlistIds,
  setPlaylistIds,
}: {
  accountId: string;
  playlistIds: string[];
  setPlaylistIds: (v: string[]) => void;
}) {
  const [rows, setRows] = useState<{ id: string; title: string }[]>([]);
  const [canCreate, setCanCreate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState('UNLISTED');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let gone = false;
    setLoading(true);
    setError(null);
    void api<{ playlists: { id: string; title: string }[]; canCreate: boolean }>(
      `/social-accounts/${accountId}/youtube/playlists`,
    )
      .then((page) => {
        if (gone || !page) return;
        setRows(page.playlists ?? []);
        setCanCreate(page.canCreate !== false);
      })
      .catch((e) => {
        if (!gone) setError(e instanceof ApiError ? e.message : 'Playlists could not be loaded from YouTube.');
      })
      .finally(() => {
        if (!gone) setLoading(false);
      });
    return () => {
      gone = true;
    };
  }, [accountId]);

  const shown = [
    ...rows,
    ...playlistIds.filter((id) => !rows.some((row) => row.id === id)).map((id) => ({ id, title: id })),
  ];

  async function create() {
    const title = name.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const created = await post<{ id: string; title: string }>(`/social-accounts/${accountId}/youtube/playlists`, {
        title,
        privacy,
      });
      if (created?.id) {
        setRows((cur) => (cur.some((row) => row.id === created.id) ? cur : [...cur, { id: created.id, title: created.title || title }]));
        if (!playlistIds.includes(created.id)) setPlaylistIds([...playlistIds, created.id]);
        setName('');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'YouTube did not create the playlist.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <Field label="Playlists">
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-panel2 p-2">
          {loading ? <p className="text-xs text-muted">Loading playlists from YouTube…</p> : null}
          {!loading && shown.length === 0 ? <p className="text-xs text-muted">This channel has no playlists yet.</p> : null}
          {shown.map((row) => (
            <label key={row.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={playlistIds.includes(row.id)}
                onChange={() =>
                  setPlaylistIds(
                    playlistIds.includes(row.id) ? playlistIds.filter((id) => id !== row.id) : [...playlistIds, row.id],
                  )
                }
              />
              <span className="truncate">{row.title}</span>
            </label>
          ))}
        </div>
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="New playlist">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" />
        </Field>
        <Field label="Playlist privacy">
          <Select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            {PRIVACY.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button size="sm" busy={creating} disabled={!name.trim() || !canCreate} onClick={() => void create()}>
          Create
        </Button>
      </div>
      {!canCreate ? (
        <p className="text-xs text-muted">Creating a playlist needs the YouTube manage permission. Integrations → Enable comments, then reload.</p>
      ) : (
        <p className="text-xs text-muted">Create adds the playlist on YouTube now. The video is added to the checked playlists when you schedule or publish.</p>
      )}
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
