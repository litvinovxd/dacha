// Сервис-воркер: приложение работает без интернета и получает push-уведомления.
// Свои файлы — «сначала сеть, если нет — из памяти телефона»: так обновления приходят сразу,
// а без интернета открывается последняя версия. Прогноз погоды не кэшируется (его хранит само приложение).
const CACHE = 'dacha-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css', 'js/app.js', 'js/weather.js',
  'img/icon-192.png', 'img/icon-512.png',
  ...['calendar', 'crops', 'varieties', 'zones', 'plan', 'cards', 'shopping', 'symptoms', 'weather', 'push']
    .map(f => `data/${f}.json`),
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;  // погода и чужие сайты — напрямую
  e.respondWith(fetch(e.request)
    .then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});

self.addEventListener('push', e => {
  let msg = { title: 'Дачный помощник', body: 'Посмотрите прогноз погоды' };
  try { msg = e.data.json(); } catch (err) { /* текст по умолчанию */ }
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, icon: 'img/icon-192.png', badge: 'img/icon-192.png', lang: 'ru',
  }));
});

// Нажатие на уведомление открывает приложение на главной
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) if ('focus' in c) { c.navigate('./#/'); return c.focus(); }
    return self.clients.openWindow('./#/');
  }));
});
