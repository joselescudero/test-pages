// Service Worker for offline support
const CACHE_NAME = 'test-pages-cache-v1';
const CACHE_NAME = 'test-pages-cache-v2';
const BASE_PATH = '/test-pages';
const FILES_TO_CACHE = [
  BASE_PATH + '/',
  BASE_PATH + '/index.html',
  BASE_PATH + '/manifest.json',
  BASE_PATH + '/css/style.css',
  BASE_PATH + '/js/main.js',
  BASE_PATH + '/js/pgn-parser.js',
  BASE_PATH + '/js/captured-pieces.js',
  BASE_PATH + '/img/icon-192.png',
  BASE_PATH + '/img/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
      return cache.addAll(FILES_TO_CACHE).catch(err => {
        console.error('Falló el caché de archivos. Verifica que todos los archivos existan:', err);
        throw err;
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
