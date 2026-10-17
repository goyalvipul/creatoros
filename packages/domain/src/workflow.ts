import { z } from 'zod';

/**
 * Workflow definitions are DATA, never code: a validated, versioned list of steps drawn from a fixed registry.
 * There is no expression evaluator, no script node and no way for message text to change a workflow.
 * Steps run in order. A failed condition stops the run (outcome SKIPPED); actions never run after a stop.
 */

export const WORKFLOW_MODE = ['DRAFT_ONLY', 'APPROVAL', 'AUTOMATIC'] as const;
export type WorkflowMode = (typeof WORKFLOW_MODE)[number];
export const WORKFLOW_STATUS = ['DRAFT', 'ACTIVE', 'PAUSED'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUS)[number];
export const EXECUTION_STATUS = [
  'QUEUED',
  'RUNNING',
  'AWAITING_APPROVAL',
  'WAITING',
  'COMPLETED',
  'SKIPPED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUS)[number];

export const TRIGGER_EVENTS = ['MESSAGE_RECEIVED', 'COMMENT_RECEIVED'] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const MAX_STEPS = 20;
export const MAX_REGEX_LENGTH = 100;
export const MAX_TEXT_FOR_MATCH = 2000;

/** The only variables a template may use. Tokens, secrets and system details are deliberately absent. */
export const TEMPLATE_VARIABLES = [
  'sender.display_name',
  'account.username',
  'platform.name',
  'message.text',
  'conversation.id',
  'received_at',
] as const;

const keywords = z.array(z.string().trim().min(1).max(100)).min(1).max(50);

export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('keyword_any'), keywords, exact: z.boolean().optional() }),
  z.object({ type: z.literal('keyword_none'), keywords }),
  z.object({ type: z.literal('regex'), pattern: z.string().min(1).max(MAX_REGEX_LENGTH) }),
  z.object({ type: z.literal('has_media'), value: z.boolean() }),
  z.object({ type: z.literal('is_new_conversation'), value: z.boolean() }),
  z.object({
    type: z.literal('within_hours'),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(24),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(), // 0 = Sunday
    inside: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('sender_in'),
    senderIds: z.array(z.string().min(1).max(100)).min(1).max(200),
    allow: z.boolean(), // true = allowlist, false = blocklist
  }),
  z.object({
    type: z.literal('category_is'),
    categories: z.array(z.string().min(1).max(40)).min(1).max(10),
    minConfidence: z.number().min(0).max(1).optional(),
  }),
]);
export type Condition = z.infer<typeof conditionSchema>;

const template = z.string().trim().min(1).max(1000);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('draft_reply'), template }),
  z.object({ type: z.literal('queue_approval'), template, reason: z.string().max(200).optional() }),
  z.object({ type: z.literal('send_reply'), template }),
  z.object({
    type: z.literal('create_task'),
    title: z.string().trim().min(1).max(200),
    dueInHours: z.number().int().min(1).max(720).optional(),
  }),
  z.object({ type: z.literal('notify'), title: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('create_lead') }),
  z.object({ type: z.literal('mark_human_review'), reason: z.string().max(200).optional() }),
  z.object({ type: z.literal('add_label'), label: z.string().trim().min(1).max(40) }),
  z.object({ type: z.literal('set_priority'), priority: z.enum(['LOW', 'NORMAL', 'HIGH']) }),
  z.object({ type: z.literal('stop') }),
]);
export type Action = z.infer<typeof actionSchema>;

export const stepSchema = z.union([
  z.object({ kind: z.literal('condition'), id: z.string().min(1).max(40), condition: conditionSchema }),
  z.object({ kind: z.literal('action'), id: z.string().min(1).max(40), action: actionSchema }),
]);
export type Step = z.infer<typeof stepSchema>;

export const definitionSchema = z.object({
  schemaVersion: z.literal(1),
  trigger: z.object({ event: z.enum(TRIGGER_EVENTS) }),
  steps: z.array(stepSchema).min(1).max(MAX_STEPS),
});
export type WorkflowDefinition = z.infer<typeof definitionSchema>;

/** Conservative guard against catastrophic backtracking: no nested quantifiers, no backreferences, bounded size. */
export function isSafeRegex(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_REGEX_LENGTH) return false;
  if (/\\[1-9]/.test(pattern)) return false;
  if (/\([^)]*[+*{][^)]*\)\s*[+*{]/.test(pattern)) return false; // (a+)+  (a*)*  (a{2,})+
  if (/\(\?[<=!]/.test(pattern)) return false; // lookaround
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

export interface Issue {
  stepId?: string;
  message: string;
}

/** Structural validation beyond the schema: unique ids, regex safety, template variables, message-producing rules. */
export function validateDefinition(
  input: unknown,
  mode: WorkflowMode,
): { ok: true; def: WorkflowDefinition } | { ok: false; issues: Issue[] } {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ message: `${i.path.join('.')}: ${i.message}` })),
    };
  const def = parsed.data;
  const issues: Issue[] = [];
  const ids = new Set<string>();
  let producesMessage = false;
  let stopped = false;
  for (const s of def.steps) {
    if (ids.has(s.id)) issues.push({ stepId: s.id, message: `Duplicate step id "${s.id}"` });
    ids.add(s.id);
    if (stopped) issues.push({ stepId: s.id, message: 'Step comes after a Stop step and can never run' });
    if (s.kind === 'condition' && s.condition.type === 'regex' && !isSafeRegex(s.condition.pattern))
      issues.push({
        stepId: s.id,
        message:
          'Regular expression is invalid or too complex (nested quantifiers, lookaround and backreferences are not allowed)',
      });
    if (s.kind === 'action') {
      const a = s.action;
      if (a.type === 'stop') stopped = true;
      if ('template' in a) {
        const bad = templateVariables(a.template).filter(
          (v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v),
        );
        if (bad.length)
          issues.push({ stepId: s.id, message: `Unknown template variable(s): ${bad.join(', ')}` });
      }
      if (a.type === 'draft_reply' || a.type === 'queue_approval' || a.type === 'send_reply')
        producesMessage = true;
      if (a.type === 'send_reply' && mode !== 'AUTOMATIC')
        issues.push({
          stepId: s.id,
          message:
            'Send reply is only allowed in Fully Automatic mode; use Queue for approval or Draft instead',
        });
    }
  }
  if (!producesMessage && mode === 'AUTOMATIC')
    issues.push({ message: 'Fully Automatic mode needs a reply step; otherwise use Draft Only' });
  if (!def.steps.some((s) => s.kind === 'action')) issues.push({ message: 'Add at least one action' });
  return issues.length ? { ok: false, issues } : { ok: true, def };
}

export function templateVariables(t: string): string[] {
  return [...t.matchAll(/\{\{\s*([a-z_.]+)\s*\}\}/g)].map((m) => m[1]!);
}

export interface TemplateContext {
  senderDisplayName?: string | null;
  accountUsername?: string | null;
  platformName: string;
  messageText?: string | null;
  conversationId: string;
  receivedAt: Date;
}

/** Renders only whitelisted variables. Missing values fall back to neutral wording; names are never guessed from usernames. */
export function renderTemplate(t: string, c: TemplateContext): string {
  // eslint-disable-next-line no-control-regex
  const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 500);
  const values: Record<string, string> = {
    'sender.display_name': c.senderDisplayName?.trim() ? clean(c.senderDisplayName.trim()) : 'there',
    'account.username': c.accountUsername ? `@${clean(c.accountUsername)}` : '',
    'platform.name': c.platformName,
    'message.text': clean(c.messageText ?? ''),
    'conversation.id': c.conversationId,
    received_at: c.receivedAt.toISOString(),
  };
  return t.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_m, v: string) => values[v] ?? '').trim();
}

export interface EventForMatch {
  event: TriggerEvent;
  text: string;
  senderId: string;
  hasMedia: boolean;
  isNewConversation: boolean;
  receivedAt: Date;
  timezone: string;
  category?: string | null;
  confidence?: number | null;
}

const norm = (s: string) => s.toLocaleLowerCase();

function localParts(d: Date, tz: string): { hour: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  return { hour, day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd) };
}

/** Deterministic condition evaluation. Returns the verdict plus a human-readable reason for the execution trace. */
export function evaluateCondition(c: Condition, e: EventForMatch): { pass: boolean; reason: string } {
  const text = e.text.slice(0, MAX_TEXT_FOR_MATCH);
  switch (c.type) {
    case 'keyword_any': {
      const t = norm(text);
      const hit = c.keywords.find((k) =>
        c.exact
          ? new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(norm(k))}($|[^\\p{L}\\p{N}])`, 'u').test(t)
          : t.includes(norm(k)),
      );
      return { pass: Boolean(hit), reason: hit ? `matched "${hit}"` : 'no keyword matched' };
    }
    case 'keyword_none': {
      const t = norm(text);
      const hit = c.keywords.find((k) => t.includes(norm(k)));
      return { pass: !hit, reason: hit ? `contains excluded "${hit}"` : 'no excluded keyword present' };
    }
    case 'regex': {
      if (!isSafeRegex(c.pattern)) return { pass: false, reason: 'unsafe pattern refused' };
      return { pass: new RegExp(c.pattern, 'i').test(text), reason: `pattern /${c.pattern}/i` };
    }
    case 'has_media':
      return { pass: e.hasMedia === c.value, reason: `has media = ${e.hasMedia}` };
    case 'is_new_conversation':
      return { pass: e.isNewConversation === c.value, reason: `new conversation = ${e.isNewConversation}` };
    case 'within_hours': {
      const p = localParts(e.receivedAt, e.timezone);
      const hourOk =
        c.startHour <= c.endHour
          ? p.hour >= c.startHour && p.hour < c.endHour
          : p.hour >= c.startHour || p.hour < c.endHour;
      const dayOk = !c.days?.length || c.days.includes(p.day);
      const inside = hourOk && dayOk;
      return {
        pass: inside === c.inside,
        reason: `local ${p.hour}:00 day ${p.day} in ${e.timezone}, inside window = ${inside}`,
      };
    }
    case 'sender_in': {
      const listed = c.senderIds.includes(e.senderId);
      return {
        pass: c.allow ? listed : !listed,
        reason: listed ? 'sender is on the list' : 'sender is not on the list',
      };
    }
    case 'category_is': {
      if (!e.category) return { pass: false, reason: 'message is not classified' };
      const ok =
        c.categories.includes(e.category) &&
        (c.minConfidence === undefined || (e.confidence ?? 0) >= c.minConfidence);
      return { pass: ok, reason: `category ${e.category} (${(e.confidence ?? 0).toFixed(2)})` };
    }
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SENSITIVE: [RegExp, string][] = [
  [
    /\b(price|pricing|rate card|rates?|fee|quote|budget|how much|invoice|payment|paid|pay you|usd|cad|\$\d)/i,
    'money or pricing',
  ],
  [/\b(contract|agreement|exclusiv|licen[cs]e|usage rights|terms|nda)\b/i, 'contract terms'],
  [/\b(lawyer|legal|lawsuit|sue|copyright|dmca|trademark)\b/i, 'legal'],
  [/\b(refund|chargeback|scam|fraud|dispute)\b/i, 'refund or dispute'],
  [/\b(kill|threat|harass|stalk|hate you|die\b|suicid)/i, 'threat or harassment'],
  [/\b(password|login|hacked|account (?:access|security)|verification code|2fa)\b/i, 'account security'],
];

/** Topics that must never get an automatic answer. Matching is intentionally broad: a false positive only means a human looks. */
export function sensitiveTopics(text: string): string[] {
  const t = text.slice(0, MAX_TEXT_FOR_MATCH);
  return SENSITIVE.filter(([re]) => re.test(t)).map(([, why]) => why);
}

const OPT_OUT = /^\s*(stop|unsubscribe|opt[ -]?out|cancel|do not (?:message|contact) me)\W*$/i;
export function isOptOut(text: string): boolean {
  return OPT_OUT.test(text);
}

/** Meta's standard messaging window: a business may answer within 24 hours of the person's last message. UNVERIFIED against live docs. */
export const DM_WINDOW_HOURS = 24;
export function dmWindowOpen(
  lastInboundAt: Date | null | undefined,
  now: Date,
  hours = DM_WINDOW_HOURS,
): boolean {
  return Boolean(lastInboundAt) && now.getTime() - lastInboundAt!.getTime() < hours * 3_600_000;
}
