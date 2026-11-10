import { z } from 'zod';

/** Task names the router understands. The UI does not pick a provider itself. */
export const AI_TASKS = [
  'scene_prompt_generate',
  'scene_prompt_improve',
  'scene_prompt_variations',
  'scene_image_generate',
  'scene_image_edit',
  'video_analyze',
  'publishing_metadata_generate',
  'publishing_metadata_regenerate',
  'publishing_metadata_polish',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_PROMPT_MODELS = ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini', 'gpt-4.1'] as const;
export const AI_IMAGE_MODELS = [
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
] as const;
export const AI_TEXT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash'] as const;
export const AI_IMAGE_ASPECTS = ['16:9', '9:16', '1:1', '4:5', '3:2', '4:3', '21:9'] as const;
export const AI_IMAGE_SIZES = ['1K', '2K'] as const;

/** Published reference-image caps used before a request is sent. Extra pictures are refused, not dropped. */
export const AI_IMAGE_REF_CAP: Record<(typeof AI_IMAGE_MODELS)[number], number> = {
  'gemini-nano-banana-2.1': 8,
  'gemini-3.1-flash-image': 8,
  'gemini-3.1-flash-lite-image': 1,
  'gemini-3-pro-image': 8,
  'gemini-2.5-flash-image': 3,
};

export const DEFAULT_AI_SETTINGS = {
  promptModel: 'gpt-5-mini',
  imageModel: 'gemini-nano-banana-2.1',
  videoModel: 'gemini-2.5-flash',
  metadataModel: 'gemini-2.5-flash',
  imageAspect: '16:9',
  imageSize: '1K',
  tone: 'cinematic, specific, and natural',
  timeoutSec: 90,
  maxAttempts: 2,
  dailyPromptLimit: 40,
  monthlyPromptLimit: 400,
  dailyImageLimit: 4,
  monthlyImageLimit: 30,
  dailyVideoLimit: 4,
  monthlyVideoLimit: 20,
  dailyMetadataLimit: 20,
  monthlyMetadataLimit: 200,
} as const;

const text = z.string().max(4000);
export const scenePromptSchema = z.object({
  imagePrompt: text,
  videoPrompt: text,
  cameraDirection: text,
  subjectActions: text,
  lighting: text,
  environment: text,
  continuityInstructions: text,
  lipSyncNotes: text,
  avoidanceInstructions: text,
  referenceRequirements: text,
});
export type ScenePrompt = z.infer<typeof scenePromptSchema>;

export const promptVariationsSchema = z.object({
  variations: z.array(scenePromptSchema).min(1).max(3),
});

export const videoAnalysisSchema = z.object({
  summary: z.string().max(2000),
  contentType: z.string().max(200),
  visualStyle: z.string().max(400),
  mood: z.string().max(200),
  language: z.string().max(80),
  audioSummary: z.string().max(1500),
  openingHook: z.string().max(800),
  keyMoments: z.array(z.object({ timestamp: z.string().max(20), description: z.string().max(400), reason: z.string().max(300) })).max(12),
  sceneSummaries: z.array(z.string().max(400)).max(12),
  strongPoints: z.array(z.string().max(300)).max(8),
  weakPoints: z.array(z.string().max(300)).max(8),
  suggestedImprovements: z.array(z.string().max(300)).max(8),
  thumbnailCandidates: z.array(z.object({ timestamp: z.string().max(20), concept: z.string().max(300) })).max(6),
  warnings: z.array(z.string().max(300)).max(8),
  confidenceNotes: z.string().max(800),
});
export type VideoAnalysis = z.infer<typeof videoAnalysisSchema>;

export const metadataDraftSchema = z.object({
  titles: z.array(z.string().max(500)).max(5),
  recommendedTitle: z.string().max(500),
  description: z.string().max(5000),
  tags: z.array(z.string().max(40)).max(15),
  hashtags: z.array(z.string().max(40)).max(12),
  caption: z.string().max(2200),
  hook: z.string().max(300),
  cta: z.string().max(300),
  thumbnailText: z.string().max(80),
  thumbnailConcept: z.string().max(400),
  chapters: z.array(z.object({ time: z.string().max(20), title: z.string().max(80) })).max(12),
  pinnedComment: z.string().max(500),
  onScreenText: z.string().max(120),
  warnings: z.array(z.string().max(300)).max(8),
});
export type MetadataDraft = z.infer<typeof metadataDraftSchema>;

export function taskProvider(task: AiTask): 'openai' | 'gemini' {
  if (task.startsWith('scene_prompt')) return 'openai';
  return 'gemini';
}

export function taskGroup(task: AiTask): 'prompt' | 'image' | 'video' | 'metadata' {
  if (task.startsWith('scene_prompt')) return 'prompt';
  if (task.startsWith('scene_image')) return 'image';
  if (task === 'video_analyze') return 'video';
  return 'metadata';
}

export function limitAllows(used: number, limit: number) {
  return used < Math.max(0, limit);
}

export function clampYouTubeTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function joinTags(tags: string[], max = 500) {
  const out: string[] = [];
  let used = 0;
  for (const tag of tags) {
    const clean = tag.replace(/^#/, '').trim();
    if (!clean) continue;
    const next = used + clean.length + (out.length ? 1 : 0);
    if (next > max) break;
    out.push(clean);
    used = next;
  }
  return out;
}

/** Removes a key if a provider error message echoes the request URL. */
export function redactSecrets(message: string) {
  return message.replace(/key=[^&\s]+/gi, 'key=redacted').replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-redacted').slice(0, 500);
}

export function parseScenePrompt(value: unknown): ScenePrompt {
  const parsed = scenePromptSchema.safeParse(value);
  if (!parsed.success) throw new Error('The model did not return a usable prompt. Nothing was applied.');
  return parsed.data;
}

export function parseVideoAnalysis(value: unknown): VideoAnalysis {
  const parsed = videoAnalysisSchema.safeParse(value);
  if (!parsed.success) throw new Error('The video analysis was incomplete. It was not saved.');
  return parsed.data;
}

export function parseMetadataDraft(value: unknown): MetadataDraft {
  const parsed = metadataDraftSchema.safeParse(value);
  if (!parsed.success) throw new Error('The publishing suggestions were incomplete. They were not saved.');
  const draft = parsed.data;
  return { ...draft, recommendedTitle: clampYouTubeTitle(draft.recommendedTitle), titles: draft.titles.map(clampYouTubeTitle).filter(Boolean).slice(0, 5), tags: joinTags(draft.tags) };
}

export const BILLING_NOTE = 'Cost estimate unavailable — this operation may be billable. A connection test does not prove that image or video quota is available.';

/**
 * Kemokem is a private invitation-only app served on the public internet.
 * OpenAI documents ChatGPT-plan usage for open-source tools, personal projects that run locally, and selected private apps.
 * A remotely hosted private app must be approved before Sign in with ChatGPT can spend a ChatGPT plan.
 */
export const CHATGPT_PLAN = {
  state: 'APPROVAL_REQUIRED' as const,
  title: 'ChatGPT-plan integration requires approval for this deployment.',
  interestForm: 'https://openai.com/form/sign-in-with-chatgpt-interest/',
};
