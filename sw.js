/* Minha Agenda: funciona sem internet e serve os anexos guardados no aparelho.
   Ao publicar uma nova versão do index.html, troque o número em SHELL_CACHE (ex.: v2). */
var SHELL_CACHE = 'agenda-shell-v1';
var FONT_CACHE = 'agenda-fonts';
var SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('agenda-shell-') === 0 && k !== SHELL_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function getRecord(id) {
  return new Promise(function (resolve) {
    var r = indexedDB.open('agenda-files', 1);
    r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files', { keyPath: 'id' }); };
    r.onerror = function () { resolve(null); };
    r.onsuccess = function () {
      var db = r.result;
      try {
        var q = db.transaction('files', 'readonly').objectStore('files').get(id);
        q.onsuccess = function () { db.close(); resolve(q.result || null); };
        q.onerror = function () { db.close(); resolve(null); };
      } catch (err) { db.close(); resolve(null); }
    };
  });
}

function serveBlob(req, id) {
  return getRecord(id).then(function (rec) {
    if (!rec) return new Response('Arquivo não encontrado neste aparelho.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    var buf = rec.buf, size = buf.byteLength, type = rec.type || 'application/octet-stream';
    var h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (type === 'image/svg+xml') h['Content-Security-Policy'] = 'sandbox';
    var range = req.headers.get('range');
    var m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      var s, e;
      if (m[1] === '' && m[2] !== '') { s = Math.max(0, size - parseInt(m[2], 10)); e = size - 1; }
      else { s = m[1] === '' ? 0 : parseInt(m[1], 10); e = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
      if (s > e || s >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
      var chunk = buf.slice(s, e + 1);
      h['Content-Range'] = 'bytes ' + s + '-' + e + '/' + size;
      h['Content-Length'] = String(chunk.byteLength);
      return new Response(chunk, { status: 206, headers: h });
    }
    h['Content-Length'] = String(size);
    return new Response(buf, { status: 200, headers: h });
  });
}

function staleWhileRevalidate(req, cacheName, fallbackUrl) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(function () { return null; });
      if (hit) { net.catch(function () {}); return hit; }
      return net.then(function (res) {
        if (res) return res;
        return fallbackUrl ? cache.match(fallbackUrl) : Response.error();
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (url.origin === self.location.origin) {
    var m = /\/_blob\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (m) { e.respondWith(serveBlob(req, m[1])); return; }
  }
  if (req.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL_CACHE, req.mode === 'navigate' ? './index.html' : null));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req, FONT_CACHE, null));
  }
});
