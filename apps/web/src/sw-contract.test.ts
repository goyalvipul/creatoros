import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const sw = readFileSync(resolve(root, 'apps/web/public/sw.js'), 'utf8');
const caddy = readFileSync(resolve(root, 'infra/docker/Caddyfile'), 'utf8');
const providers = readFileSync(resolve(root, 'apps/web/src/app/providers.tsx'), 'utf8');

describe('service worker stays out of page loads', () => {
  it('has push handlers and no fetch or page cache', () => {
    for (const source of [sw, caddy]) {
      expect(source).toContain("addEventListener('push'");
      expect(source).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
      expect(source).not.toContain('cache.put');
    }
    expect(caddy.match(/addEventListener\('push'/g)?.length).toBe(2);
    expect(providers).toContain("/sw.js?v=9");
    expect(sw).toContain("tag: 'kemokem-' + id");
    expect(sw).not.toContain('setAppBadge');
    expect(caddy).not.toContain('setAppBadge');
    expect(sw).not.toContain('caches.open');
  });
});
