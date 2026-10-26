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
  {
    key: 'streaming-link',
    name: 'Where to listen: draft the link',
    description: 'A DM asks for Spotify, Apple Music or the song link. Saves a draft. Nothing is sent.',
    mode: 'DRAFT_ONLY',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: {
          type: 'keyword_any',
          keywords: ['spotify', 'apple music', 'where can i listen', 'song link', 'youtube music'],
        },
      },
      {
        kind: 'action',
        id: 'a1',
        action: {
          type: 'draft_reply',
          template: 'Hi {{sender.display_name}}, you can listen here: (paste the link).',
        },
      },
    ]),
  },
  {
    key: 'use-this-sound',
    name: 'Duet, stitch or use this sound',
    description: 'Someone wants to use the audio. Creates a task and queues a reply for you to approve.',
    mode: 'APPROVAL',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: {
          type: 'keyword_any',
          keywords: ['duet', 'stitch', 'use this sound', 'can i use your song', 'remix'],
        },
      },
      { kind: 'action', id: 'a1', action: { type: 'create_task', title: 'Decide on a sound-use request', dueInHours: 48 } },
      {
        kind: 'action',
        id: 'a2',
        action: {
          type: 'queue_approval',
          template: 'Hi {{sender.display_name}}, thanks for asking about using the song. (say yes, no, or the terms)',
          reason: 'permission to use the sound',
        },
      },
    ]),
  },
  {
    key: 'show-booking',
    name: 'Show or private event booking',
    description: 'A DM looks like a booking. Creates a lead, a task and a reply for you to approve.',
    mode: 'APPROVAL',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: {
          type: 'keyword_any',
          keywords: ['book you', 'private event', 'wedding', 'live show', 'performance'],
        },
      },
      { kind: 'action', id: 'a1', action: { type: 'create_lead' } },
      { kind: 'action', id: 'a2', action: { type: 'create_task', title: 'Reply to a booking inquiry', dueInHours: 24 } },
      {
        kind: 'action',
        id: 'a3',
        action: {
          type: 'queue_approval',
          template: 'Hi {{sender.display_name}}, thanks for the booking inquiry. What is the date, city and event?',
          reason: 'booking',
        },
      },
    ]),
  },
  {
    key: 'press-interview',
    name: 'Press, podcast or interview',
    description: 'Queues a reply when someone asks for an interview or a podcast. You approve it before it sends.',
    mode: 'APPROVAL',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: { type: 'keyword_any', keywords: ['interview', 'podcast', 'magazine', 'press'] },
      },
      {
        kind: 'action',
        id: 'a1',
        action: {
          type: 'queue_approval',
          template: 'Hi {{sender.display_name}}, thanks for the invitation. What is the show and the date?',
          reason: 'press or podcast',
        },
      },
    ]),
  },
  {
    key: 'merch-shop',
    name: 'Merch and shop link',
    description: 'Someone asks where to buy a shirt or hoodie. Saves a draft with a placeholder shop link.',
    mode: 'DRAFT_ONLY',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: { type: 'keyword_any', keywords: ['merch', 'hoodie', 't-shirt', 'where can i buy'] },
      },
      {
        kind: 'action',
        id: 'a1',
        action: { type: 'draft_reply', template: 'Hi {{sender.display_name}}, the shop is here: (paste the shop link).' },
      },
    ]),
  },
  {
    key: 'song-credits',
    name: 'Song name and credits',
    description: 'A comment asks who is singing or what the song is called. Saves a draft. Nothing is posted.',
    mode: 'DRAFT_ONLY',
    definition: d('COMMENT_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: { type: 'keyword_any', keywords: ['what song is this', 'song name', 'who is singing', 'who produced'] },
      },
      {
        kind: 'action',
        id: 'a1',
        action: { type: 'draft_reply', template: 'This is (song name) by {{account.username}}.' },
      },
    ]),
  },
  {
    key: 'emoji-love-comment',
    name: 'Heart or fire emoji on a comment',
    description: 'The comment contains ❤️, 🔥, 😍 or 🎶. Saves a short thank-you. Nothing is posted.',
    mode: 'DRAFT_ONLY',
    definition: d('COMMENT_RECEIVED', [
      { kind: 'condition', id: 'c1', condition: { type: 'emoji', mode: 'includes', emojis: ['❤️', '🔥', '😍', '🎶'] } },
      {
        kind: 'action',
        id: 'a1',
        action: { type: 'draft_reply', template: 'Thank you {{sender.display_name}} 🎶' },
      },
    ]),
  },
  {
    key: 'exact-campaign-word',
    name: 'Comment is exactly one word',
    description:
      'The whole comment is the word you set (default SONG), not a sentence that merely contains it. Marks it for you and saves a draft. Nothing is posted.',
    mode: 'DRAFT_ONLY',
    definition: d('COMMENT_RECEIVED', [
      { kind: 'condition', id: 'c1', condition: { type: 'text_equals', phrases: ['SONG'] } },
      { kind: 'action', id: 'a1', action: { type: 'mark_human_review', reason: 'exact campaign word' } },
      {
        kind: 'action',
        id: 'a2',
        action: { type: 'draft_reply', template: 'Thank you {{sender.display_name}}! (edit this before you use it)' },
      },
    ]),
  },
  {
    key: 'first-dm-welcome',
    name: 'First DM: welcome draft',
    description: 'The first message in a new chat. Saves a welcome draft. It does not send by itself.',
    mode: 'DRAFT_ONLY',
    definition: d('MESSAGE_RECEIVED', [
      { kind: 'condition', id: 'c1', condition: { type: 'is_new_conversation', value: true } },
      {
        kind: 'action',
        id: 'a1',
        action: {
          type: 'draft_reply',
          template: 'Hi {{sender.display_name}}, thanks for writing to {{account.username}}.',
        },
      },
    ]),
  },
  {
    key: 'shoutout-request',
    name: 'Shoutout or repost request',
    description: 'Someone asks for a shoutout or a story repost. Marks it for you and saves a draft.',
    mode: 'DRAFT_ONLY',
    definition: d('MESSAGE_RECEIVED', [
      {
        kind: 'condition',
        id: 'c1',
        condition: { type: 'keyword_any', keywords: ['shoutout', 'shout out', 'repost', 'share my page'] },
      },
      { kind: 'action', id: 'a1', action: { type: 'mark_human_review', reason: 'shoutout request' } },
      {
        kind: 'action',
        id: 'a2',
        action: { type: 'draft_reply', template: 'Hi {{sender.display_name}}, thanks for asking. (decide yes or no)' },
      },
    ]),
  },
];
