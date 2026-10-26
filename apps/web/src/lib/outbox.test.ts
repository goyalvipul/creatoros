import { describe, expect, it } from 'vitest';
import { applyQueue, queueable, rewritePath, type OutboxItem, type QueueRequest } from './outbox';

const req = (over: Partial<QueueRequest> = {}): QueueRequest => ({
  method: 'POST',
  path: '/workflows',
  body: { name: 'Fan link', mode: 'DRAFT_ONLY', connectionIds: [], definition: { steps: [] } },
  now: '2026-10-25T00:00:00.000Z',
  id: 'item-1',
  idempotencyKey: 'key-1',
  localId: 'local-11111111-1111-1111-1111-111111111111',
  ...over,
});

describe('offline queue', () => {
  it('keeps drafts and refuses anything that sends, pays, or renders', () => {
    expect(queueable('POST', '/workflows')).toBe(true);
    expect(queueable('POST', '/workflows/import')).toBe(true);
    expect(queueable('PUT', '/comfy/ltx/draft')).toBe(true);
    expect(queueable('PATCH', '/ideas/abc')).toBe(true);
    expect(queueable('POST', '/comfy/ltx/generate')).toBe(false);
    expect(queueable('POST', '/workflows/abc/activate')).toBe(false);
    expect(queueable('POST', '/files/abc/operations')).toBe(false);
    expect(queueable('POST', '/threads/abc/reply')).toBe(false);
    expect(queueable('POST', '/invoices/abc/payments')).toBe(false);
    expect(queueable('POST', '/variants/abc/publish')).toBe(false);
    expect(queueable('DELETE', '/workflows/abc')).toBe(false);
    expect(queueable('POST', '/workflows/local-11111111-1111-1111-1111-111111111111/activate')).toBe(false);
  });

  it('creates a phone copy and keeps the latest edit for that copy', () => {
    const created = applyQueue([], req(), null);
    expect(created).toHaveLength(1);
    expect(created[0]?.view?.name).toBe('Fan link');
    expect(created[0]?.view?.pendingSync).toBe(true);
    const edited = applyQueue(
      created,
      req({
        method: 'PATCH',
        path: '/workflows/local-11111111-1111-1111-1111-111111111111',
        body: { mode: 'APPROVAL', definition: { steps: [{ id: 'a' }] } },
        id: 'item-2',
        idempotencyKey: 'key-2',
        localId: undefined,
      }),
      null,
    );
    expect(edited).toHaveLength(2);
    expect(edited[0]?.view?.mode).toBe('APPROVAL');
    expect((edited[0]?.view?.definition as { steps: unknown[] }).steps).toHaveLength(1);
    const again = applyQueue(
      edited,
      req({
        method: 'PATCH',
        path: '/workflows/local-11111111-1111-1111-1111-111111111111',
        body: { mode: 'DRAFT_ONLY' },
        id: 'item-3',
        idempotencyKey: 'key-3',
        localId: undefined,
      }),
      null,
    );
    const patches = again.filter((item) => item.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.idempotencyKey).toBe('key-3');
    expect(patches[0]?.body).toEqual({ mode: 'DRAFT_ONLY' });
  });

  it('does not rewrite a request that is already being sent', () => {
    const created = applyQueue([], req(), null);
    const during = applyQueue(
      created,
      req({
        method: 'PATCH',
        path: '/workflows/local-11111111-1111-1111-1111-111111111111',
        body: { mode: 'APPROVAL' },
        id: 'item-2',
        idempotencyKey: 'key-2',
        localId: undefined,
      }),
      'item-2',
    );
    expect(during.filter((item) => item.method === 'PATCH')).toHaveLength(1);
    const second = applyQueue(
      during,
      req({
        method: 'PATCH',
        path: '/workflows/local-11111111-1111-1111-1111-111111111111',
        body: { mode: 'DRAFT_ONLY' },
        id: 'item-3',
        idempotencyKey: 'key-3',
        localId: undefined,
      }),
      'item-2',
    );
    expect(second.filter((item) => item.method === 'PATCH').map((item) => item.id)).toEqual(['item-2', 'item-3']);
  });

  it('rewrites a phone id once the server has a real id', () => {
    const map = { 'local-11111111-1111-1111-1111-111111111111': 'server-1' };
    expect(rewritePath('/workflows/local-11111111-1111-1111-1111-111111111111', map)).toBe('/workflows/server-1');
  });

  it('stops accepting new changes after 50', () => {
    const full: OutboxItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: `id-${i}`,
      method: 'POST',
      path: '/ideas',
      body: { title: String(i) },
      idempotencyKey: `k-${i}`,
      createdAt: '2026-10-25T00:00:00.000Z',
      label: '/ideas',
    }));
    const refused = applyQueue(full, req({ id: 'extra', idempotencyKey: 'extra-key', localId: undefined, path: '/ideas' }), null);
    expect(refused).toHaveLength(50);
    expect(refused.some((item) => item.id === 'extra')).toBe(false);
  });
});
