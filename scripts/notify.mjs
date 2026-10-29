// Вечернее уведомление о погоде. Запускается GitHub Actions (.github/workflows/weather.yml).
// Берёт прогноз Open-Meteo, считает подсказки теми же правилами, что приложение (js/weather.js),
// и только если есть важное (заморозок, жара, ливень, фитофтора) — шлёт одно push-уведомление.
//
// Переменные окружения (секреты GitHub):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY — ключи отправителя
//   PUSH_SUBSCRIPTIONS — коды подписок из приложения: JSON-объект, массив или по одному на строку
//   MODE=test — отправить проверочное уведомление независимо от погоды
import fs from 'node:fs';
import webpush from 'web-push';
import '../js/weather.js';

const root = new URL('..', import.meta.url);
const cfg = JSON.parse(fs.readFileSync(new URL('data/weather.json', root), 'utf8'));

function subscriptions() {
  const raw = (process.env.PUSH_SUBSCRIPTIONS || '').trim();
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [j];
  } catch {
    return raw.split('\n').map(s => s.trim()).filter(Boolean).map(s => JSON.parse(s));
  }
}

// Дата в Амурской области (UTC+9)
function localToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const subs = subscriptions();
  if (!subs.length) { console.log('Нет подписок (секрет PUSH_SUBSCRIPTIONS пуст) — нечего отправлять.'); return; }
  webpush.setVapidDetails('https://litvinovxd.github.io/dacha/', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  let body;
  if (process.env.MODE === 'test') {
    body = 'Проверка: уведомления о погоде работают 👍';
  } else {
    const r = await fetch(cfg['прогноз_api']);
    const { daily } = await r.json();
    if (!daily || !daily.time) { console.log('Прогноз не получен (ошибка сервиса погоды) — сегодня без уведомления.'); return; }
    const important = Weather.hints(daily, cfg, localToday()).filter(h => h['важно']);
    console.log('Подсказки:', important.map(h => h['текст']));
    if (!important.length) { console.log('Ничего важного — молчим.'); return; }
    body = important.map(h => h['текст']).join('\n');   // одно уведомление в день
  }

  const payload = JSON.stringify({ title: 'Дачный помощник', body });
  let failed = 0;
  for (const [i, s] of subs.entries()) {
    try {
      await webpush.sendNotification(s, payload, { TTL: 12 * 3600 });
      console.log(`Подписка ${i + 1}: отправлено`);
    } catch (e) {
      failed++;
      const gone = e.statusCode === 404 || e.statusCode === 410;
      console.log(`Подписка ${i + 1}: ошибка ${e.statusCode || ''} ${gone
        ? '— подписка устарела. Нужно заново нажать «Включить предупреждения» в приложении и обновить секрет PUSH_SUBSCRIPTIONS.'
        : e.message}`);
    }
  }
  if (failed === subs.length) process.exitCode = 1;   // GitHub пришлёт Роме письмо об ошибке
}

main();
