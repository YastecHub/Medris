const CACHE = 'levromart-shell-v8';
const RUNTIME = 'levromart-runtime-v8';
const OFFLINE_FALLBACK = '/';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    try {
      await cache.addAll([
        OFFLINE_FALLBACK,
        '/manifest.json',
        '/levromart-notification-icon.png',
        '/levromart-badge.png'
      ]);
    } catch (e) {}

    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(k => ![CACHE, RUNTIME].includes(k))
        .map(k => caches.delete(k))
    );

    await self.clients.claim();
  })());
});

function isImageRequest(request) {
  return (
    request.destination === 'image' ||
    /\.(?:png|jpe?g|webp|gif|svg|ico)(?:\?|$)/i.test(
      new URL(request.url).pathname
    )
  );
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /*
   * Navigation requests:
   * Always try the network first, then fall back to cache/offline page.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);

          const cache = await caches.open(CACHE);

          cache
            .put(request, fresh.clone())
            .catch(() => {});

          return fresh;
        } catch (e) {
          return (
            (await caches.match(request)) ||
            (await caches.match(OFFLINE_FALLBACK)) ||
            new Response(
              'Levromart is offline.',
              {
                status: 503,
                headers: {
                  'Content-Type': 'text/plain'
                }
              }
            )
          );
        }
      })()
    );

    return;
  }

  if (
    isImageRequest(request) ||
    url.origin === location.origin ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('unpkg.com')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);

        const cached = await cache.match(request);

        const network = fetch(request)
          .then(response => {
            if (
              response &&
              (
                response.ok ||
                response.type === 'opaque'
              )
            ) {
              cache
                .put(request, response.clone())
                .catch(() => {});
            }

            return response;
          })
          .catch(() => null);

        return (
          cached ||
          await network ||
          new Response('', {
            status: 504
          })
        );
      })()
    );
  }
});

self.addEventListener('push', event => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch (_) {
        try {
          data = { body: event.data ? event.data.text() : '' };
        } catch (_) {}
      }

      const title = String(data.title || 'Levromart');
      const body = String(data.body || 'You have a new Levromart update.');
      const url = String(data.url || '/');
      const icon = String(data.icon || '/levromart-notification-icon.png');
      const badge = String(data.badge || '/levromart-badge.png');

      return self.registration.showNotification(title, {
        body,
        icon,
        badge,
        data: { url }
      });
    })()
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification?.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
