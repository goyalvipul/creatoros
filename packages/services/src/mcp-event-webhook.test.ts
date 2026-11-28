import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import { callbackUrl, publicCallbackAddress, webhookKey, webhookSignature } from './mcp-event-webhook';

test('rejects local, reserved and mapped addresses', () => {
  for (const address of [
    '127.1.2.3',
    '100.64.0.1',
    '169.254.169.254',
    '::ffff:8.8.8.8',
    '2002:7f00::1',
    'fc00::1',
    '2001:db8::1',
  ]) {
    expect(publicCallbackAddress(address)).toBe(false);
  }
  expect(publicCallbackAddress('8.8.8.8')).toBe(true);
  expect(publicCallbackAddress('2606:4700::1111')).toBe(true);
});

test('requires an HTTPS DNS hostname without credentials or fragments', () => {
  for (const url of [
    'http://example.com',
    'https://user@example.com',
    'https://[::1]',
    'https://127.0.0.1',
    'https://example.com:8443',
    'https://example.com/#x',
  ]) {
    expect(() => callbackUrl(url)).toThrow();
  }
  expect(callbackUrl('https://example.com/path').pathname).toBe('/path');
});

test('signs the exact serialized bytes with the decoded signing key', () => {
  const key = Buffer.alloc(32, 42);
  const secret = 'whsec_' + key.toString('base64');
  const body = '{"message":"héllo"}';
  const digest = createHmac('sha256', key)
    .update('id.123.' + body)
    .digest('base64');
  expect(webhookSignature(secret, 'id', 123, body)).toBe('v1,' + digest);
  expect(() => webhookKey('whsec_aW52YWxpZA==')).toThrow();
});
