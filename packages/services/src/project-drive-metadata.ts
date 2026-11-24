import { z } from 'zod';

const uuid = z.string().uuid();

/** Stable filenames avoid accidentally applying one video's metadata to another with the same basename. */
export function metadataFileName(itemId: string, accountId: string) {
  return `meta__${itemId}__${accountId}.json`;
}

export type SocialMetadata = z.infer<typeof socialMetadataSchema>;

export const socialMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: uuid,
  publishItemId: uuid,
  fileInstanceId: uuid,
  fileName: z.string().min(1).max(500),
  socialAccountId: uuid,
  platform: z.enum(['youtube', 'instagram', 'facebook', 'tiktok', 'threads']),
  ready: z.boolean(),
  title: z.string().max(300),
  caption: z.string().max(5000),
  hashtags: z.array(z.string().trim().max(100)).max(30),
  privacy: z.string().max(40).nullable().optional(),
  contentForm: z.string().max(80).nullable().optional(),
  playlistIds: z.array(z.string().max(80)).max(20).default([]),
  aiUse: z.enum(['YES', 'NO']).nullable().optional(),
  /** ChatGPT's proposed cover copy; used by the per-social thumbnail designer. */
  thumbnail: z.object({
    headline: z.string().max(90),
    subheadline: z.string().max(55),
    style: z.enum(['cinematic', 'bold', 'minimal']),
    focalX: z.number().min(0).max(1).default(0.5),
    aspect: z.enum(['9:16', '16:9', '4:5', '1.91:1']).optional(),
    placement: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
    fontStyle: z.enum(['impact', 'geometric', 'condensed']).optional(),
    hookType: z.enum(['curiosity', 'emotion', 'performance', 'dramatic', 'crowd', 'beauty']).optional(),
    notes: z.string().max(500).optional(),
  }).optional(),
}).strict();

export function metadataTemplate(projectId: string, target: {
  itemId: string; fileInstanceId: string; fileName: string; accountId: string; platform: string;
}) {
  return {
    schemaVersion: 1,
    projectId,
    publishItemId: target.itemId,
    fileInstanceId: target.fileInstanceId,
    fileName: target.fileName,
    socialAccountId: target.accountId,
    platform: target.platform,
    ready: false,
    title: '',
    caption: '',
    hashtags: [],
    privacy: target.platform === 'youtube' ? 'PRIVATE' : null,
    contentForm: target.platform === 'youtube' ? 'SHORT' : target.platform === 'instagram' ? 'REEL' : null,
    playlistIds: [],
    aiUse: 'YES',
    thumbnail: {
      headline: '',
      subheadline: 'MEHAK THAKUR · NEW MUSIC',
      style: 'cinematic',
      focalX: 0.5,
      placement: 'bottom-left',
      fontStyle: 'geometric',
      hookType: 'performance',
      notes: 'Use a clear expressive frame. Keep short, high-contrast text off the eyes and face.',
      aspect: target.platform === 'youtube' || target.platform === 'instagram' || target.platform === 'tiktok'
        ? '9:16'
        : target.platform === 'threads' ? '4:5' : '1.91:1',
    },
  };
}

export function parseSocialMetadata(raw: unknown, expected: {
  projectId: string; itemId: string; fileInstanceId: string; fileName: string; accountId: string; platform: string;
}): SocialMetadata {
  const meta = socialMetadataSchema.parse(raw);
  if (
    meta.projectId !== expected.projectId ||
    meta.publishItemId !== expected.itemId ||
    meta.fileInstanceId !== expected.fileInstanceId ||
    meta.fileName !== expected.fileName ||
    meta.socialAccountId !== expected.accountId ||
    meta.platform !== expected.platform
  ) throw new Error('Metadata identity does not match this project, video, and social account.');
  if (meta.ready && !meta.caption.trim() && !meta.title.trim()) {
    throw new Error('Ready metadata must have a title or caption.');
  }
  if (meta.ready && meta.platform === 'youtube' && !meta.title.trim()) {
    throw new Error('YouTube requires a non-empty title.');
  }
  // Public-facing titles and thumbnail copy must not advertise the production process.
  // Preserve truthful platform-required disclosure separately in aiUse.
  const prohibited = /\b(?:ai[ -]?generated|generated (?:by|with) ai|ai[ -]?model|synthetic (?:media|visual|person)|virtual (?:influencer|artist)|text[ -]?to[ -]?(?:image|video)|rendered (?:with|by) ai)\b/i;
  const visible = [meta.title, meta.thumbnail?.headline, meta.thumbnail?.subheadline].filter(Boolean);
  if (visible.some((value) => prohibited.test(value!))) {
    throw new Error('Public title and thumbnail copy must not include production-process labels. Keep required disclosures in aiUse.');
  }
  return meta;
}
