/** How a saved preference delivers one event. Push always keeps an in-app copy. */
export type DeliveryChoice = 'push' | 'in_app' | 'digest' | 'off';

export type NotificationCategory = 'publishing' | 'workflows' | 'tasks' | 'social' | 'analytics' | 'system';

export const NOTIFICATION_CATEGORIES: { id: NotificationCategory; label: string }[] = [
  { id: 'publishing', label: 'Publishing' },
  { id: 'workflows', label: 'AI and workflows' },
  { id: 'tasks', label: 'Tasks and reminders' },
  { id: 'social', label: 'Social and collaborations' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'system', label: 'System and accounts' },
];

/**
 * Events Kemokem can actually raise from its own data.
 * A module calls `notify()` with one of these types. Unknown types still save, under System.
 * Comments, milestones, and metric changes are not listed here: those platform events are not produced.
 */
export const NOTIFICATION_CATALOG = {
  'publish.soon': { category: 'publishing', priority: 'normal', label: 'Scheduled post coming up' },
  'publish.sent': { category: 'publishing', priority: 'normal', label: 'Post sent' },
  'publish.failed': { category: 'publishing', priority: 'high', label: 'Post failed' },
  'publication.discovered': { category: 'publishing', priority: 'normal', label: 'Posts imported' },
  'comfy.ready': { category: 'workflows', priority: 'normal', label: 'Generation finished' },
  'workflow.failed': { category: 'workflows', priority: 'high', label: 'Generation failed' },
  'workflow.approval': { category: 'workflows', priority: 'high', label: 'Reply needs approval' },
  'workflow.review': { category: 'workflows', priority: 'normal', label: 'Workflow review' },
  'workflow.notice': { category: 'workflows', priority: 'normal', label: 'Workflow notice' },
  'workflow.paused': { category: 'workflows', priority: 'high', label: 'Workflow paused' },
  'task.due': { category: 'tasks', priority: 'normal', label: 'Task due soon' },
  'task.overdue': { category: 'tasks', priority: 'high', label: 'Task overdue' },
  'briefing.daily': { category: 'tasks', priority: 'normal', label: 'Daily summary' },
  'briefing.weekly': { category: 'analytics', priority: 'normal', label: 'Weekly summary' },
  'deal.inquiry.detected': { category: 'social', priority: 'normal', label: 'Collaboration inquiry' },
  'deal.reply_required': { category: 'social', priority: 'high', label: 'Reply needed' },
  'deal.approval_received': { category: 'social', priority: 'normal', label: 'Approval recorded' },
  'invoice.overdue': { category: 'social', priority: 'urgent', label: 'Invoice overdue' },
  'invoice.paid': { category: 'social', priority: 'normal', label: 'Invoice paid' },
  'mail.reply': { category: 'social', priority: 'normal', label: 'Mail reply' },
  'agent.offline': { category: 'system', priority: 'high', label: 'Scanner offline' },
  'agent.connected': { category: 'system', priority: 'normal', label: 'Scanner paired' },
  'media.file.missing': { category: 'system', priority: 'high', label: 'Files missing' },
  'connector.sync.failed': { category: 'system', priority: 'high', label: 'Sync failed' },
  'oauth.expired': { category: 'system', priority: 'urgent', label: 'Account needs reconnect' },
  'backup.restore_test.failed': { category: 'system', priority: 'urgent', label: 'Backup restore failed' },
  'system.test': { category: 'system', priority: 'normal', label: 'Test notification' },
} as const;

export type NotificationEventType = keyof typeof NOTIFICATION_CATALOG;

const CHOICES = new Set<string>(['push', 'in_app', 'digest', 'off']);

/** Used when that event or category has not been saved. Success stays a digest. Messages and health do not. */
const DEFAULT_TYPE: Record<string, DeliveryChoice> = {
  'publish.sent': 'digest',
  'publication.discovered': 'digest',
  'comfy.ready': 'digest',
  'invoice.paid': 'digest',
  'agent.connected': 'digest',
  'deal.inquiry.detected': 'push',
  'deal.reply_required': 'push',
  'mail.reply': 'push',
};

const DEFAULT_CATEGORY: Record<string, DeliveryChoice> = {
  publishing: 'push',
  workflows: 'push',
  tasks: 'push',
  social: 'digest',
  analytics: 'digest',
  system: 'push',
};

export function defaultDelivery(typeOrCategory: string): DeliveryChoice {
  return DEFAULT_TYPE[typeOrCategory] ?? DEFAULT_CATEGORY[typeOrCategory] ?? 'in_app';
}

export function notificationMeta(type: string): { category: NotificationCategory; priority: string; label: string } {
  const known = (NOTIFICATION_CATALOG as Record<string, { category: NotificationCategory; priority: string; label: string }>)[type];
  return known ?? { category: 'system', priority: 'normal', label: type };
}

/** App paths only. A push click must not open another site or another user's record by URL. */
export function safeNotificationPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('://') || value.includes('\\'))
    return '/notifications';
  return value.slice(0, 300);
}

/** Lock-screen text. The stored body can include a draft reply, so it stays in the app. */
export function lockScreenText(type: string): string {
  const lines: Record<string, string> = {
    'publish.soon': 'A scheduled post is coming up.',
    'publish.sent': 'A post was sent.',
    'publish.failed': 'A scheduled post needs attention.',
    'comfy.ready': 'A video or audio file is ready to review.',
    'workflow.failed': 'A generation stopped and needs a look.',
    'workflow.approval': 'A reply is waiting. Open Kemokem to review it.',
    'task.due': 'A task is due soon.',
    'task.overdue': 'A task is overdue.',
    'briefing.daily': 'Your daily summary is ready.',
    'briefing.weekly': 'Your weekly summary is ready.',
    'deal.inquiry.detected': 'A collaboration inquiry is waiting.',
    'deal.reply_required': 'A message needs a reply.',
    'oauth.expired': 'An account needs to be connected again.',
    'connector.sync.failed': 'An account sync failed.',
    'system.test': 'Kemokem can reach this phone.',
  };
  return lines[type] ?? 'Open Kemokem to see this.';
}

export function deliveryChoice(input: {
  type: string;
  inApp?: boolean;
  browserPush?: boolean;
  rules?: Record<string, boolean> | null;
  channels?: Record<string, string> | null;
  accountId?: string | null;
}): DeliveryChoice {
  if (input.rules?.[input.type] === false) return 'off';
  const meta = notificationMeta(input.type);
  const channels = input.channels ?? {};
  const accountKey = input.accountId ? channels[`account:${input.accountId}`] : undefined;
  const raw =
    accountKey ||
    channels[input.type] ||
    DEFAULT_TYPE[input.type] ||
    channels[meta.category] ||
    DEFAULT_CATEGORY[meta.category] ||
    'in_app';
  const choice = CHOICES.has(raw) ? (raw as DeliveryChoice) : 'in_app';
  if (choice === 'off') return 'off';
  if (choice === 'digest') return 'digest';
  if (choice === 'push') return input.browserPush ? 'push' : 'in_app';
  if (input.inApp === false) return 'off';
  return 'in_app';
}
