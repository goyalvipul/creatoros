'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';

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
      </>
    );
  }
  if (platform === 'instagram') {
    return (
      <>
        <Field label="Caption">
          <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Field label="Hashtags">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="music, newrelease" />
        </Field>
        <p className="text-xs text-muted">Posted as a Reel.</p>
      </>
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
