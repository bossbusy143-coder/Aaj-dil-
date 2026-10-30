// service-worker.js - PWA Service Worker for Offline Caching and Installability
const CACHE_NAME = 'pw-cache-v3';

// Fetch handler: Always prioritize fresh network for scripts/modules to prevent stale chunk errors
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(event.request.url);

  // Exclude API requests, dynamic JS/CSS chunks, and CDN proxies from stale caching
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/assets') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.ts')
  ) {
    return; // Let browser fetch directly with standard HTTP caching
  }

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }
      return new Response('Network error', { status: 404, statusText: 'Not Found' });
    })
  );
});

// Install event
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activation event - Purge old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});