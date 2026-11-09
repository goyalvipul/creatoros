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

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' ? data.title.slice(0, 120) : 'Kemokem';
  const body = typeof data.body === 'string' ? data.body.slice(0, 180) : '';
  const url =
    typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/notifications';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: '/brand/kemokem-pwa-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = event.notification.data && event.notification.data.url;
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) url = '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.focus) {
          client.focus();
          if (client.navigate) return client.navigate(url);
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
