import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));

import { sendMcpWebhook, verifyMcpCallback, webhookSignature } from './mcp-event-webhook';

const secret = 'whsec_' + Buffer.alloc(32, 9).toString('base64');
const url = 'https://callback.example.com/events?opaque=callback-token';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
});

function respond(status: number, payload: (posted: string) => string) {
  const end = vi.fn();
  mocks.request.mockImplementation((_options, handler) => {
    const req = new EventEmitter();
    end.mockImplementation((posted: string) => {
      const res = Object.assign(new EventEmitter(), { statusCode: status });
      handler(res);
      res.emit('data', Buffer.from(payload(posted)));
      res.emit('end');
    });
    return Object.assign(req, { end });
  });
  return end;
}

it('connects to a checked address and preserves the TLS hostname and signed bytes', async () => {
  const end = respond(202, () => '');
  await expect(sendMcpWebhook(url, 'sub', secret, 'event-id', { message: 'héllo' })).resolves.toMatchObject({
    status: 202,
  });
  const [options] = mocks.request.mock.calls[0]!;
  expect(options).toMatchObject({
    hostname: '8.8.8.8',
    servername: 'callback.example.com',
    port: 443,
    agent: false,
    path: '/events?opaque=callback-token',
    headers: { host: 'callback.example.com', 'webhook-id': 'event-id', 'x-mcp-subscription-id': 'sub' },
  });
  const [posted] = end.mock.calls[0]!;
  expect(options.headers['webhook-signature']).toBe(
    webhookSignature(secret, 'event-id', options.headers['webhook-timestamp'], posted),
  );
});

it('fails closed if any resolution is private and refuses to follow redirects', async () => {
  mocks.lookup.mockResolvedValueOnce([
    { address: '8.8.8.8', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ]);
  await expect(verifyMcpCallback(url, 'sub', secret)).rejects.toThrow('unsafe_callback_address');
  expect(mocks.request).not.toHaveBeenCalled();
  respond(307, () => '');
  await expect(verifyMcpCallback(url, 'sub', secret)).rejects.toThrow('challenge_failed');
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it('accepts only the exact signed challenge echo', async () => {
  respond(200, (posted) => JSON.stringify({ challenge: JSON.parse(posted).challenge }));
  await expect(verifyMcpCallback(url, 'sub', secret)).resolves.toBeUndefined();
  expect(mocks.request.mock.calls[0]![0].headers['webhook-id']).not.toBe(
    mocks.request.mock.calls[0]![0].headers['x-mcp-subscription-id'],
  );
  respond(200, () => '{"challenge":"wrong"}');
  await expect(verifyMcpCallback(url, 'sub', secret)).rejects.toThrow('challenge_failed');
});
