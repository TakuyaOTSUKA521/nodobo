const CACHE_NAME = 'nodobo-shell-v5';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './style.css',
  './state.js',
  './lib/format.js',
  './lib/nodes.js',
  './lib/supabase.js',
  './components/barChart.js',
  './components/collapsibleTree.js',
  './components/confirmDialog.js',
  './components/header.js',
  './components/iconButton.js',
  './components/maskToggle.js',
  './components/periodSegment.js',
  './components/periodSelector.js',
  './components/recordForm.js',
  './components/segmented.js',
  './components/toggleChip.js',
  './components/txRow.js',
  './views/composition.js',
  './views/dashboard.js',
  './views/login.js',
  './views/manager.js',
  './views/nodeDetail.js',
  './views/nodes.js',
  './views/recordSheet.js',
  './views/settings.js',
  './views/transactions.js',
  './packages/core/client.js',
  './packages/core/nodes.js',
  './packages/core/lines.js',
  './packages/core/reports.js',
  './packages/core/crypto.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the same-origin app shell, so an update ships
// immediately whenever there's a connection; only fall back to the cached
// copy when offline. Everything cross-origin (Supabase, Google Fonts,
// esm.sh) goes straight to the network untouched - there's no offline
// story for live data in this app, only for the static shell.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
