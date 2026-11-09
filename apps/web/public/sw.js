/* Kemokem service worker.
 * It stays registered so the installed app keeps working, and so a browser
 * that saved the older worker can replace it.
 * It does not answer requests. The older worker saved every page and, when
 * that save failed, Chrome showed "This page couldn't load".
 * Do not add a fetch listener or write into the cache.
 * Push and notificationclick only display a message and open an app path.
 * The same handlers must stay in infra/docker/Caddyfile, because production
 * serves /sw.js from Caddy rather than this file. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('cos-')).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function safePath(value) {
  return typeof value === 'string' && value.charAt(0) === '/' && value.charAt(1) !== '/' ? value : '/notifications';
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' ? data.title.slice(0, 120) : 'Kemokem';
  const body = typeof data.body === 'string' ? data.body.slice(0, 180) : '';
  const url = safePath(data.url);
  const tag = typeof data.tag === 'string' ? data.tag.slice(0, 80) : 'kemokem';
  const badge = typeof data.badge === 'number' && data.badge >= 0 ? Math.min(99, Math.floor(data.badge)) : null;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        tag,
        data: { url },
        icon: '/brand/kemokem-pwa-192.png',
      }),
      badge === null
        ? Promise.resolve()
        : badge > 0 && navigator.setAppBadge
          ? navigator.setAppBadge(badge).catch(() => {})
          : navigator.clearAppBadge
            ? navigator.clearAppBadge().catch(() => {})
            : Promise.resolve(),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  const absolute = new URL(url, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.indexOf(self.location.origin) === 0 && client.navigate) {
          client.focus();
          return client.navigate(absolute);
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(absolute);
    }),
  );
});
