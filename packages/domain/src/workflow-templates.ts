import type { WorkflowDefinition, WorkflowMode } from './workflow';

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  mode: WorkflowMode;
  definition: WorkflowDefinition;
}

const d = (
  event: 'MESSAGE_RECEIVED' | 'COMMENT_RECEIVED',
  steps: WorkflowDefinition['steps'],
): WorkflowDefinition => ({
  schemaVersion: 1,
  trigger: { event },
  steps,
});

/**
 * Starting points only. Importing one creates an inactive DRAFT workflow with no account selected; nothing runs until
 * you choose accounts, review the text and activate it. Reply wording is a placeholder you must edit.
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'ig-faq-draft',
    name: 'Instagram FAQ: draft a reply',
    description: 'Saves a draft reply when a DM asks a common question. Nothing is sent.',
    mode: 'DRAFT_ONLY',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: { type: 'keyword_any', keywords: ['where can i listen', 'new song', 'when is the next'] },
      },
      {
        kind: 'action',
        id: 'a1',
        action: {
          type: 'draft_reply',
          template: 'Hi {{sender.display_name}}, thank you for asking! (edit this answer before using it)',
        },
      },
    ]),
  },
  {
    key: 'ig-collab-inquiry',
    name: 'Collaboration inquiry: lead + approval',
    description:
      'Creates a lead, labels the conversation, adds a follow-up task and queues a reply for your approval.',
    mode: 'APPROVAL',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: {
          type: 'keyword_any',
          keywords: ['collaboration', 'sponsorship', 'paid partnership', 'brand deal', 'collab'],
        },
      },
      { kind: 'action', id: 'a1', action: { type: 'create_lead' } },
      { kind: 'action', id: 'a2', action: { type: 'add_label', label: 'potential-sponsor' } },
      {
        kind: 'action',
        id: 'a3',
        action: { type: 'create_task', title: 'Follow up on collaboration inquiry', dueInHours: 48 },
      },
      { kind: 'action', id: 'a4', action: { type: 'notify', title: 'New collaboration inquiry' } },
      {
        kind: 'action',
        id: 'a5',
        action: {
          type: 'queue_approval',
          template:
            'Hi {{sender.display_name}}, thanks for reaching out about a collaboration. Could you share the brief, timeline and deliverables?',
          reason: 'collaboration inquiry',
        },
      },
    ]),
  },
  {
    key: 'ig-pricing-approval',
    name: 'Pricing question: always ask me',
    description:
      'Never answers money questions automatically. Marks the conversation for review and queues a draft.',
    mode: 'APPROVAL',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: { type: 'keyword_any', keywords: ['rate', 'price', 'how much', 'budget', 'fee'] },
      },
      { kind: 'action', id: 'a1', action: { type: 'mark_human_review', reason: 'pricing question' } },
      {
        kind: 'action',
        id: 'a2',
        action: {
          type: 'queue_approval',
          template: 'Hi {{sender.display_name}}, thanks for your interest. (add pricing details yourself)',
          reason: 'pricing',
        },
      },
    ]),
  },
  {
    key: 'negative-comment-review',
    name: 'Negative comment: human review',
    description: 'Flags comments with harsh words so you can decide what to do. Never replies.',
    mode: 'DRAFT_ONLY',
    definition: d('COMMENT_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: { type: 'keyword_any', keywords: ['hate', 'terrible', 'awful', 'worst', 'trash'] },
      },
      { kind: 'action', id: 'a1', action: { type: 'mark_human_review', reason: 'negative comment' } },
    ]),
  },
  {
    key: 'collab-followup-task',
    name: 'Collaboration follow-up task',
    description: 'Creates a follow-up task for any DM that looks like a business offer.',
    mode: 'DRAFT_ONLY',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: { type: 'category_is', categories: ['COLLABORATION'], minConfidence: 0.5 },
      },
      {
        kind: 'action',
        id: 'a1',
        action: { type: 'create_task', title: 'Review collaboration message', dueInHours: 24 },
      },
    ]),
  },
  {
    key: 'suspected-spam',
    name: 'Suspected spam: label and review',
    description: 'Labels DMs that look like spam so they do not clutter the inbox. Never replies.',
    mode: 'DRAFT_ONLY',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: {
          type: 'keyword_any',
          keywords: ['crypto', 'giveaway winner', 'click this link', 'earn money fast', 'followers for sale'],
        },
      },
      { kind: 'action', id: 'a1', action: { type: 'add_label', label: 'suspected-spam' } },
      { kind: 'action', id: 'a2', action: { type: 'set_priority', priority: 'LOW' } },
    ]),
  },
  {
    key: 'song-comment-suggestion',
    name: 'Song comment: suggested reply',
    description: 'When a comment mentions a song name you set, saves a suggested reply. Nothing is posted.',
    mode: 'DRAFT_ONLY',
    definition: d('COMMENT_RECEIVED', [
      { kind: 'condition', id: 'c1', condition: { type: 'keyword_any', keywords: ['your-song-title'] } },
      {
        kind: 'action',
        id: 'a1',
        action: { type: 'draft_reply', template: 'Thank you so much, {{sender.display_name}}! 🎶' },
      },
    ]),
  },
  {
    key: 'ig-after-hours-ack',
    name: 'After-hours acknowledgment (automatic)',
    description:
      'Fully Automatic. Sends one short acknowledgment to a new DM outside business hours. Needs a successful test, automatic sending enabled on the account, and never answers pricing, contract or legal topics.',
    mode: 'AUTOMATIC',
    definition: d('MESSAGE_RECEIVED', [
      { kind: 'condition', id: 'c1', condition: { type: 'is_new_conversation', value: true } },
      {
        kind: 'condition',
        id: 'c2',
        condition: { type: 'within_hours', startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5], inside: false },
      },
      {
        kind: 'action',
        id: 'a1',
        action: {
          type: 'send_reply',
          template: 'Thanks for your message! We are away right now and will reply soon.',
        },
      },
      {
        kind: 'action',
        id: 'a2',
        action: { type: 'create_task', title: 'Reply to after-hours message', dueInHours: 12 },
      },
    ]),
  },
];
