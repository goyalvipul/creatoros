import { REPLY_CATEGORY_INFO, triageReply, type ReplyCategory } from './triage';
import { validateDefinition, type TriggerEvent, type WorkflowDefinition } from './workflow';

/** One inbound DM or comment already stored by Creator OS. */
export interface TrendMessage {
  text: string;
  kind: string;
  platform: string;
  needsReply?: boolean;
  /** ISO time, used only to show the span of a group. */
  at?: string | null;
}

export interface TrendWorkflow {
  name: string;
  description: string;
  mode: 'APPROVAL';
  definition: WorkflowDefinition;
}

export interface TrendPhrase {
  phrase: string;
  count: number;
}

export interface TrendPlatform {
  platform: string;
  count: number;
}

export interface EngagementTrend {
  id: string;
  title: string;
  summary: string;
  /** Longer read for the message page. */
  detail: string[];
  category: ReplyCategory;
  /** The exact words every message in this group contains. Null for a leftover group. */
  theme: string | null;
  count: number;
  /** Whole percent of the messages that were read. */
  share: number;
  commentCount: number;
  dmCount: number;
  needReply: number;
  answered: number;
  platforms: TrendPlatform[];
  phrases: TrendPhrase[];
  keywords: string[];
  examples: string[];
  firstAt: string | null;
  lastAt: string | null;
  /** Positions in the array passed to analyseEngagement. Not sent on the list. */
  messageIndexes: number[];
  workflow: TrendWorkflow | null;
}

export interface EngagementReport {
  notes: string[];
  trends: EngagementTrend[];
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'my', 'your', 'you', 'me', 'it', 'is',
  'this', 'that', 'with', 'so', 'just', 'im', 'its', 'be', 'are', 'was', 'were', 'have', 'has', 'do',
  'did', 'can', 'hi', 'hello', 'hey', 'from', 'at', 'by', 'as', 'if', 'but', 'not', 'we', 'they',
  'them', 'our', 'us', 'am', 'been', 'too', 'very', 'really', 'please', 'pls', 'plz', 'thanks',
  'thank', 'thanx', 'ok', 'okay', 'bro', 'bhai', 'hii', 'hiii',
]);

const REPLIES: Partial<Record<ReplyCategory, string>> = {
  COMPLIMENT: 'Thank you {{sender.display_name}}! Glad this one landed. (edit this before you turn the workflow on)',
  QUESTION: 'Hi {{sender.display_name}}, thanks for asking. (write the answer here before you turn the workflow on)',
  REQUEST: 'Hi {{sender.display_name}}, thanks for the request. (edit this before you turn the workflow on)',
  EMOJI: 'Thank you {{sender.display_name}} (edit this before you turn the workflow on)',
  OTHER: 'Hi {{sender.display_name}}, thank you for the message. (edit this before you turn the workflow on)',
  BUSINESS:
    'Hi {{sender.display_name}}, thanks for reaching out. Could you share the brief, timeline and budget? (edit this before you turn the workflow on)',
  MEDIA: 'Thank you {{sender.display_name}} (edit this before you turn the workflow on)',
};

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 1);
}

function contentCount(phrase: string): number {
  return phrase.split(' ').filter((w) => !STOP.has(w) && w.length > 2).length;
}

/** Phrases that appear in the message as written, so a workflow keyword can match them. */
function candidatePhrases(text: string): string[] {
  const words = wordsOf(text);
  const found = new Set<string>();
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n);
      const content = slice.filter((w) => !STOP.has(w) && w.length > 2);
      if (content.length < 1) continue;
      if (n >= 3 && content.length < 2) continue;
      const phrase = slice.join(' ');
      if (phrase.length <= 80) found.add(phrase);
    }
  }
  for (const w of words) {
    if (w.length >= 5 && !STOP.has(w)) found.add(w);
  }
  return [...found];
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}

function slug(value: string): string {
  const out = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return out || 'group';
}

function eventFor(commentCount: number, dmCount: number): TriggerEvent {
  return commentCount >= dmCount && commentCount > 0 ? 'COMMENT_RECEIVED' : 'MESSAGE_RECEIVED';
}

function span(rows: TrendMessage[]): { firstAt: string | null; lastAt: string | null } {
  const times = rows.map((r) => r.at).filter((t): t is string => !!t).sort();
  return { firstAt: times[0] ?? null, lastAt: times[times.length - 1] ?? null };
}

interface Built {
  category: ReplyCategory;
  theme: string | null;
  rows: TrendMessage[];
  indexes: number[];
}

function buildTrend(built: Built, total: number, usedIds: Set<string>): EngagementTrend {
  const { category, theme, rows, indexes } = built;
  const label = REPLY_CATEGORY_INFO[category].label;
  const freq = new Map<string, number>();
  for (const row of rows) {
    for (const phrase of candidatePhrases(row.text)) freq.set(phrase, (freq.get(phrase) ?? 0) + 1);
  }
  const phrases = [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || contentCount(b[0]) - contentCount(a[0]) || b[0].length - a[0].length)
    .slice(0, 6)
    .map(([phrase, count]) => ({ phrase, count }));
  const commentCount = rows.filter((r) => r.kind === 'COMMENT').length;
  const dmCount = rows.length - commentCount;
  const needReply = rows.filter((r) => r.needsReply).length;
  const platformMap = new Map<string, number>();
  for (const row of rows) platformMap.set(row.platform, (platformMap.get(row.platform) ?? 0) + 1);
  const platforms = [...platformMap.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);
  const { firstAt, lastAt } = span(rows);
  const share = total > 0 ? Math.round((rows.length / total) * 100) : 0;
  const where =
    commentCount && dmCount
      ? `${commentCount} comments and ${dmCount} DMs`
      : commentCount
        ? `${commentCount} comments`
        : `${dmCount} DMs`;
  const platformText = platforms.map((p) => `${p.platform} ${p.count}`).join(', ');
  const title = theme ? `${label}: “${theme}”` : `${label}: other wording`;
  const base = slug(`${category}-${theme ?? 'other'}`);
  let id = base;
  let n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);
  const reply = REPLIES[category] ?? null;
  const noReply = category === 'SPAM' || category === 'CRITICISM';
  const canReply = !noReply && reply != null && (theme != null || (category === 'EMOJI' && rows.length >= 2));
  const event = eventFor(commentCount, dmCount);
  const watches = event === 'COMMENT_RECEIVED' ? 'comments' : 'DMs';
  const keywords = theme ? [theme] : [];
  let workflow: TrendWorkflow | null = null;
  if (canReply && reply) {
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      trigger: { event },
      steps: [
        {
          kind: 'condition',
          id: 'c1',
          condition:
            theme == null ? { type: 'emoji', mode: 'any' } : { type: 'keyword_any', keywords },
        },
        {
          kind: 'action',
          id: 'a1',
          action: { type: 'queue_approval', template: reply, reason: title.slice(0, 200) },
        },
      ],
    };
    const checked = validateDefinition(definition, 'APPROVAL');
    if (checked.ok) {
      workflow = {
        name: title.slice(0, 120),
        description: `From Trends (${where}). Watches ${watches}${theme ? ` for “${theme}”` : ''}. Stays off until you choose accounts and turn it on. Each reply waits for your approval. Edit the wording first.`,
        mode: 'APPROVAL',
        definition: checked.def,
      };
    }
  }
  const replyLine = needReply
    ? `${needReply} of these still need a reply. ${rows.length - needReply} already have one.`
    : 'None of these are still waiting for a reply.';
  const detail = [
    `${rows.length} messages, ${share}% of everything read in this pass. ${where}.`,
    platformText ? `Accounts: ${platformText}.` : 'No platform was recorded.',
    replyLine,
    theme
      ? `Every message in this group contains “${theme}”.`
      : 'These messages are in the same kind of conversation, but they do not share one phrase.',
    phrases.length
      ? `Repeated wording: ${phrases.map((p) => `“${p.phrase}” (${p.count})`).join(', ')}.`
      : 'No shorter phrase repeats inside this group.',
    noReply
      ? 'No reply workflow is offered. Read them and answer by hand, or leave them.'
      : workflow
        ? `A workflow can watch ${watches} and queue a reply. It stays off, and nothing is sent until you approve each one.`
        : 'There is no single phrase to match, so a keyword workflow is not offered.',
  ];
  const summary = theme
    ? `${where}. ${share}% of this pass. ${needReply} still need a reply. All of them say “${theme}”.`
    : `${where}. ${share}% of this pass. ${needReply} still need a reply. The wording is mixed.`;
  return {
    id,
    title,
    summary,
    detail,
    category,
    theme,
    count: rows.length,
    share,
    commentCount,
    dmCount,
    needReply,
    answered: rows.length - needReply,
    platforms,
    phrases,
    keywords,
    examples: rows.slice(0, 3).map((r) => clip(r.text)),
    firstAt,
    lastAt,
    messageIndexes: indexes,
    workflow,
  };
}

function themesFor(rows: { text: string }[]): string[] {
  const freq = new Map<string, number>();
  for (const row of rows) {
    for (const phrase of candidatePhrases(row.text)) freq.set(phrase, (freq.get(phrase) ?? 0) + 1);
  }
  const min = rows.length >= 8 ? 3 : 2;
  const ranked = [...freq.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || contentCount(b[0]) - contentCount(a[0]) || b[0].length - a[0].length);
  const kept: string[] = [];
  for (const [phrase] of ranked) {
    if (kept.length >= 4) break;
    if (kept.some((k) => k.includes(phrase) || phrase.includes(k))) continue;
    kept.push(phrase);
  }
  return kept;
}

/**
 * Groups stored messages by kind and by a phrase they actually share.
 * A workflow, when one is offered, only queues a reply for approval. It does not send.
 */
export function analyseEngagement(messages: TrendMessage[]): EngagementReport {
  const usable = messages
    .map((m, index) => ({ ...m, text: m.text.trim(), index }))
    .filter((m) => m.text.length > 0);
  const buckets = new Map<ReplyCategory, typeof usable>();
  for (const m of usable) {
    const cat = triageReply(m.text);
    const list = buckets.get(cat) ?? [];
    list.push(m);
    buckets.set(cat, list);
  }
  const built: Built[] = [];
  for (const [category, rows] of buckets) {
    if (rows.length < 2) continue;
    const themes = themesFor(rows);
    const groups = new Map<string, typeof rows>();
    const leftover: typeof rows = [];
    for (const row of rows) {
      const text = row.text.toLowerCase();
      const theme = themes.find((phrase) => text.includes(phrase));
      if (!theme) {
        leftover.push(row);
        continue;
      }
      const list = groups.get(theme) ?? [];
      list.push(row);
      groups.set(theme, list);
    }
    for (const [theme, group] of groups) {
      if (group.length < 2) {
        leftover.push(...group);
        continue;
      }
      built.push({
        category,
        theme,
        rows: group,
        indexes: group.map((r) => r.index),
      });
    }
    if (leftover.length >= 2 && (themes.length === 0 || leftover.length >= 2)) {
      built.push({
        category,
        theme: null,
        rows: leftover,
        indexes: leftover.map((r) => r.index),
      });
    }
  }
  const usedIds = new Set<string>();
  const trends = built
    .map((b) => buildTrend(b, usable.length, usedIds))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const needReply = usable.filter((m) => m.needsReply).length;
  const top = trends[0];
  const notes = [
    `Read ${usable.length} messages.${needReply ? ` ${needReply} still need a reply.` : ''}`,
    top
      ? `Largest group: ${top.title} (${top.count}, ${top.share}%).`
      : 'No group has two messages that belong together yet.',
    trends.filter((t) => t.theme).length
      ? `${trends.filter((t) => t.theme).length} groups share an exact phrase. Open one to read every message before you create a workflow.`
      : 'Nothing repeats as one exact phrase yet.',
  ];
  return { notes, trends };
}
