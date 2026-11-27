import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readBinaryBody, registerBinaryUploadRoutes } from './ai-gateway-binary';

describe('binary upload parser isolation', () => {
  it('starts with an inherited buffer parser and streams only the upload route', async () => {
    const app = Fastify();
    const payload = Buffer.from([0, 1, 2, 255]);
    let received: Buffer | undefined;
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
    app.post('/legacy-binary', async req => ({ buffered: Buffer.isBuffer(req.body) }));
    registerBinaryUploadRoutes(
      app,
      async req => {
        // Exercise parsing without real credentials, a database or a scanner.
        expect(req.body).toBeInstanceOf(Readable);
        received = await readBinaryBody(
          req.body as Readable,
          payload.length,
          createHash('sha256').update(payload).digest('hex'),
        );
        throw Object.assign(new Error('Test authentication rejection'), { statusCode: 401 });
      },
      (_req, data) => data,
    );
    try {
      await app.ready();
      const upload = await app.inject({
        method: 'PUT',
        url: '/ai-gateway/uploads/12345678-1234-4234-8234-123456789abc',
        headers: { 'content-type': 'application/octet-stream' },
        payload,
      });
      expect(upload.statusCode).toBe(401);
      expect(received).toEqual(payload);
      const legacy = await app.inject({
        method: 'POST',
        url: '/legacy-binary',
        headers: { 'content-type': 'application/octet-stream' },
        payload,
      });
      expect(legacy.statusCode).toBe(200);
      expect(legacy.json()).toEqual({ buffered: true });
    } finally {
      await app.close();
    }
  });
});
