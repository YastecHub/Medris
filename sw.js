const CACHE = 'levromart-shell-v6';
const RUNTIME = 'levromart-runtime-v6';

const OFFLINE_FALLBACK = '/';

const LEVROMART_BADGE =
  '/levromart-badge.svg';

const LEVROMART_ICON =
  '/icon-512.png';


self.addEventListener(
  'install',
  event => {

    event.waitUntil(
      (async () => {

        const cache =
          await caches.open(CACHE);

        try {

          await cache.addAll([
            OFFLINE_FALLBACK,
            '/manifest.json',
            LEVROMART_ICON,
            LEVROMART_BADGE
          ]);

        } catch (e) {}

        self.skipWaiting();

      })()
    );

  }
);


self.addEventListener(
  'activate',
  event => {

    event.waitUntil(
      (async () => {

        const keys =
          await caches.keys();

        await Promise.all(

          keys
            .filter(
              k =>
                ![
                  CACHE,
                  RUNTIME
                ].includes(k)
            )
            .map(
              k =>
                caches.delete(k)
            )
        );

        await self.clients.claim();

      })()
    );

  }
);


function isImageRequest(request) {

  return (
    request.destination === 'image' ||
    /\.(?:png|jpe?g|webp|gif|svg|ico)(?:\?|$)/i.test(
      new URL(request.url).pathname
    )
  );

}


self.addEventListener(
  'fetch',
  event => {

    const request =
      event.request;

    if (
      request.method !==
      'GET'
    ) {
      return;
    }


    const url =
      new URL(request.url);


    if (
      request.mode ===
      'navigate'
    ) {

      event.respondWith(

        (async () => {

          try {

            const fresh =
              await fetch(request);

            const cache =
              await caches.open(
                CACHE
              );

            cache
              .put(
                request,
                fresh.clone()
              )
              .catch(
                () => {}
              );

            return fresh;

          } catch (e) {

            return (
              (await caches.match(
                request
              )) ||

              (await caches.match(
                OFFLINE_FALLBACK
              )) ||

              new Response(
                'Levromart is offline.',
                {
                  status: 503,
                  headers: {
                    'Content-Type':
                      'text/plain'
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

      isImageRequest(
        request
      ) ||

      url.origin ===
        location.origin ||

      url.hostname.includes(
        'cdnjs.cloudflare.com'
      ) ||

      url.hostname.includes(
        'fonts.googleapis.com'
      ) ||

      url.hostname.includes(
        'fonts.gstatic.com'
      ) ||

      url.hostname.includes(
        'unpkg.com'
      )

    ) {

      event.respondWith(

        (async () => {

          const cache =
            await caches.open(
              RUNTIME
            );

          const cached =
            await cache.match(
              request
            );

          const network =
            fetch(request)

              .then(
                response => {

                  if (
                    response &&
                    (
                      response.ok ||
                      response.type ===
                        'opaque'
                    )
                  ) {

                    cache
                      .put(
                        request,
                        response.clone()
                      )
                      .catch(
                        () => {}
                      );

                  }

                  return response;

                }
              )

              .catch(
                () => null
              );


          return (
            cached ||
            await network ||
            new Response(
              '',
              {
                status: 504
              }
            )
          );

        })()

      );

    }

  }
);


/*
 * WEB PUSH
 *
 * Android status-bar notifications use the "badge" as a monochrome
 * notification icon. The previous full-colour PNG could appear as a
 * plain white square. Use the dedicated transparent Levromart badge.
 */

self.addEventListener(
  'push',
  event => {

    event.waitUntil(

      (async () => {

        let data = {};


        try {

          data =
            event.data
              ? event.data.json()
              : {};

        } catch (_) {

          try {

            data = {
              body:
                event.data
                  ? event.data.text()
                  : ''
            };

          } catch (_) {}

        }


        const title =
          String(
            data.title ||
            'Levromart'
          );


        const body =
          String(
            data.body ||
            'You have a new Levromart update.'
          );


        const url =
          String(
            data.url ||
            '/'
          );


        const icon =
          String(
            data.icon ||
            LEVROMART_ICON
          );


        const badge =
          String(
            data.badge ||
            LEVROMART_BADGE
          );


        return self.registration
          .showNotification(
            title,
            {

              body,

              icon,

              badge,

              data: {
                url
              },

              tag:
                data.tag
                  ? String(data.tag)
                  : 'levromart-notification',

              renotify:
                true,

              vibrate:
                [
                  100,
                  50,
                  100
                ]

            }
          );

      })()

    );

  }
);


self.addEventListener(
  'notificationclick',
  event => {

    event.notification.close();


    const target =
      event.notification
        ?.data
        ?.url ||
      '/';


    event.waitUntil(

      (async () => {

        const clientsList =
          await self.clients.matchAll(
            {
              type: 'window',
              includeUncontrolled:
                true
            }
          );


        for (
          const client
          of clientsList
        ) {

          if (
            'focus' in
            client
          ) {

            try {

              if (
                target &&
                target.startsWith('/')
              ) {

                await client.navigate(
                  new URL(
                    target,
                    self.location.origin
                  ).href
                );

              }

            } catch (_) {}


            return client.focus();

          }

        }


        if (
          self.clients.openWindow
        ) {

          return self.clients.openWindow(
            new URL(
              target,
              self.location.origin
            ).href
          );

        }

      })()

    );

  }
);
