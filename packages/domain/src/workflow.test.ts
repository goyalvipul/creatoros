import { describe, expect, it } from 'vitest';
import {
  dmWindowOpen,
  evaluateCondition,
  isOptOut,
  isSafeRegex,
  renderTemplate,
  sensitiveTopics,
  validateDefinition,
  type EventForMatch,
} from './workflow';

const ev = (over: Partial<EventForMatch> = {}): EventForMatch => ({
  event: 'MESSAGE_RECEIVED',
  text: 'Hi, interested in a paid partnership',
  senderId: 'u1',
  hasMedia: false,
  isNewConversation: true,
  receivedAt: new Date('2026-07-01T20:00:00Z'),
  timezone: 'America/Vancouver',
  ...over,
});
const def = (steps: unknown[]) => ({ schemaVersion: 1, trigger: { event: 'MESSAGE_RECEIVED' }, steps });
const act = (id: string, action: unknown) => ({ kind: 'action', id, action });
const cond = (id: string, condition: unknown) => ({ kind: 'condition', id, condition });

describe('workflow conditions', () => {
  it('matches keywords case-insensitively and supports exact word matching', () => {
    expect(evaluateCondition({ type: 'keyword_any', keywords: ['PAID PARTNERSHIP'] }, ev()).pass).toBe(true);
    expect(evaluateCondition({ type: 'keyword_any', keywords: ['sponsorship'] }, ev()).pass).toBe(false);
    expect(
      evaluateCondition({ type: 'keyword_any', keywords: ['art'], exact: true }, ev({ text: 'partnership' }))
        .pass,
    ).toBe(false);
    expect(
      evaluateCondition({ type: 'keyword_any', keywords: ['art'], exact: true }, ev({ text: 'I love art!' }))
        .pass,
    ).toBe(true);
    expect(evaluateCondition({ type: 'keyword_none', keywords: ['spam'] }, ev()).pass).toBe(true);
  });
  it('evaluates hours in the account time zone, including DST and overnight windows', () => {
    // 20:00 UTC in July = 13:00 PDT
    expect(
      evaluateCondition({ type: 'within_hours', startHour: 9, endHour: 17, inside: true }, ev()).pass,
    ).toBe(true);
    // 20:00 UTC in January = 12:00 PST
    expect(
      evaluateCondition(
        { type: 'within_hours', startHour: 9, endHour: 17, inside: true },
        ev({ receivedAt: new Date('2026-01-15T20:00:00Z') }),
      ).pass,
    ).toBe(true);
    // 02:00 UTC July = 19:00 PDT the day before: outside business hours
    expect(
      evaluateCondition(
        { type: 'within_hours', startHour: 9, endHour: 17, inside: true },
        ev({ receivedAt: new Date('2026-07-02T02:00:00Z') }),
      ).pass,
    ).toBe(false);
    expect(
      evaluateCondition(
        { type: 'within_hours', startHour: 22, endHour: 6, inside: true },
        ev({ receivedAt: new Date('2026-07-02T08:00:00Z') }),
      ).pass,
    ).toBe(true);
  });
  it('refuses unsafe regular expressions and never executes them', () => {
    expect(isSafeRegex('collab(oration)?')).toBe(true);
    expect(isSafeRegex('(a+)+$')).toBe(false);
    expect(isSafeRegex('(a*)*')).toBe(false);
    expect(isSafeRegex('(.*)\\1')).toBe(false);
    expect(isSafeRegex('(?=x)x')).toBe(false);
    expect(isSafeRegex('x'.repeat(101))).toBe(false);
    expect(isSafeRegex('(')).toBe(false);
    expect(
      evaluateCondition({ type: 'regex', pattern: '(a+)+$' }, ev({ text: 'a'.repeat(5000) + '!' })).pass,
    ).toBe(false);
  });
  it('sender allow/block lists and categories', () => {
    expect(evaluateCondition({ type: 'sender_in', senderIds: ['u1'], allow: false }, ev()).pass).toBe(false);
    expect(evaluateCondition({ type: 'sender_in', senderIds: ['u2'], allow: true }, ev()).pass).toBe(false);
    expect(
      evaluateCondition(
        { type: 'category_is', categories: ['COLLABORATION'], minConfidence: 0.5 },
        ev({ category: 'COLLABORATION', confidence: 0.4 }),
      ).pass,
    ).toBe(false);
    expect(evaluateCondition({ type: 'category_is', categories: ['COLLABORATION'] }, ev()).pass).toBe(false);
  });
});

describe('workflow definition validation', () => {
  it('accepts a valid approval workflow', () => {
    const r = validateDefinition(
      def([
        cond('c1', { type: 'keyword_any', keywords: ['collab'] }),
        act('a1', { type: 'queue_approval', template: 'Hi {{sender.display_name}}' }),
      ]),
      'APPROVAL',
    );
    expect(r.ok).toBe(true);
  });
  it('rejects invalid graphs: unknown nodes, duplicate ids, steps after stop, no actions, bad templates', () => {
    expect(validateDefinition(def([act('a1', { type: 'run_script', code: 'x' })]), 'APPROVAL').ok).toBe(
      false,
    );
    expect(
      validateDefinition(
        def([act('a1', { type: 'notify', title: 'x' }), act('a1', { type: 'notify', title: 'y' })]),
        'APPROVAL',
      ).ok,
    ).toBe(false);
    expect(
      validateDefinition(
        def([act('a1', { type: 'stop' }), act('a2', { type: 'notify', title: 'y' })]),
        'APPROVAL',
      ).ok,
    ).toBe(false);
    expect(validateDefinition(def([cond('c1', { type: 'has_media', value: true })]), 'APPROVAL').ok).toBe(
      false,
    );
    const bad = validateDefinition(
      def([act('a1', { type: 'draft_reply', template: 'token {{oauth.access_token}}' })]),
      'DRAFT_ONLY',
    );
    expect(bad.ok).toBe(false);
    expect(
      validateDefinition(
        def([cond('c1', { type: 'regex', pattern: '(a+)+' }), act('a1', { type: 'notify', title: 'x' })]),
        'APPROVAL',
      ).ok,
    ).toBe(false);
    expect(
      validateDefinition(
        { schemaVersion: 1, trigger: { event: 'MESSAGE_RECEIVED' }, steps: [] },
        'DRAFT_ONLY',
      ).ok,
    ).toBe(false);
  });
  it('allows send_reply only in Fully Automatic mode', () => {
    const steps = def([act('a1', { type: 'send_reply', template: 'Thanks!' })]);
    expect(validateDefinition(steps, 'APPROVAL').ok).toBe(false);
    expect(validateDefinition(steps, 'AUTOMATIC').ok).toBe(true);
    expect(validateDefinition(def([act('a1', { type: 'notify', title: 'x' })]), 'AUTOMATIC').ok).toBe(false);
  });
});

describe('templates, safety classifiers and windows', () => {
  const c = {
    senderDisplayName: null,
    accountUsername: 'mehak',
    platformName: 'Instagram',
    messageText: 'hello',
    conversationId: 'c1',
    receivedAt: new Date('2026-07-01T00:00:00Z'),
  };
  it('renders whitelisted variables with neutral fallbacks and drops unknown ones', () => {
    expect(renderTemplate('Hi {{sender.display_name}}, from {{account.username}}', c)).toBe(
      'Hi there, from @mehak',
    );
    expect(renderTemplate('Hi {{sender.display_name}}', { ...c, senderDisplayName: 'Asha' })).toBe('Hi Asha');
    expect(renderTemplate('x {{access_token}} y', c)).toBe('x  y');
  });
  it('flags money, contract, legal and security topics for a human', () => {
    expect(sensitiveTopics('what is your rate for a reel?')).toContain('money or pricing');
    expect(sensitiveTopics('please sign the contract, exclusivity 6 months')).toContain('contract terms');
    expect(sensitiveTopics('I will sue you')).toContain('legal');
    expect(sensitiveTopics('love your new song!')).toEqual([]);
  });
  it('detects opt-outs and the 24h window', () => {
    expect(isOptOut('STOP')).toBe(true);
    expect(isOptOut('please do not stop singing')).toBe(false);
    const now = new Date('2026-07-02T00:00:00Z');
    expect(dmWindowOpen(new Date('2026-07-01T10:00:00Z'), now)).toBe(true);
    expect(dmWindowOpen(new Date('2026-06-30T23:00:00Z'), now)).toBe(false);
    expect(dmWindowOpen(null, now)).toBe(false);
  });
});

import { WORKFLOW_TEMPLATES } from './workflow-templates';
describe('workflow templates', () => {
  it('every template is a valid definition for its own mode', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const r = validateDefinition(t.definition, t.mode);
      expect(r.ok, t.key + ' ' + JSON.stringify((r as any).issues)).toBe(true);
    }
    expect(new Set(WORKFLOW_TEMPLATES.map((t) => t.key)).size).toBe(WORKFLOW_TEMPLATES.length);
  });
});
