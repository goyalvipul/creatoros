import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWorkspaceSignature, workspaceApi, workspaceOrigin } from './workspace-os';

const secret = 'wos_whsec_test';
const raw = '{"type":"ping","id":"ping:1"}';
const ts = '1700000000';

function sign(timestamp = ts, body = raw, key = secret) {
  return `v1=${createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex')}`;
}

describe('Workspace OS webhook signature', () => {
  const now = Number(ts) * 1000;

  it('accepts the timestamp and raw body Workspace OS signs', () => {
    expect(verifyWorkspaceSignature(secret, ts, raw, sign(), now)).toBe(true);
  });

  it('rejects a different body, a stale timestamp, and a short signature', () => {
    expect(verifyWorkspaceSignature(secret, ts, raw + ' ', sign(), now)).toBe(false);
    expect(verifyWorkspaceSignature(secret, ts, raw, sign(), now + 6 * 60_000)).toBe(false);
    expect(verifyWorkspaceSignature(secret, ts, raw, 'v1=abcd', now)).toBe(false);
  });
});

describe('Workspace OS address', () => {
  it('keeps the origin and builds the tasks API under it', () => {
    expect(workspaceOrigin('http://100.108.120.8:4390/ignored')).toBe('http://100.108.120.8:4390');
    expect(workspaceApi('http://100.108.120.8:4390', '/tasks')).toBe(
      'http://100.108.120.8:4390/api/v1/integrations/creatoros/tasks',
    );
  });

  it('rejects credentials in the address and the metadata host', () => {
    expect(() => workspaceOrigin('http://user:pass@100.108.120.8:4390')).toThrow(/username/);
    expect(() => workspaceOrigin('http://169.254.169.254/')).toThrow(/not allowed/);
  });
});
