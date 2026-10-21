import type { APIRoute } from 'astro';
import { base } from '../lib';

// Service worker: after you have visited a page it opens offline, and new deploys replace old caches.
//  - Pages (navigations): network first, so you always get the newest version online; the cached copy (any query string) is the fallback.
//  - Hashed build files (/_astro/): cache first, they never change under the same name.
//  - Everything else on this site: stale while revalidate.
// The cache name carries the build time, so each deploy starts a fresh cache and the old ones are deleted on activate.
const build = Date.now().toString(36); // base 36 keeps the cache name short

export const GET: APIRoute = () => {
  const source = `
const CACHE = 'sda-${build}';
const BASE = ${JSON.stringify(base)};
const CORE = [BASE + '/', BASE + '/offline/', BASE + '/practice/', BASE + '/review/', BASE + '/interview/', BASE + '/progress/', BASE + '/search/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sda-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// The page that registered the worker was loaded before the worker existed, so it sends over what it already fetched.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'cache' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter((u) => typeof u === 'string' && new URL(u, self.location.origin).origin === self.location.origin);
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(urls.map((u) => c.add(u)))));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE + '/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match(BASE + '/offline/'))));
    return;
  }
  if (url.pathname.startsWith(BASE + '/_astro/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => {
    const fresh = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
`;
  return new Response(source, { headers: { 'Content-Type': 'text/javascript' } });
};
