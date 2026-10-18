/**
 * "What do I reply to?" triage for social messages. Deterministic keyword rules over the other person's latest
 * message. A suggestion to help ordering, never a decision: nothing is sent or hidden because of it.
 */
export const REPLY_CATEGORIES = [
  'BUSINESS',
  'QUESTION',
  'REQUEST',
  'CRITICISM',
  'COMPLIMENT',
  'EMOJI',
  'MEDIA',
  'SPAM',
  'OTHER',
] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

export const REPLY_CATEGORY_INFO: Record<
  ReplyCategory,
  { label: string; hint: string; group: 'first' | 'quick' | 'low' }
> = {
  BUSINESS: {
    label: 'Business / collab',
    hint: 'Brand, sponsorship, paid work, rates or contact details. Reply first.',
    group: 'first',
  },
  QUESTION: { label: 'Questions', hint: 'They asked something. Worth a real answer.', group: 'first' },
  REQUEST: { label: 'Requests', hint: 'They want a song, video or shout-out.', group: 'first' },
  CRITICISM: { label: 'Criticism', hint: 'Negative or doubting. Reply carefully or ignore.', group: 'first' },
  COMPLIMENT: {
    label: 'Compliments',
    hint: 'Praise. A quick thank-you or a like is enough.',
    group: 'quick',
  },
  EMOJI: { label: 'Emoji / short', hint: 'Only emoji or a few words. A like or emoji back.', group: 'quick' },
  MEDIA: {
    label: 'Photo / no text',
    hint: 'Photo, video, sticker or removed message with no text.',
    group: 'quick',
  },
  SPAM: { label: 'Likely spam', hint: 'Links, promotion or follow-for-follow. Safe to skip.', group: 'low' },
  OTHER: { label: 'Other', hint: 'Does not match anything above.', group: 'quick' },
};

const SPAM =
  /(https?:\/\/|www\.|\.com\b|\bpromot(e|ion)\b|follow\s*(me\s*)?back|f4f|sub4sub|check (out )?my|dm me|whatsapp|telegram|crypto|forex|bitcoin|invest(ment)?\b|earn \$|giveaway|free followers|click (the )?link)/i;
const BUSINESS =
  /(collab(oration|orate)?|sponsor(ed|ship)?|partnership|paid (promo|post|collab|campaign)|brand|campaign|ambassador|\brates?\b|rate card|media kit|business (inquiry|enquiry|email|proposal)|work together|my (agency|company|client)|promotion for|advertis(e|ing)|e-?mail me|\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b)/i;
const REQUEST =
  /(\b(please|pls|plz)\b.*\b(make|sing|do|upload|post|release|reply|share|send|give)\b|\b(make|sing|do|upload|release|post) (a |an |the |one )?(new |next |full )?(song|video|reel|cover|part|version|shorts?)\b|song request|next (song|video|part)|full (song|video|version)|part \d|shout ?out|\bwhen (is|will|are)\b.*\b(next|new|release|coming|upload|out)\b|\bkab\b.*\b(aayega|aayegi|upload|release)\b)/i;
const QUESTION_WORDS =
  /^\s*(who|what|why|when|where|which|how|can|could|will|would|do|does|did|is|are|am|kya|kaise|kab|kahan|kyun|kyu|kaun|kitna|kitne)\b/i;
const CRITICISM =
  /(\bfake\b|scam|\bhate\b|worst|\bugly\b|cringe|boring|stupid|waste|\bbad\b|not real|ai (generated|made)|\bgarbage\b|trash|disgusting|shame on|unsubscribe|dislike|bakwas|faltu|ghatiya)/i;
const COMPLIMENT =
  /(love|loved|loving|beautiful|beauty|gorgeous|pretty|amazing|awesome|great|good|nice|super|superb|wow|fire|best|perfect|stunning|lovely|cute|talent|voice|queen|proud|mast|badhiya|zabardast|jabardast|shandar|sundar|pyaar|kamaal|\bgod bless\b|congrat)/i;

const hasLetters = (s: string) => /[\p{L}\p{N}]/u.test(s);

export function triageReply(textRaw: string | null | undefined): ReplyCategory {
  const text = (textRaw ?? '').trim();
  if (!text) return 'MEDIA';
  if (!hasLetters(text)) return 'EMOJI';
  if (
    BUSINESS.test(text) &&
    !(/https?:\/\//i.test(text) && !/collab|sponsor|brand|partnership|paid/i.test(text))
  )
    return 'BUSINESS';
  if (SPAM.test(text)) return 'SPAM';
  if (REQUEST.test(text)) return 'REQUEST';
  if (text.includes('?') || QUESTION_WORDS.test(text)) return 'QUESTION';
  if (CRITICISM.test(text)) return 'CRITICISM';
  if (COMPLIMENT.test(text)) return 'COMPLIMENT';
  if (text.replace(/[^\p{L}\p{N}]/gu, '').length <= 4) return 'EMOJI';
  return 'OTHER';
}
