const CACHE = 'levromart-shell-v3';
const RUNTIME = 'levromart-runtime-v3';
const OFFLINE_FALLBACK = '/';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    try {
      await cache.addAll([
        OFFLINE_FALLBACK,
        '/manifest.json',
        '/apple-touch-icon.png'
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
   * Navigation requests
   *
   * Online:
   *   Fetch the newest version and update the cache.
   *
   * Offline:
   *   Use the cached page instead of failing.
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

  /*
   * Runtime resources
   *
   * Cache images and application resources as they are used.
   * This allows previously loaded marketplace content to remain
   * available when the user temporarily loses internet access.
   */
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
              (response.ok || response.type === 'opaque')
            ) {
              cache
                .put(request, response.clone())
                .catch(() => {});
            }

            return response;
          })
          .catch(() => null);

        /*
         * Cache-first means already downloaded resources appear
         * immediately. Network is still attempted in the background
         * when there is no cached copy.
         */
        return (
          cached ||
          (await network) ||
          new Response('', { status: 504 })
        );
      })()
    );
  }
});
