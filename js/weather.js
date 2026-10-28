// Погодные подсказки. Один и тот же файл работает в приложении (браузер)
// и в скрипте уведомлений (scripts/notify.mjs), чтобы правила не расходились.
'use strict';

(function (root) {
  const WMO = [[0, 'ясно'], [3, 'облачно'], [48, 'туман'], [57, 'морось'], [67, 'дождь'], [77, 'снег'],
    [82, 'ливень'], [86, 'снегопад'], [99, 'гроза']];

  function sky(code) {
    for (const [max, word] of WMO) if (code <= max) return word;
    return '';
  }

  // "MM-DD" попадает в промежуток сезона?
  function inSeason(iso, s) {
    const md = iso.slice(5);
    return md >= s['с'] && md <= s['по'];
  }

  // daily — ответ Open-Meteo (daily), cfg — data/weather.json (с учётом настроек), today — "YYYY-MM-DD".
  // Возвращает подсказки: { вид, день, текст, важно } — «важно» отправляется уведомлением.
  function hints(daily, cfg, today) {
    const P = cfg['пороги'];
    const days = daily.time.map((t, i) => ({
      t, min: daily.temperature_2m_min[i], max: daily.temperature_2m_max[i],
      rain: daily.precipitation_sum[i] ?? 0, code: daily.weather_code[i],
    }));
    const iToday = Math.max(0, days.findIndex(d => d.t === today));
    const ahead = days.slice(iToday);
    const out = [];
    const when = d => d.t === today ? 'Сегодня' : (d === ahead[1] ? 'Завтра' : `${Number(d.t.slice(8))}-го`);
    const deg = v => `${v > 0 ? '+' : ''}${Math.round(v)}°`;

    // Заморозок — только в сезон посадок, ближайшие 3 ночи
    for (const d of ahead.slice(0, 3)) {
      if (inSeason(d.t, cfg['сезон']) && d.min <= P['заморозок_ночью_до']) {
        out.push({ вид: 'заморозок', день: d.t, важно: true,
          текст: `${when(d)} ночью до ${deg(d.min)}: заморозок. Укрой рассаду и закрой теплицу.` });
        break;
      }
    }
    // Жара — сегодня или завтра
    for (const d of ahead.slice(0, 2)) {
      if (inSeason(d.t, cfg['сезон']) && d.max >= P['жара_днём_от']) {
        out.push({ вид: 'жара', день: d.t, важно: true,
          текст: `${when(d)} днём до ${deg(d.max)}: открой дверь и форточку теплицы с утра.` });
        break;
      }
    }
    // Ливень: был вчера/сегодня или будет завтра
    const wet = days.slice(Math.max(0, iToday - 1), iToday + 2).find(d => d.rain >= P['ливень_мм_от']);
    if (wet && inSeason(today, cfg['сезон'])) {
      out.push({ вид: 'ливень', день: wet.t, важно: wet.t > today,
        текст: wet.t > today ? `Завтра сильный дождь (${Math.round(wet.rain)} мм): не поливай.` : `Прошёл сильный дождь (${Math.round(wet.rain)} мм): не поливай.` });
    }
    // Сухо и жарко несколько дней подряд
    let run = 0;
    for (const d of days.slice(0, iToday + 3)) {
      run = d.rain < P['сухо_мм_до'] && d.max >= P['сухо_жарко_днём_от'] ? run + 1 : 0;
    }
    if (run >= P['сухих_жарких_дней_подряд'] && inSeason(today, cfg['сезон']) && !wet) {
      out.push({ вид: 'сухо', день: today, важно: false, текст: 'Несколько дней сухо и жарко: полей вечером тёплой водой.' });
    }
    // Фитофтора: N дней подряд с дождём и прохладными ночами
    run = 0;
    let blight = false;
    for (const d of ahead.slice(0, 5)) {
      run = d.rain >= P['фитофтора_дождь_мм_от'] && d.min <= P['фитофтора_ночь_до'] ? run + 1 : 0;
      if (run >= P['фитофтора_дней_подряд']) blight = true;
    }
    if (blight && inSeason(today, cfg['фитофтора_сезон'])) {
      out.push({ вид: 'фитофтора', день: today, важно: true, текст: 'Несколько дней сырости и прохладных ночей: риск фитофторы. Осмотри томаты, проветривай теплицу.' });
    }
    return out;
  }

  root.Weather = { hints, sky };
})(typeof window !== 'undefined' ? window : globalThis);
