const CACHE = 'sentra-v1'

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(['/dashboard.html', '/manifest.json', '/icon-192.png'])
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim())
})

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)))
})
