import { describe, expect, it } from 'vitest';
import { deliveryChoice, lockScreenText, safeNotificationPath } from './notification-events';

describe('notification delivery', () => {
  it('keeps push off until the user turns browser push on', () => {
    expect(deliveryChoice({ type: 'publish.failed', channels: { publishing: 'push' }, browserPush: false })).toBe('in_app');
    expect(deliveryChoice({ type: 'publish.failed', channels: { publishing: 'push' }, browserPush: true })).toBe('push');
  });

  it('lets one event or account override the category', () => {
    expect(deliveryChoice({ type: 'task.due', rules: { 'task.due': false }, channels: { tasks: 'in_app' } })).toBe('off');
    expect(
      deliveryChoice({
        type: 'publish.soon',
        accountId: 'acct',
        channels: { publishing: 'in_app', 'account:acct': 'off' },
      }),
    ).toBe('off');
    expect(deliveryChoice({ type: 'briefing.daily', channels: { tasks: 'digest' } })).toBe('digest');
  });

  it('rejects external links and hides private text from the lock screen', () => {
    expect(safeNotificationPath('https://evil.example')).toBe('/notifications');
    expect(safeNotificationPath('//evil.example')).toBe('/notifications');
    expect(safeNotificationPath('/publishing/abc')).toBe('/publishing/abc');
    expect(lockScreenText('workflow.approval')).not.toMatch(/reply text/i);
    expect(lockScreenText('publish.failed')).toBe('Open Kemokem to see this.');
  });
});
