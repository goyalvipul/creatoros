import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const file = path.join(process.cwd(), 'public/tiktok0UrAw5La8GcDJDrdA5wk8dSnwzey02mT.txt');

describe('TikTok URL prefix file', () => {
  it('matches the file TikTok supplied, with no extra bytes', () => {
    const bytes = readFileSync(file);
    expect(Buffer.compare(bytes, Buffer.from('tiktok-developers-site-verification=0UrAw5La8GcDJDrdA5wk8dSnwzey02mT'))).toBe(0);
  });
});
