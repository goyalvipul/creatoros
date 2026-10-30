import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { installCore, type AppDeps } from './http';
import { coreRoutes } from './routes/core';
import { contentRoutes } from './routes/content';
import { storageRoutes } from './routes/storage';
import { workRoutes } from './routes/work';
import { socialsRoutes } from './routes/socials';
import { comfyRoutes } from './routes/comfy';
import { logSerializers } from './log-redact';

export type { AppDeps } from './http';

/**
 * Builds the Fastify app. Used by `main.ts` and by `inject()` tests, so what is tested is what runs.
 * Every route lives under /api/v1 and answers with { data, meta, error }.
 */
export async function buildApp(
  deps: AppDeps,
  opts: { logStream?: { write(msg: string): void } } = {},
): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : ({
            level: config.logLevel,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-hub-signature-256"]',
              'req.headers["x-wos-signature"]',
            ],
            serializers: logSerializers,
            ...(opts.logStream ? { stream: opts.logStream } : {}),
          } as any),
    // Caddy / Tailscale Serve sit in front; trust their X-Forwarded-* headers for protocol and client IP.
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cookie);
  // API only serves JSON (and the docs UI), so a strict CSP is not applicable to Swagger UI's inline assets.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(rateLimit, { max: config.globalRateLimit, timeWindow: '1 minute', allowList: [] });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Creator OS API',
        version: '1.0.0',
        description:
          'Private creator operating system. All responses use the { data, meta, error } envelope.',
      },
      servers: [{ url: '/api/v1' }],
      components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'cos_session' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  installCore(app, deps);

  await app.register(
    async (v1) => {
      coreRoutes(v1, deps);
      storageRoutes(v1, deps);
      contentRoutes(v1, deps);
      workRoutes(v1, deps);
      socialsRoutes(v1, deps);
      await comfyRoutes(v1, deps);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
