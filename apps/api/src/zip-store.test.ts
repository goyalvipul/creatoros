import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { zipStored } from './zip-store';

describe('zipStored', () => {
  it('stores each file under its own name', async () => {
    const stream = zipStored([
      { name: '01-verse.mp4', open: () => Readable.from([Buffer.from('one')]) },
      { name: '02-chorus.mp4', open: () => Readable.from([Buffer.from('two')]) },
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    expect(body.readUInt32LE(0)).toBe(0x04034b50);
    expect(body.includes(Buffer.from('01-verse.mp4'))).toBe(true);
    expect(body.includes(Buffer.from('02-chorus.mp4'))).toBe(true);
    expect(body.includes(Buffer.from('one'))).toBe(true);
    expect(body.includes(Buffer.from('two'))).toBe(true);
    expect(body.readUInt32LE(body.length - 22)).toBe(0x06054b50);
  });
});
