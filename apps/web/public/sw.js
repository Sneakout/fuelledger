const CACHE = 'fuelnerve-shell-v1';
const SHELL = ['/', '/index.html'];

async function precacheApplication() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map(path => cache.add(path)));
  try {
    const response = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    const files = new Set();
    for (const entry of Object.values(manifest)) {
      if (entry.file) files.add(`/${entry.file}`);
      for (const list of [entry.css, entry.assets])
        for (const file of list || []) files.add(`/${file}`);
    }
    await Promise.allSettled([...files].map(path => cache.add(path)));
  } catch {
    // Runtime caching still keeps the already-used shell available.
  }
}

self.addEventListener('install', event => {
  event.waitUntil(precacheApplication());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fuelnerve-shell-') && key !== CACHE).map(key => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })),
  );
});

self.addEventListener('message', event => {
  if (event.data === 'PRECACHE_CURRENT_BUILD') event.waitUntil(precacheApplication());
});
