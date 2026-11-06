import { createHmac, timingSafeEqual } from 'node:crypto';

/** TikTok does not publish a replay window. Five minutes matches the other signed webhooks in this app. */
export const TIKTOK_SIGNATURE_SKEW_SECONDS = 300;

export interface TikTokSignatureParts {
  timestamp: string;
  signature: string;
}

/** `TikTok-Signature: t=<unix>,s=<hex>`. */
export function parseTikTokSignature(header: string | undefined): TikTokSignatureParts | null {
  if (!header) return null;
  let timestamp = '';
  let signature = '';
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 's') signature = value;
  }
  if (!/^\d{1,12}$/.test(timestamp) || !/^[0-9a-fA-F]{64}$/.test(signature)) return null;
  return { timestamp, signature };
}

/**
 * Official check: HMAC-SHA256 of `timestamp + "." + rawBody` using the app client secret.
 * https://developers.tiktok.com/docs/en/webhooks-verification
 */
export function verifyTikTokSignature(
  clientSecret: string,
  rawBody: string,
  header: string | undefined,
  nowMs = Date.now(),
): boolean {
  const parts = parseTikTokSignature(header);
  if (!parts || !clientSecret) return false;
  const ts = Number(parts.timestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(Math.floor(nowMs / 1000) - ts);
  if (skew > TIKTOK_SIGNATURE_SKEW_SECONDS) return false;
  const expected = createHmac('sha256', clientSecret).update(`${parts.timestamp}.${rawBody}`).digest();
  const got = Buffer.from(parts.signature, 'hex');
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}
