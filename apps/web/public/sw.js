const CACHE_NAME = 'tether-web-assets-v1';
const STATIC_DESTINATIONS = new Set(['font', 'image', 'manifest', 'script', 'style']);
const STATIC_PATH_PREFIX = '/assets/';

function shouldBypassCache(request, url) {
  if (request.method !== 'GET') {
    return true;
  }

  if (url.origin !== self.location.origin) {
    return true;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return true;
  }

  if (
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    request.headers.get('accept')?.includes('text/html')
  ) {
    return true;
  }

  return false;
}

function shouldCache(request, url) {
  return (
    STATIC_DESTINATIONS.has(request.destination) ||
    url.pathname.startsWith(STATIC_PATH_PREFIX) ||
    url.pathname === '/manifest.webmanifest'
  );
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached ?? (await fresh) ?? Response.error();
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassCache(request, url)) {
    return;
  }

  if (shouldCache(request, url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
