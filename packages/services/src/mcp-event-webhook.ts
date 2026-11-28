import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';

const blocked = new BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(ip, bits, 'ipv4');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [ip, bits] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(ip, bits, 'ipv6');

export function publicCallbackAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function callbackUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    isIP(url.hostname) ||
    url.hostname.startsWith('[') ||
    !url.hostname.includes('.') ||
    url.hostname.endsWith('.')
  )
    throw new Error('invalid_callback_url');
  return url;
}

export function webhookKey(secret: string) {
  const encoded = /^whsec_([A-Za-z0-9+/]+={0,2})$/.exec(secret)?.[1];
  const key = Buffer.from(encoded ?? '', 'base64');
  if (key.length < 24 || key.length > 64 || key.toString('base64') !== encoded)
    throw new Error('invalid_signing_secret');
  return key;
}

export function webhookSignature(secret: string, id: string, second: number, body: string) {
  const digest = createHmac('sha256', webhookKey(secret)).update(`${id}.${second}.${body}`).digest('base64');
  return `v1,${digest}`;
}

export async function sendMcpWebhook(
  destination: string,
  subscriptionId: string,
  secret: string,
  id: string,
  payload: object,
) {
  const url = callbackUrl(destination);
  const signal = AbortSignal.timeout(5000);
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    void lookup(url.hostname, { all: true }).then(resolve, reject);
  });
  const target = addresses[0];
  if (!target || addresses.some(({ address }) => !publicCallbackAddress(address)))
    throw new Error('unsafe_callback_address');
  const body = JSON.stringify(payload);
  const second = Math.floor(Date.now() / 1000);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        protocol: 'https:',
        hostname: target.address,
        port: 443,
        servername: url.hostname,
        family: target.family,
        agent: false,
        method: 'POST',
        path: url.pathname + url.search,
        signal,
        checkServerIdentity: (_, certificate) => checkServerIdentity(url.hostname, certificate),
        headers: {
          host: url.hostname,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'webhook-id': id,
          'webhook-timestamp': second,
          'webhook-signature': webhookSignature(secret, id, second, body),
          'x-mcp-subscription-id': subscriptionId,
        },
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('error', reject);
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4096) {
            req.destroy(new Error('callback_response_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

export async function verifyMcpCallback(destination: string, subscriptionId: string, secret: string) {
  const challenge = randomUUID();
  const response = await sendMcpWebhook(destination, subscriptionId, secret, randomUUID(), {
    type: 'verification',
    challenge,
  });
  if (response.status < 200 || response.status >= 300) throw new Error('challenge_failed');
  const answer: unknown = JSON.parse(response.body)?.challenge;
  if (
    typeof answer !== 'string' ||
    Buffer.byteLength(answer) !== Buffer.byteLength(challenge) ||
    !timingSafeEqual(Buffer.from(answer), Buffer.from(challenge))
  )
    throw new Error('challenge_failed');
}
