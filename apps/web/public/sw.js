/* Kemokem service worker.
 * It stays registered so the installed app keeps working, and so a browser
 * that saved the older worker can replace it.
 * It does not answer requests. The older worker saved every page and, when
 * that save failed, Chrome showed "This page couldn't load".
 * Do not add a fetch listener or cache.put. */
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
