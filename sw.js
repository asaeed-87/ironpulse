/* IronPulse service worker — offline support. Bump VERSION when you upload a new release. */
const VERSION = 'ironpulse-v16';
const CORE = ['./', './index.html', './sync.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  // never touch Firebase API / auth traffic
  if (/googleapis\.com|firebaseapp\.com|identitytoolkit|securetoken|firestore/.test(u.host + u.pathname) && !u.host.startsWith('www.gstatic.com')) return;
  // app files: network first (so updates arrive), fall back to cache offline
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(VERSION).then(ca => ca.put(r, c)); return res }).catch(() => caches.match(r).then(m => m || caches.match('./index.html'))));
    return;
  }
  // Firebase SDK from gstatic: cache first
  if (u.host === 'www.gstatic.com') {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const c = res.clone(); caches.open(VERSION).then(ca => ca.put(r, c)); return res })));
  }
});
