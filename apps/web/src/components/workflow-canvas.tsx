'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';

export type WfDef = {
  schemaVersion: 1;
  trigger: { event: 'MESSAGE_RECEIVED' | 'COMMENT_RECEIVED' };
  steps: WfStep[];
};

export type WfStep =
  | { kind: 'condition'; id: string; condition: Record<string, unknown> }
  | { kind: 'action'; id: string; action: Record<string, unknown> };

const EMOJI = ['❤️', '🔥', '😍', '🎶', '👏', '💯', '😭', '🙌'];

const MATCH = [
  ['contains', 'Contains these words'],
  ['word', 'Contains these whole words'],
  ['exact', 'The whole message is exactly'],
  ['excludes', 'Does not contain'],
  ['emoji', 'Contains one of these emoji'],
  ['emoji_any', 'Contains any emoji'],
  ['emoji_none', 'Contains no emoji'],
  ['first', 'First message in the chat'],
  ['media', 'Has a photo or video'],
  ['hours', 'Time of day'],
  ['category', 'Classified as'],
  ['regex', 'Matches a pattern'],
  ['sender', 'Sender is on a list'],
] as const;

const ACTIONS = [
  ['draft_reply', 'Save a draft reply'],
  ['queue_approval', 'Queue a reply for me to approve'],
  ['send_reply', 'Send a reply (automatic only)'],
  ['create_task', 'Create a task'],
  ['notify', 'Notify me'],
  ['create_lead', 'Create a lead'],
  ['mark_human_review', 'Mark for me to review'],
  ['add_label', 'Add a label'],
  ['set_priority', 'Set priority'],
  ['stop', 'Stop'],
] as const;

function nid(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

function words(value: unknown): string {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(', ') : '';
}

function splitWords(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function matchKind(condition: Record<string, unknown>): string {
  if (condition.type === 'keyword_any') return condition.exact ? 'word' : 'contains';
  if (condition.type === 'keyword_none') return 'excludes';
  if (condition.type === 'text_equals') return 'exact';
  if (condition.type === 'emoji') {
    if (condition.mode === 'any') return 'emoji_any';
    if (condition.mode === 'none') return 'emoji_none';
    return 'emoji';
  }
  if (condition.type === 'is_new_conversation') return 'first';
  if (condition.type === 'has_media') return 'media';
  if (condition.type === 'within_hours') return 'hours';
  if (condition.type === 'category_is') return 'category';
  if (condition.type === 'regex') return 'regex';
  if (condition.type === 'sender_in') return 'sender';
  return 'contains';
}

function conditionFor(kind: string, prev: Record<string, unknown>): Record<string, unknown> {
  const kept = words(prev.keywords ?? prev.phrases ?? prev.emojis);
  const list = splitWords(kept);
  if (kind === 'contains') return { type: 'keyword_any', keywords: list.length ? list : ['hello'] };
  if (kind === 'word') return { type: 'keyword_any', keywords: list.length ? list : ['hello'], exact: true };
  if (kind === 'exact') return { type: 'text_equals', phrases: list.length ? list : ['SONG'] };
  if (kind === 'excludes') return { type: 'keyword_none', keywords: list.length ? list : ['spam'] };
  if (kind === 'emoji') return { type: 'emoji', mode: 'includes', emojis: ['❤️', '🔥'] };
  if (kind === 'emoji_any') return { type: 'emoji', mode: 'any' };
  if (kind === 'emoji_none') return { type: 'emoji', mode: 'none' };
  if (kind === 'first') return { type: 'is_new_conversation', value: true };
  if (kind === 'media') return { type: 'has_media', value: true };
  if (kind === 'hours') return { type: 'within_hours', startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5], inside: false };
  if (kind === 'category') return { type: 'category_is', categories: ['COLLABORATION'], minConfidence: 0.5 };
  if (kind === 'regex') return { type: 'regex', pattern: 'collab' };
  return { type: 'sender_in', senderIds: ['sender-id'], allow: true };
}

function actionFor(type: string): Record<string, unknown> {
  if (type === 'draft_reply') return { type, template: 'Hi {{sender.display_name}}, ' };
  if (type === 'queue_approval') return { type, template: 'Hi {{sender.display_name}}, ', reason: '' };
  if (type === 'send_reply') return { type, template: 'Hi {{sender.display_name}}, ' };
  if (type === 'create_task') return { type, title: 'Follow up', dueInHours: 24 };
  if (type === 'notify') return { type, title: 'New message' };
  if (type === 'add_label') return { type, label: 'needs-reply' };
  if (type === 'set_priority') return { type, priority: 'HIGH' };
  if (type === 'mark_human_review') return { type, reason: '' };
  if (type === 'stop') return { type: 'stop' };
  return { type: 'create_lead' };
}

export function blankWorkflow(): WfDef {
  return {
    schemaVersion: 1,
    trigger: { event: 'MESSAGE_RECEIVED' },
    steps: [
      { kind: 'condition', id: 'c1', condition: { type: 'keyword_any', keywords: ['hello'] } },
      { kind: 'action', id: 'a1', action: { type: 'draft_reply', template: 'Hi {{sender.display_name}}, ' } },
    ],
  };
}

export function WorkflowCanvas({ def, onChange }: { def: WfDef; onChange: (next: WfDef) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const steps = def.steps;

  function setSteps(next: WfStep[]) {
    onChange({ ...def, steps: next });
  }
  function patch(i: number, step: WfStep) {
    setSteps(steps.map((s, n) => (n === i ? step : s)));
  }
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return;
    const next = [...steps];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    setSteps(next);
    setDrag(null);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Steps run from top to bottom. If a condition does not match, the workflow stops and nothing after it runs. Drag a card, or use Move up and Move down.
      </p>
      <Field label="Starts when">
        <Select
          aria-label="Starts when"
          value={def.trigger.event}
          onChange={(e) => onChange({ ...def, trigger: { event: e.target.value as WfDef['trigger']['event'] } })}
        >
          <option value="MESSAGE_RECEIVED">A direct message arrives</option>
          <option value="COMMENT_RECEIVED">A comment arrives</option>
        </Select>
      </Field>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li
            key={step.id}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drag != null && move(drag, i)}
            className="rounded-lg border border-border bg-panel2 p-3"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="cursor-grab text-xs text-muted" aria-hidden>
                ⠿ {i + 1}. {step.kind === 'condition' ? 'If' : 'Then'}
              </span>
              <Button size="sm" type="button" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                Move up
              </Button>
              <Button
                size="sm"
                type="button"
                aria-label={`Move step ${i + 1} down`}
                disabled={i === steps.length - 1}
                onClick={() => move(i, i + 1)}
              >
                Move down
              </Button>
              <Button
                size="sm"
                type="button"
                variant="danger"
                aria-label={`Remove step ${i + 1}`}
                onClick={() => setSteps(steps.filter((_, n) => n !== i))}
              >
                Remove
              </Button>
            </div>
            {step.kind === 'condition' ? (
              <ConditionFields step={step} onChange={(condition) => patch(i, { ...step, condition })} />
            ) : (
              <ActionFields step={step} onChange={(action) => patch(i, { ...step, action })} />
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() =>
            setSteps([...steps, { kind: 'condition', id: nid('c'), condition: { type: 'keyword_any', keywords: ['hello'] } }])
          }
        >
          Add condition
        </Button>
        <Button
          type="button"
          onClick={() =>
            setSteps([...steps, { kind: 'action', id: nid('a'), action: { type: 'draft_reply', template: 'Hi {{sender.display_name}}, ' } }])
          }
        >
          Add action
        </Button>
      </div>
    </div>
  );
}

function ConditionFields({
  step,
  onChange,
}: {
  step: Extract<WfStep, { kind: 'condition' }>;
  onChange: (condition: Record<string, unknown>) => void;
}) {
  const c = step.condition;
  const kind = matchKind(c);
  return (
    <div className="grid gap-2">
      <Field label="Match">
        <Select aria-label="Match" value={kind} onChange={(e) => onChange(conditionFor(e.target.value, c))}>
          {MATCH.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      {(kind === 'contains' || kind === 'word' || kind === 'excludes') && (
        <WordList
          label="Words"
          aria="Words"
          hint={kind === 'word' ? '“art” matches “I love art”, and does not match “partnership”.' : 'A sentence that contains the words will match. Separate words with commas.'}
          value={Array.isArray(c.keywords) ? (c.keywords as string[]) : []}
          fallback={['hello']}
          onCommit={(keywords) => onChange({ ...c, keywords })}
        />
      )}
      {kind === 'exact' && (
        <WordList
          label="Exact text"
          aria="Exact text"
          hint="The whole message must be this, apart from capital letters and spaces at the ends. “SONG” does not match “love this SONG”."
          value={Array.isArray(c.phrases) ? (c.phrases as string[]) : []}
          fallback={['SONG']}
          onCommit={(phrases) => onChange({ ...c, phrases })}
        />
      )}
      {kind === 'emoji' && (
        <div>
          <p className="mb-1 text-xs text-muted">Tap an emoji to add it. The message matches if it contains one of them.</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="min-h-9 rounded-md border border-border px-2"
                onClick={() => {
                  const current = Array.isArray(c.emojis) ? (c.emojis as string[]) : [];
                  onChange({ ...c, emojis: current.includes(emoji) ? current : [...current, emoji] });
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <WordList
            label="Chosen emoji"
            aria="Emoji"
            value={Array.isArray(c.emojis) ? (c.emojis as string[]) : []}
            fallback={['❤️']}
            onCommit={(emojis) => onChange({ ...c, type: 'emoji', mode: 'includes', emojis })}
          />
        </div>
      )}
      {kind === 'hours' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From hour">
            <Input
              aria-label="From hour"
              type="number"
              min={0}
              max={23}
              value={Number(c.startHour ?? 9)}
              onChange={(e) => onChange({ ...c, startHour: Number(e.target.value) })}
            />
          </Field>
          <Field label="Until hour">
            <Input
              aria-label="Until hour"
              type="number"
              min={0}
              max={24}
              value={Number(c.endHour ?? 17)}
              onChange={(e) => onChange({ ...c, endHour: Number(e.target.value) })}
            />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={c.inside !== false}
              onChange={(e) => onChange({ ...c, inside: e.target.checked })}
            />
            Match inside these hours (clear this for after hours)
          </label>
        </div>
      )}
      {kind === 'category' && (
        <WordList
          label="Category"
          aria="Category"
          hint="COLLABORATION is the built-in screen for business inquiries."
          value={Array.isArray(c.categories) ? (c.categories as string[]) : []}
          fallback={['COLLABORATION']}
          onCommit={(categories) => onChange({ ...c, categories })}
        />
      )}
      {kind === 'regex' && (
        <Field label="Pattern" hint="Short patterns only. Nested repeats are refused.">
          <Input aria-label="Pattern" value={String(c.pattern ?? '')} onChange={(e) => onChange({ ...c, pattern: e.target.value })} />
        </Field>
      )}
      {kind === 'sender' && (
        <div>
          <WordList
            label="Sender ids"
            aria="Sender ids"
            hint="Comma-separated."
            value={Array.isArray(c.senderIds) ? (c.senderIds as string[]) : []}
            fallback={['sender-id']}
            onCommit={(senderIds) => onChange({ ...c, senderIds })}
          />
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.allow !== false} onChange={(e) => onChange({ ...c, allow: e.target.checked })} />
            Only these senders. Clear this to match everyone except them.
          </label>
        </div>
      )}
    </div>
  );
}

function WordList({
  label,
  aria,
  hint,
  value,
  fallback,
  onCommit,
}: {
  label: string;
  aria: string;
  hint?: string;
  value: string[];
  fallback: string[];
  onCommit: (next: string[]) => void;
}) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => setText(value.join(', ')), [value.join('|')]);
  return (
    <Field label={label} hint={hint}>
      <Input
        aria-label={aria}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(splitWords(text).length ? splitWords(text) : fallback)}
      />
    </Field>
  );
}

function ActionFields({
  step,
  onChange,
}: {
  step: Extract<WfStep, { kind: 'action' }>;
  onChange: (action: Record<string, unknown>) => void;
}) {
  const a = step.action;
  const type = String(a.type ?? 'draft_reply');
  return (
    <div className="grid gap-2">
      <Field label="Do this">
        <Select aria-label="Do this" value={type} onChange={(e) => onChange(actionFor(e.target.value))}>
          {ACTIONS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      {(type === 'draft_reply' || type === 'queue_approval' || type === 'send_reply') && (
        <Field label="Reply" hint="You can use {{sender.display_name}} and {{account.username}}.">
          <Textarea aria-label="Reply" rows={3} value={String(a.template ?? '')} onChange={(e) => onChange({ ...a, template: e.target.value })} />
        </Field>
      )}
      {(type === 'create_task' || type === 'notify') && (
        <Field label="Title">
          <Input aria-label="Title" value={String(a.title ?? '')} onChange={(e) => onChange({ ...a, title: e.target.value })} />
        </Field>
      )}
      {type === 'create_task' && (
        <Field label="Due in hours">
          <Input
            aria-label="Due in hours"
            type="number"
            min={1}
            value={Number(a.dueInHours ?? 24)}
            onChange={(e) => onChange({ ...a, dueInHours: Number(e.target.value) })}
          />
        </Field>
      )}
      {type === 'add_label' && (
        <Field label="Label">
          <Input aria-label="Label" value={String(a.label ?? '')} onChange={(e) => onChange({ ...a, label: e.target.value })} />
        </Field>
      )}
      {type === 'set_priority' && (
        <Field label="Priority">
          <Select aria-label="Priority" value={String(a.priority ?? 'NORMAL')} onChange={(e) => onChange({ ...a, priority: e.target.value })}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
          </Select>
        </Field>
      )}
      {(type === 'queue_approval' || type === 'mark_human_review') && (
        <Field label="Why">
          <Input aria-label="Why" value={String(a.reason ?? '')} onChange={(e) => onChange({ ...a, reason: e.target.value })} />
        </Field>
      )}
    </div>
  );
}
