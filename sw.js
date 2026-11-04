/* IronPulse service worker — offline support. Bump VERSION when you upload a new release. */
const VERSION = 'ironpulse-v20';
const CORE = ['./', './index.html', './sync.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (/googleapis\.com|firebaseapp\.com|identitytoolkit|securetoken|firestore/.test(u.host + u.pathname) && !u.host.startsWith('www.gstatic.com')) return;
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(VERSION).then(ca => ca.put(r, c)); return res }).catch(() => caches.match(r).then(m => m || caches.match('./index.html'))));
    return;
  }
  if (u.host === 'www.gstatic.com') {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const c = res.clone(); caches.open(VERSION).then(ca => ca.put(r, c)); return res })));
  }
});
