// Дачный помощник. Все данные берутся из папки data/, здесь только логика и экраны.
'use strict';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_TITLE = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DAY = 86400000;
const LATE_DAYS = 21;   // сколько дней показывать пропущенное дело
const WEEK_MAX = 7;     // не больше дел на главной

const D = {};           // данные из data/
const view = document.getElementById('view');

// ---------- Хранилище отметок (в телефоне) ----------
function load(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch (e) { return def; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* без хранилища просто не запомним */ }
}
let done = load('dacha.done', {});   // "2027:tomat-t-posev" -> "2027-03-07"

// ---------- Даты ----------
// Для проверки можно открыть страницу с ?date=2027-03-08
function today() {
  const q = new URLSearchParams(location.search).get('date');
  const d = q ? new Date(q + 'T00:00:00') : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => new Date(s + 'T00:00:00');
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const daysBetween = (a, b) => Math.round((b - a) / DAY);
function fmt(d) { return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
function fmtRange(a, b) {
  if (daysBetween(a, b) <= 0) return fmt(a);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]}`;
  return `${fmt(a)} – ${fmt(b)}`;
}

// ---------- Расчёт сроков ----------
function anchorDate(name, year) {
  const a = D.calendar['опорные_даты'][name];
  const [m, d] = a['дата'].split('-').map(Number);
  return new Date(year, m - 1, d);
}

// Начало дела в сезоне year: от опорной даты или от дела, после которого оно идёт.
// Если мама отметила предыдущее дело сделанным — считаем от фактической даты.
function startOf(task, year, seen = new Set()) {
  if (task['после']) {
    if (seen.has(task.id)) return anchorDate('teplitsa', year);
    seen.add(task.id);
    const dep = D.tasks[task['после']];
    const depDone = done[`${year}:${dep.id}`];
    const base = depDone && !dep['повтор'] ? parse(depDone) : startOf(dep, year, seen);
    return addDays(base, task['через']);
  }
  return addDays(anchorDate(task['якорь'], year), task['смещение']);
}

// Экземпляр дела в сезоне: даты, статус
function instance(task, year) {
  const start = startOf(task, year);
  const end = addDays(start, task['окно']);
  const key = `${year}:${task.id}`;
  const last = done[key] ? parse(done[key]) : null;
  const t = today();
  let due = start, isDone = !!last;
  if (task['повтор']) {
    // повторяющееся дело: снова пора через N дней после последней отметки
    if (last) due = addDays(last, task['повтор']);
    if (due < start) due = start;
    isDone = due > end || (last && due > t);
  }
  return { task, year, key, start, end, due, last, isDone };
}

function allInstances(years) {
  const out = [];
  for (const y of years) for (const t of D.calendar['дела']) {
    if (!t['с_года'] || y >= t['с_года']) out.push(instance(t, y)); // например, малина появится только в 2027
  }
  return out;
}

// Дела для главной: пропущенные (до 3 недель), текущая неделя; если мало — ближайшие
function weekTasks() {
  const t = today();
  const weekEnd = addDays(t, 7);
  const list = allInstances([t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1])
    .filter(i => !i.isDone && i.end >= addDays(t, -LATE_DAYS));
  const now = list.filter(i => i.due <= weekEnd).sort((a, b) => a.due - b.due).slice(0, WEEK_MAX);
  const soon = list.filter(i => i.due > weekEnd).sort((a, b) => a.due - b.due).slice(0, Math.max(0, 3 - now.length));
  return { now, soon };
}

// ---------- Отрисовка ----------
// Пометки источников вроде «(rg)» нужны Роме в данных, маме на экране — нет
const esc = s => String(s ?? '').replace(/ ?\([a-z_]+\)/g, '')
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function taskRow(i) {
  const t = today();
  const late = !i.isDone && i.end < t;
  const when = late ? `Пора было: ${fmtRange(i.due, i.end)}`
    : i.task['повтор'] ? `${fmt(i.due)}, потом каждые ${i.task['повтор']} дн.`
    : fmtRange(i.due < i.start ? i.start : i.due, i.end);
  return `<div class="task${late ? ' late' : ''}${i.isDone ? ' done' : ''}">
    <span class="lead" aria-hidden="true">${cropIcon(i.task['культура'])}</span>
    <a class="txt" href="#/delo/${i.year}/${i.task.id}"><div>${esc(i.task['что'])}</div><div class="when">${i.isDone && i.last ? 'Сделано ' + fmt(i.last) : when}</div></a>
    <button class="check${i.isDone ? ' on' : ''}" data-done="${i.key}" aria-label="Сделано">${i.isDone ? '✓' : ''}</button></div>`;
}

function cropIcon(id) { return (D.crops[id] && D.crops[id]['значок']) || '🌱'; }

function bindChecks() {
  view.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.done;
    if (done[k] && !D.tasks[k.split(':')[1]]['повтор']) delete done[k];
    else done[k] = iso(today());
    save('dacha.done', done);
    render();
  }));
}

// --- Лунный календарь (по желанию, по умолчанию выключен) ---
// Всегда ниже погоды и дел: сроки по климату и предупреждения важнее.
const MOON_TIP = {
  'растущая': 'хорошо сеять и сажать то, что растёт над землёй: томаты, перцы, огурцы, зелень',
  'убывающая': 'хорошо сажать корнеплоды и клубни: картофель, морковь, свёклу, лук',
};

function moonBlock() {
  const t = today();
  const p = Moon.phase(t.getFullYear(), t.getMonth() + 1, t.getDate());
  const icon = { 'новолуние': '🌑', 'растущая': '🌒', 'полнолуние': '🌕', 'убывающая': '🌘' }[p.name];
  return `<div class="card">${icon} <b>Луна: ${p.name}</b>${MOON_TIP[p.name] ? ` — по народной традиции ${MOON_TIP[p.name]}.` : '.'}
    <p class="note">Народная традиция, наукой не подтверждена. Погода и сроки в календаре важнее.</p></div>`;
}

// --- Погода ---
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
let forecast = load('dacha.forecast', null);   // { got: ISO-время, daily: {...} }

function weatherCfg() {
  const own = load('dacha.weatherCfg', {});  // пороги, поменянные в настройках
  return { ...D.weather, 'пороги': { ...D.weather['пороги'], ...own } };
}

async function loadForecast() {
  const fresh = forecast && Date.now() - new Date(forecast.got).getTime() < 3 * 3600 * 1000;
  if (fresh && !new URLSearchParams(location.search).get('date')) return;
  try {
    const r = await fetch(D.weather['прогноз_api']);
    const j = await r.json();
    forecast = { got: new Date().toISOString(), daily: j.daily };
    save('dacha.forecast', forecast);
    if (!location.hash || location.hash === '#/') render();
  } catch (e) { /* нет интернета — покажем сохранённый прогноз */ }
}

// Предупреждения — наверху главной, таблица прогноза — внизу
function weatherAlerts() {
  if (!forecast) return '';
  return Weather.hints(forecast.daily, weatherCfg(), iso(today())).map(x => {
    const [icon, title] = ALERT_LOOK[x['вид']] || ['⚠️', 'Внимание'];
    return `<div class="alert${x['важно'] ? '' : ' soft'}"><span class="ai">${icon}</span><div><b>${title}</b>${esc(x['текст'])}</div></div>`;
  }).join('');
}

const ALERT_LOOK = { 'заморозок': ['❄️', 'Заморозок'], 'жара': ['🌡️', 'Жара'], 'ливень': ['🌧️', 'Сильный дождь'],
  'сухо': ['☀️', 'Сухо'], 'фитофтора': ['🍂', 'Риск фитофторы'] };

// Значок погоды по коду WMO из прогноза
function skyIcon(code) {
  for (const [max, ic] of [[0, '☀️'], [2, '🌤️'], [3, '☁️'], [48, '🌫️'], [67, '🌧️'], [77, '🌨️'], [82, '🌧️'], [86, '🌨️'], [99, '⛈️']]) {
    if (code <= max) return ic;
  }
  return '☁️';
}

function weatherBlock() {
  if (!forecast) return `<p class="note">Прогноз погоды загружается…</p>`;
  const d = forecast.daily, t = iso(today());
  let h = '';
  const i0 = Math.max(0, d.time.indexOf(t));
  const P = weatherCfg()['пороги'];
  const deg = v => `${v > 0 ? '+' : ''}${Math.round(v)}°`;
  h += `<div class="wx">` + d.time.slice(i0, i0 + 7).map((day, k) => {
    const i = i0 + k, dt = parse(day), min = d.temperature_2m_min[i], max = d.temperature_2m_max[i];
    const warn = (min <= P['заморозок_ночью_до'] && max > 0) || max >= P['жара_днём_от'];
    const rain = d.precipitation_sum[i] >= 1 ? `<div class="r">${Math.round(d.precipitation_sum[i])} мм</div>` : '';
    return `<div class="day${warn ? ' warn' : ''}"><div class="d">${k === 0 ? 'Сегодня' : k === 1 ? 'Завтра' : WEEKDAYS[dt.getDay()] + ' ' + dt.getDate()}</div>
      <div class="e" title="${Weather.sky(d.weather_code[i])}">${skyIcon(d.weather_code[i])}</div>
      <div class="x">${deg(max)}</div><div class="n">ночью ${deg(min)}</div>${rain}</div>`;
  }).join('') + `</div>`;
  const ago = Math.round((Date.now() - new Date(forecast.got).getTime()) / 3600000);
  if (ago >= 6) h += `<p class="note">Прогноз обновлён ${ago} ч назад — нет интернета?</p>`;
  return h;
}

function home() {
  const { now, soon } = weekTasks();
  let h = `${weatherAlerts()}<h2>На этой неделе</h2>`;
  h += now.length ? now.map(taskRow).join('') : `<p class="empty">На этой неделе дел по календарю нет.</p>`;
  if (soon.length) h += `<h2>Скоро</h2>` + soon.map(taskRow).join('');
  const toBuy = shopItems(shopYear()).filter(i => !i.has && i.order <= addDays(today(), 14));
  if (toBuy.length) h += `<a class="chip" href="#/pokupki">🛒 Пора купить или заказать: ${toBuy.length}</a>`;
  h += `<h2>Погода</h2>${weatherBlock()}`;
  if (load('dacha.moon', false)) h += moonBlock();
  h += `<p class="note">Нажмите на дело — откроется подсказка. Квадратик справа — «Сделано».</p>
    <a class="fab" href="#/dnevnik">✎ В дневник</a>`;
  return h;
}

function seasonYear() {
  const t = today();
  return t.getMonth() >= 10 ? t.getFullYear() + 1 : t.getFullYear(); // с ноября — уже следующий сезон
}

function kalendar(param) {
  const y = Number(param) || seasonYear();
  const items = allInstances([y]).sort((a, b) => a.due - b.due);
  let h = `<div style="display:flex;gap:8px"><a class="btn second" href="#/kalendar/${y - 1}">← ${y - 1}</a>
    <a class="btn second" href="#/kalendar/${y + 1}">${y + 1} →</a></div><h2>Сезон ${y}</h2>`;
  for (let m = 0; m < 12; m++) {
    const inM = items.filter(i => i.start.getMonth() === m && i.start.getFullYear() === y);
    if (!inM.length) continue;
    h += `<div class="month"><h2>${MONTHS_TITLE[m]}</h2>${inM.map(taskRow).join('')}</div>`;
  }
  return h;
}

function delo(year, id) {
  const task = D.tasks[id];
  if (!task) return `<p>Не нашла такое дело.</p>`;
  const i = instance(task, Number(year));
  const crop = D.crops[task['культура']];
  let h = `<a class="back" href="javascript:history.back()">← Назад</a><h2>${esc(task['что'])}</h2>`;
  h += `<div class="card"><b>Когда:</b> ${fmtRange(i.start, i.end)}${task['повтор'] ? `, каждые ${task['повтор']} дн.` : ''}</div>`;
  if (task['как']) h += `<div class="card">${esc(task['как'])}</div>`;
  if (task['после']) {
    const dep = D.tasks[task['после']];
    h += `<p class="note">Срок считается от дела «${esc(dep['что'])}». Если отметить его сделанным в другой день, этот срок сдвинется.</p>`;
  }
  if (crop) h += `<p><a href="#/kultura/${crop.id}">Про культуру: ${esc(crop['название'])} →</a></p>`;
  if (i.last) h += `<p>Отмечено сделанным: <b>${fmt(i.last)}</b></p>`;
  h += `<button data-mark="today">✓ Сделано сегодня</button>
    <div class="card"><label>Сделала в другой день:<br><input type="date" id="otherDay" value="${iso(today())}"></label>
    <button class="second" data-mark="other">Сохранить этот день</button></div>`;
  if (i.last) h += `<button class="second" data-mark="undo">Снять отметку</button>`;
  setTimeout(() => view.querySelectorAll('[data-mark]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mark === 'undo') delete done[i.key];
    else done[i.key] = b.dataset.mark === 'today' ? iso(today()) : document.getElementById('otherDay').value;
    save('dacha.done', done);
    render();
  })));
  return h;
}

// --- Участок ---
// Схема участка: рисованный план, повёрнут длинной стороной вертикально (под экран телефона)
const ZONE_LOOK = {   // заливка на схеме и цвет метки в списке
  'дом': { fill: '#b5483f', chip: '#b5483f' }, 'теплица': { fill: 'url(#glass)', chip: '#9ccbe3' },
  'парник': { fill: 'url(#hoops)', chip: '#e8ece4' }, 'огород': { fill: 'url(#soil)', chip: '#8b5e3c' },
  'клумба': { fill: '#9fcf7f', chip: '#e66a9a' }, 'ягодник': { fill: '#8dbb6e', chip: '#5d8f4a' },
  'план': { fill: 'url(#plan)', chip: '#d9467a' },
};
const SHORT = { dom: 'Дом', klumba: 'Цветник', teplitsa: 'Теплица', 'ogorod-bolshoy-verh': 'Огород, верх',
  'ogorod-bolshoy-niz': 'Огород, низ', 'ogorod-vtoroy': 'Второй огород', 'sliva-zhimolost': 'Слива, жимолость' };
// сдвиг подписи на схеме (в метрах: вправо, вверх), чтобы не наезжала на соседей
const LABEL_SHIFT = { teplitsa: [0, 4], 'ogorod-bolshoy-verh': [-2.5, 1.5], klumba: [0, 2.6] };

function mapSvg(activeId) {
  const Z = D.zones, zs = Z['зоны'];
  const th = Z['поворот_схемы_град'] * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const R = ([x, y]) => [x * c - y * s, x * s + y * c];   // поворот плана
  const border = Z['граница_м'].map(R);
  const xs = border.map(p => p[0]), ys = border.map(p => p[1]);
  const minx = Math.min(...xs) - 3, maxx = Math.max(...xs) + 3, miny = Math.min(...ys) - 3, maxy = Math.max(...ys) + 3;
  const S = 10, W = (maxx - minx) * S, H = (maxy - miny) * S;
  const X = x => ((x - minx) * S).toFixed(1), Y = y => ((maxy - y) * S).toFixed(1);
  const pts = poly => poly.map(R).map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const center = poly => {   // центр тяжести площади — для неровных огородов точнее среднего по углам
    const q = poly.map(R);
    let A = 0, cx = 0, cy = 0;
    q.forEach((p, i) => {
      const n = q[(i + 1) % q.length], k = p[0] * n[1] - n[0] * p[1];
      A += k; cx += (p[0] + n[0]) * k; cy += (p[1] + n[1]) * k;
    });
    return A ? [cx / (3 * A), cy / (3 * A)] : q[0];
  };
  // направление грядок на экране — по нему идут борозды и дуги парников
  const az = (Z['азимут_грядок'] || 130) * Math.PI / 180;
  const [bx, by] = R([Math.sin(az), Math.cos(az)]);
  const rowAngle = Math.atan2(-by, bx) * 180 / Math.PI;

  let o = `<svg class="map" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Схема участка">
  <defs>
    <pattern id="soil" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(${rowAngle.toFixed(1)})">
      <rect width="14" height="14" fill="#9a6b45"/><rect y="9" width="14" height="5" fill="#7d5233"/></pattern>
    <pattern id="glass" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(${rowAngle.toFixed(1)})">
      <rect width="18" height="18" fill="#d6ecf7"/><rect width="18" height="2" fill="#a9d0e6"/><rect width="2" height="18" fill="#bfdcec"/></pattern>
    <pattern id="hoops" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(${(rowAngle + 90).toFixed(1)})">
      <rect width="10" height="10" fill="#f6f8f3"/><rect width="3" height="10" fill="#d5ddd2"/></pattern>
    <pattern id="plan" width="12" height="12" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill="#f7d6e2"/><circle cx="6" cy="6" r="2.4" fill="#d9467a"/></pattern>
    <radialGradient id="crown"><stop offset="0" stop-color="#5f9a4f"/><stop offset="1" stop-color="#2f5a2c"/></radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%"><feDropShadow dx="2" dy="3" stdDeviation="2" flood-opacity=".25"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="#c9dcae"/>
  <polygon points="${border.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}" fill="#dde9c8" stroke="#8a6b44" stroke-width="4" stroke-dasharray="14 7"/>`;

  for (const [tx, ty, r] of Z['деревья_м']) {   // лес и крупные деревья
    const [x, y] = R([tx, ty]);
    o += `<circle cx="${X(x)}" cy="${Y(y)}" r="${(r * S).toFixed(0)}" fill="url(#crown)" opacity=".85"/>`;
  }

  zs.forEach(z => {
    const look = ZONE_LOOK[z['тип']] || { fill: '#ddd' };
    const on = z.id === activeId, plan = z['тип'] === 'план';
    o += `<a href="#/zona/${z.id}" class="zone"><polygon points="${pts(z['контур_м'])}" fill="${look.fill}"
      stroke="${on ? '#ff7a00' : plan ? '#d9467a' : '#4a3a28'}" stroke-width="${on ? 7 : 2.5}"
      ${plan ? 'stroke-dasharray="8 5"' : ''} filter="url(#shadow)"/>`;
    const [cx, cy] = center(z['контур_м']);
    if (z['тип'] === 'дом') {   // конёк крыши
      const q = z['контур_м'].map(R);
      const m1 = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], m2 = [(q[2][0] + q[3][0]) / 2, (q[2][1] + q[3][1]) / 2];
      o += `<line x1="${X(m1[0])}" y1="${Y(m1[1])}" x2="${X(m2[0])}" y2="${Y(m2[1])}" stroke="#7e2b25" stroke-width="4"/>`;
    }
    if (z['тип'] === 'клумба') {   // клумбы-покрышки двумя полукругами
      const colors = ['#e66a9a', '#f2c230', '#c75bd6', '#f08a3c'];
      for (let k = 0; k < 12; k++) {
        const ang = Math.PI * (k % 6) / 5, ring = k < 6 ? 2.8 : 1.5;
        const px = cx + ring * Math.cos(ang), py = cy - 1.5 + ring * Math.sin(ang);
        o += `<circle cx="${X(px)}" cy="${Y(py)}" r="6" fill="${colors[k % 4]}" stroke="#333" stroke-width="3"/>`;
      }
    }
    if (z['тип'] === 'ягодник') {   // кусты
      for (const [dx, dy] of [[-3, 1], [0, 3], [3, -1], [-1, -3], [2, 2.5], [-3.5, -1.5]]) {
        o += `<circle cx="${X(cx + dx)}" cy="${Y(cy + dy)}" r="14" fill="#4f8a3e" stroke="#2f5a2c" stroke-width="2"/>`;
      }
    }
    o += `</a>`;
  });

  // подписи: крупным местам — название, мелким — номер в кружке (как в списке под схемой)
  zs.forEach((z, n) => {
    const [cx, cy] = center(z['контур_м']);
    if (SHORT[z.id]) {
      const [sx, sy] = LABEL_SHIFT[z.id] || [0, 0];
      o += `<text x="${X(cx + sx)}" y="${Y(cy + sy)}" font-size="26" font-weight="700" text-anchor="middle"
        dominant-baseline="middle" fill="#1d1d1d" stroke="#fff" stroke-width="6" stroke-linejoin="round" paint-order="stroke"
        pointer-events="none">${SHORT[z.id]}</text>`;
    } else {
      o += `<g pointer-events="none"><circle cx="${X(cx)}" cy="${Y(cy)}" r="12" fill="#fff" stroke="#333" stroke-width="2"/>
        <text x="${X(cx)}" y="${Y(cy)}" font-size="14" font-weight="700" text-anchor="middle" dominant-baseline="central">${n + 1}</text></g>`;
    }
  });

  // стрелка на север
  const [nx, ny] = R([0, 1]);
  const rot = Math.atan2(nx, ny) * 180 / Math.PI;
  o += `<g transform="translate(${(W - 46).toFixed(0)} 52)"><circle r="32" fill="#fff" opacity=".92"/>
    <g transform="rotate(${rot.toFixed(1)})"><path d="M0 -26 L11 8 L0 2 L-11 8 Z" fill="#b5483f"/></g>
    <text y="27" font-size="15" font-weight="700" text-anchor="middle">север</text></g>`;
  return o + `</svg>`;
}

function uchastok() {
  let h = `<h2>Участок</h2>${mapSvg()}<p class="note">Нажмите на место на схеме или выберите в списке.</p>`;
  h += `<div class="zlist">` + D.zones['зоны'].map((z, n) => {
    const look = ZONE_LOOK[z['тип']] || {};
    const dark = ['дом', 'огород', 'ягодник', 'план'].includes(z['тип']);
    return `<a href="#/zona/${z.id}"><span class="num" style="background:${look.chip || '#fff'};color:${dark ? '#fff' : '#111'}">${n + 1}</span>${esc(z['название'])}</a>`;
  }).join('') + `</div>`;
  return h;
}

const SUN = { 'солнце': '☀️ солнечно', 'полутень': '⛅ полутень', 'тень': '🌳 тень' };

function cropNames(ids) {
  return ids.map(c => D.crops[c] ? D.crops[c]['название'] : c).join(', ');
}

function zona(id) {
  const z = D.zones['зоны'].find(q => q.id === id);
  if (!z) return `<p>Не нашла такой участок.</p>`;
  let h = `<a class="back" href="#/uchastok">← Схема</a><h2>${esc(z['название'])}</h2>${mapSvg(id)}`;
  const info = [];
  if (z['размер']) info.push(`Размер: ${esc(z['размер'])}`);
  if (z['площадь_м2'] && z['тип'] !== 'дом') info.push(`Площадь: около ${Math.round(z['площадь_м2'])} м²`);
  if (z['освещённость']) info.push(`${SUN[z['освещённость']]}, летом около ${Math.round(z['солнце_часов_в_день']['июнь'])} ч солнца в день`);
  if (info.length) h += `<div class="card">${info.join('<br>')}</div>`;
  if (z['заметки']) h += `<p>${esc(z['заметки'])}</p>`;
  for (const [year, plan] of Object.entries(D.plan).filter(([k]) => /^\d{4}$/.test(k))) {
    const p = plan['зоны'][id];
    if (!p) continue;
    h += `<h3>План на ${year}</h3><div class="card"><b>${esc(cropNames(p['культуры']))}</b>
      ${p['сколько'] ? `<br>${esc(p['сколько'])}` : ''}<p class="note">Почему: ${esc(p['почему'])}</p></div>`;
    const tasks = D.calendar['дела'].filter(t => p['культуры'].includes(t['культура']) || (t['зоны'] || []).includes(id));
    const y = Number(year);
    const items = tasks.map(t => instance(t, y)).sort((a, b) => a.due - b.due);
    if (items.length) h += `<h3>Что здесь делать в ${year}</h3>` + items.map(taskRow).join('');
  }
  // История: из анкеты (zones.json) + записи дневника «посадила» в этой зоне
  const hist = Object.entries(z['история'] || {});
  const fromDiary = {};
  for (const e of diary.filter(e => e['зона'] === id && e['вид'] === 'posadka')) {
    const y = e['дата'].slice(0, 4);
    (fromDiary[y] = fromDiary[y] || []).push([cropName(e['культура']), e['сорт']].filter(Boolean).join(' '));
  }
  for (const [y, list] of Object.entries(fromDiary)) hist.push([y, list.join(', ') + ' (из дневника)']);
  hist.sort((p, q) => q[0].localeCompare(p[0]));
  if (hist.length) h += `<h3>Что росло раньше</h3>` + hist.map(([y, t]) => `<p><b>${y}:</b> ${esc(t)}</p>`).join('');
  return h;
}

// --- Культуры ---
function kultury() {
  return `<h2>Что сажаем</h2>` + D.cropsList.map(c =>
    `<a class="task" href="#/kultura/${c.id}"><div class="txt">${esc(c['название'])}</div></a>`).join('');
}

function kultura(id) {
  const c = D.crops[id];
  if (!c) return `<p>Не нашла такую культуру.</p>`;
  let h = `<a class="back" href="#/kultury">← Все культуры</a><h2>${esc(c['название'])}</h2>`;
  if (c['где']) h += `<div class="card">Где: ${esc(c['где'].join(', '))}<br>Как: ${esc(c['способ'] || '')}</div>`;
  h += cardHtml(id);
  const vs = D.varieties['сорта'].filter(v => v['культура'] === id && v['выбран']);
  if (vs.length) {
    h += `<h3>Сорта</h3>` + vs.map(v => `<div class="card"><b>${esc(v['сорт'])}</b>${v['гибрид_F1'] ? ' F1' : ''}
      ${v['для_заготовок'] ? ' — для заготовок' : ''}<br>${esc(v['где_растить'])}; ${esc(v['назначение'])}
      ${v['примечание'] ? `<p class="note">${esc(v['примечание'])}</p>` : ''}
      ${v['магазин_мамы'] ? `<a href="${esc(v['магазин_мамы']['ссылка'])}" target="_blank" rel="noopener">В магазине «Сады России» →</a>` : ''}</div>`).join('');
  }
  const y = seasonYear();
  const items = D.calendar['дела'].filter(t => t['культура'] === id).map(t => instance(t, y)).sort((a, b) => a.due - b.due);
  if (items.length) h += `<h3>Дела в ${y}</h3>` + items.map(taskRow).join('');
  return h;
}

// Карточка «как сажать и ухаживать» из data/cards.json
const CARD_PARTS = [['посев', 'Посев'], ['посадка', 'Посадка'], ['полив', 'Полив'], ['подкормки', 'Подкормки'],
  ['навоз', 'Навоз'], ['уход', 'Уход'], ['соседи', 'Соседи'], ['вредители_болезни', 'Вредители и болезни']];

function cardHtml(id) {
  const k = D.cards['карточки'][id];
  if (!k) return '';
  let h = `<h3>Как растить</h3>`;
  for (const [key, title] of CARD_PARTS) {
    const v = k[key];
    if (!v) continue;
    const items = Array.isArray(v) ? v : [v];
    h += `<div class="card"><b>${title}</b>${items.length > 1
      ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${esc(items[0])}</p>`}</div>`;
  }
  return h;
}

// --- Покупки ---
let have = load('dacha.have', {});   // "2027:semena-tomat" -> true

// Покупки готовим заранее: с августа — уже к следующему сезону
function shopYear() {
  const t = today();
  return t.getMonth() >= 7 ? t.getFullYear() + 1 : t.getFullYear();
}

function shopItems(year) {
  const S = D.shopping;
  return S['покупки'].filter(p => !p['с_года'] || year >= p['с_года']).map(p => {
    let need;
    if (p['нужно_к']) need = startOf(D.tasks[p['нужно_к']], year);
    else { const [m, d] = p['дата_нужно'].split('-').map(Number); need = new Date(year, m - 1, d); }
    const order = addDays(need, -S['доставка'][p['доставка']]['дней']);
    return { p, need, order, key: `${year}:${p.id}`, has: !!have[`${year}:${p.id}`] };
  }).sort((a, b) => a.order - b.order);
}

function varietyLine(crops) {
  const ids = crops.split(',');
  return D.varieties['сорта'].filter(v => ids.includes(v['культура']) && v['выбран']).map(v =>
    v['магазин_мамы'] ? `<a href="${esc(v['магазин_мамы']['ссылка'])}" target="_blank" rel="noopener">${esc(v['сорт'])}</a>` : esc(v['сорт'])
  ).join(', ');
}

function shopRow(i) {
  const t = today();
  const late = !i.has && i.order < t;
  const how = i.p['доставка'] === 'почта' ? 'заказать до' : 'купить до';
  const icon = i.p['сорта_культуры'] ? cropIcon(i.p['сорта_культуры'].split(',')[0]) : '🛒';
  return `<div class="task${late ? ' late' : ''}${i.has ? ' done' : ''}">
    <span class="lead" aria-hidden="true">${icon}</span>
    <div class="txt"><div>${esc(i.p['что'])}</div>
    <div class="when">${late ? 'Пора! ' : ''}${how} ${fmt(i.order)} · нужно к ${fmt(i.need)}</div>
    ${i.p['сорта_культуры'] ? `<div class="note">Сорта: ${varietyLine(i.p['сорта_культуры'])}</div>` : ''}
    ${i.p['примечание'] ? `<div class="note">${esc(i.p['примечание'])}</div>` : ''}</div>
    <button class="check${i.has ? ' on' : ''}" data-have="${i.key}" aria-label="Уже есть">${i.has ? '✓' : ''}</button></div>`;
}

function pokupki() {
  const y = shopYear();
  const items = shopItems(y);
  const t = today();
  const todo = items.filter(i => !i.has), got = items.filter(i => i.has);
  let h = `<a class="back" href="#/eshche">← Ещё</a><h2>Покупки к сезону ${y}</h2>
    <p class="note">Галочка — «уже есть»: вещь уйдёт вниз списка. Почтой заказывать заранее — доставка до Февральска долгая.</p>`;
  const mail = todo.filter(i => i.p['доставка'] === 'почта' && i.p.id.startsWith('semena'));
  if (mail.length) h += `<div class="card">💡 Удобнее заказать <b>все семена одним заказом до ${fmt(mail[0].order)}</b> —
    одна посылка, и проще набрать минимальный заказ.</div>`;
  const urgent = todo.filter(i => i.order <= addDays(t, 14));
  if (urgent.length) h += `<h2>Срочно</h2>` + urgent.map(shopRow).join('');
  const rest = todo.filter(i => i.order > addDays(t, 14));
  let month = -1;
  for (const i of rest) {
    if (i.order.getMonth() !== month) { month = i.order.getMonth(); h += `<h2>${MONTHS_TITLE[month]}</h2>`; }
    h += shopRow(i);
  }
  if (got.length) h += `<h2>Уже есть</h2>` + got.map(shopRow).join('');
  const m = D.shopping['магазин'];
  h += `<p class="note">Магазин: <a href="${esc(m['сайт'])}" target="_blank" rel="noopener">${esc(m['название'])}</a>, семена — заказ от ${m['минимальный_заказ_семян_руб']} ₽.</p>`;
  return h;
}

// --- Что с растением ---
function chto(plant) {
  const S = D.symptoms;
  if (!plant) {
    return `<a class="back" href="#/eshche">← Ещё</a><h2>Что с растением?</h2><p>Выберите растение:</p>` +
      S['растения'].map(r => `<a class="btn second" href="#/chto/${r.id}">${r['значок']} ${esc(r['название'])}</a>`).join('');
  }
  const r = S['растения'].find(x => x.id === plant);
  const list = S['признаки'].filter(p => p['растения'].includes(plant));
  return `<a class="back" href="#/chto">← Растения</a><h2>${r ? r['значок'] + ' ' + esc(r['название']) : ''}: что видно?</h2>` +
    list.map(p => `<a class="task" href="#/priznak/${p.id}"><span style="font-size:1.6rem">${p['значок']}</span>
      <div class="txt">${esc(p['что_видно'])}</div></a>`).join('') +
    `<p class="note">Нет похожего? Сфотографируйте и отправьте Роме.</p>`;
}

function priznak(id) {
  const p = D.symptoms['признаки'].find(x => x.id === id);
  if (!p) return `<p>Не нашла.</p>`;
  let h = `<a class="back" href="javascript:history.back()">← Назад</a><h2>${p['значок']} ${esc(p['что_видно'])}</h2>
    <div class="card"><b>Что это, скорее всего</b><p>${esc(p['что_это'])}</p></div>
    <div class="card"><b>Что делать</b><ul>${p['что_делать'].map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  return h;
}

// --- Уведомления о погоде ---
function b64ToBytes(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function pushBlock() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return `<p class="note">Этот браузер не умеет получать уведомления. Откройте приложение в Chrome.</p>`;
  }
  const code = load('dacha.pushCode', '');
  let h = `<button id="pushOn">🔔 Включить предупреждения о погоде</button>
    <p class="note">Вечером придёт уведомление, только если ночью заморозок, завтра жара, ливень или риск фитофторы. В спокойные дни — тишина.</p>`;
  if (code) {
    h += `<div class="card"><b>Готово! Отправьте этот код Роме</b> — он подключит уведомления:
      <textarea id="pushCode" readonly rows="4" style="width:100%;font-size:0.7rem">${esc(code)}</textarea>
      <button class="second" id="pushCopy">📋 Скопировать код</button>
      <a class="btn second" href="https://wa.me/?text=${encodeURIComponent(code)}" target="_blank" rel="noopener">Отправить в WhatsApp</a></div>
      <button class="second" id="pushTest">Проверить: показать уведомление сейчас</button>`;
  }
  return h;
}

function bindPush() {
  const on = document.getElementById('pushOn');
  if (on) on.onclick = async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') {
        alert('Уведомления запрещены. Разрешите их в настройках Chrome для этого сайта.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();   // переподписка — на случай, если старая перестала работать
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(D.push['vapid_public_key']) });
      save('dacha.pushCode', JSON.stringify(sub));
      render();
    } catch (e) { alert('Не получилось включить: ' + e.message); }
  };
  const copy = document.getElementById('pushCopy');
  if (copy) copy.onclick = () => {
    const t = document.getElementById('pushCode');
    t.select();
    (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.resolve(document.execCommand('copy')))
      .then(() => { copy.textContent = '✓ Скопировано'; });
  };
  const test = document.getElementById('pushTest');
  if (test) test.onclick = async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Дачный помощник', { body: 'Так будут выглядеть предупреждения о погоде', icon: 'img/icon-192.png' });
  };
}

// --- Дневник ---
// Записи — в localStorage ('dacha.diary'), фото — в IndexedDB (они большие).
// Копия всего (записи, отметки «сделано», покупки) — файлом через «Отправить копию Роме».
let diary = load('dacha.diary', []);
const KINDS = { posadka: '🌱 Посадила', urozhay: '🧺 Урожай', zametka: '📝 Заметка' };
const HARVEST = ['много', 'нормально', 'мало'];
const BACKUP_DAYS = 14;

function photoDb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open('dacha', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function photoPut(id, blob) {
  const db = await photoDb();
  return new Promise(ok => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(blob, id); tx.oncomplete = ok; });
}
async function photoGet(id) {
  const db = await photoDb();
  return new Promise(ok => { const q = db.transaction('photos').objectStore('photos').get(id); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); });
}

// Уменьшаем фото до 1280 px, чтобы не забить память телефона
function shrink(file) {
  return new Promise(ok => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(ok, 'image/jpeg', 0.75);
    };
    img.src = URL.createObjectURL(file);
  });
}

function saveDiary() {
  save('dacha.diary', diary);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();  // просим не очищать данные
}

function zoneName(id) { const z = D.zones['зоны'].find(q => q.id === id); return z ? z['название'] : ''; }
function cropName(id) { return D.crops[id] ? D.crops[id]['название'] : ''; }

function dnevnik() {
  let h = `<h2>Дневник</h2><div class="row">` +
    Object.entries(KINDS).map(([k, t]) => `<a class="btn" style="font-size:0.85rem;padding:0 4px" href="#/zapis/${k}">${t}</a>`).join('') + `</div>`;
  const last = load('dacha.backupAt', null);
  if (diary.length && (!last || Date.now() - new Date(last).getTime() > BACKUP_DAYS * DAY)) {
    h += `<div class="alert soft">Давно не отправляли копию дневника Роме. <a href="#/kopiya">Отправить копию</a></div>`;
  }
  if (!diary.length) h += `<p class="empty">Пока записей нет. Отмечайте, что и где посадили и сколько собрали — по этим записям на следующий год составится план посадок.</p>`;
  const sorted = [...diary].sort((a, b) => b['дата'].localeCompare(a['дата']));
  h += sorted.map(e => `<div class="card"><b>${KINDS[e['вид']]}</b> · ${fmt(parse(e['дата']))} ${parse(e['дата']).getFullYear()}
    <br>${[cropName(e['культура']), e['сорт'], zoneName(e['зона'])].filter(Boolean).map(esc).join(' · ')}
    ${e['урожай'] ? `<br>Урожай: ${esc(e['урожай'])}${e['кг'] ? `, ${esc(e['кг'])} кг` : ''}` : ''}
    ${e['заметка'] ? `<p>${esc(e['заметка'])}</p>` : ''}
    ${e['фото'] ? `<img data-photo="${e.id}" alt="фото" style="width:100%;border-radius:8px;margin-top:6px">` : ''}
    <button class="second" data-del="${e.id}" style="min-height:48px;line-height:44px">Удалить запись</button></div>`).join('');
  h += `<a class="btn second" href="#/kopiya">📤 Копия для Ромы</a>`;
  return h;
}

function zapis(kind) {
  const opt = (list, sel) => list.map(([v, t]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const zones = D.zones['зоны'].filter(z => z['тип'] !== 'дом').map(z => [z.id, z['название']]);
  const crops = D.cropsList.map(c => [c.id, c['название']]);
  let h = `<a class="back" href="#/dnevnik">← Дневник</a><h2>${KINDS[kind]}</h2>
    <label class="card" style="display:block">Когда<input type="date" id="fDate" value="${iso(today())}"></label>
    <label class="card" style="display:block">Что<select id="fCrop" class="big"><option value="">—</option>${opt(crops)}</select></label>
    <label class="card" style="display:block">Сорт<input id="fVar" list="varList" class="big" placeholder="можно не заполнять"><datalist id="varList"></datalist></label>
    <label class="card" style="display:block">Где<select id="fZone" class="big"><option value="">—</option>${opt(zones)}</select></label>`;
  if (kind === 'urozhay') {
    h += `<div class="card">Сколько<div class="row">${HARVEST.map(x =>
      `<button class="second" data-harv="${x}" style="font-size:0.9rem">${x}</button>`).join('')}</div>
      <label>или в килограммах<input type="number" id="fKg" class="big" inputmode="decimal"></label></div>`;
  }
  h += `<label class="card" style="display:block">Заметка<textarea id="fNote" rows="3" class="big"></textarea></label>
    <label class="card" style="display:block">Фото (по желанию)<input type="file" id="fPhoto" accept="image/*" capture="environment"></label>
    <button id="fSave">Сохранить</button>`;
  return h;
}

function bindDiary(kind) {
  view.querySelectorAll('[data-photo]').forEach(async img => {
    const b = await photoGet(img.dataset.photo);
    if (b) img.src = URL.createObjectURL(b); else img.remove();
  });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (!confirm('Удалить эту запись?')) return;
    diary = diary.filter(e => e.id !== b.dataset.del);
    saveDiary(); render();
  });
  const crop = document.getElementById('fCrop');
  if (crop) crop.onchange = () => {
    document.getElementById('varList').innerHTML = D.varieties['сорта'].filter(v => v['культура'] === crop.value)
      .map(v => `<option value="${esc(v['сорт'])}">`).join('');
  };
  let harvest = '';
  view.querySelectorAll('[data-harv]').forEach(b => b.onclick = () => {
    harvest = b.dataset.harv;
    view.querySelectorAll('[data-harv]').forEach(x => x.classList.toggle('second', x !== b));
  });
  const sv = document.getElementById('fSave');
  if (sv) sv.onclick = async () => {
    const e = { id: Date.now().toString(36), 'вид': kind, 'дата': document.getElementById('fDate').value,
      'культура': crop.value, 'сорт': document.getElementById('fVar').value.trim(), 'зона': document.getElementById('fZone').value,
      'заметка': document.getElementById('fNote').value.trim() };
    if (kind === 'urozhay') { e['урожай'] = harvest; e['кг'] = document.getElementById('fKg').value; }
    const f = document.getElementById('fPhoto').files[0];
    if (f) { await photoPut(e.id, await shrink(f)); e['фото'] = true; }
    diary.push(e);
    saveDiary();
    location.hash = '#/dnevnik';
  };
}

// Копия данных: всё, что мама отметила в телефоне (без фото)
function backupData() {
  return { 'приложение': 'Дачный помощник', 'создано': new Date().toISOString(),
    diary, done, have: load('dacha.have', {}) };
}

function kopiya() {
  return `<a class="back" href="#/dnevnik">← Дневник</a><h2>Копия для Ромы</h2>
    <p>Копия дневника и всех отметок («сделано», «уже есть»). Фото в копию не входят.</p>
    <button id="bkSend">📤 Отправить копию Роме</button>
    <p class="note">Откроется выбор: WhatsApp → Рома.</p>
    <h3>Загрузить копию</h3>
    <p class="note">Для Ромы: выберите файл копии от мамы — записи добавятся к этому телефону.</p>
    <input type="file" id="bkLoad" accept=".json,application/json">`;
}

function bindBackup() {
  const send = document.getElementById('bkSend');
  if (send) send.onclick = async () => {
    const name = `dacha-${iso(today())}.json`;
    const file = new File([JSON.stringify(backupData(), null, 1)], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Дачный помощник: копия' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); }
      save('dacha.backupAt', new Date().toISOString());
    } catch (e) { /* мама передумала отправлять */ }
  };
  const ld = document.getElementById('bkLoad');
  if (ld) ld.onchange = async () => {
    try {
      const j = JSON.parse(await ld.files[0].text());
      const ids = new Set(diary.map(e => e.id));
      diary = diary.concat((j.diary || []).filter(e => !ids.has(e.id)));
      done = { ...done, ...(j.done || {}) };
      have = { ...have, ...(j.have || {}) };
      saveDiary(); save('dacha.done', done); save('dacha.have', have);
      alert('Копия загружена.');
      location.hash = '#/dnevnik';
    } catch (e) { alert('Не получилось прочитать файл: ' + e.message); }
  };
}

// --- Ещё ---
function eshche() {
  return `<a class="btn" href="#/dnevnik">📖 Дневник</a>
    <a class="btn" href="#/pokupki">🛒 Покупки</a>
    <a class="btn" href="#/chto">🔍 Что с растением?</a>
    <h2>Как пользоваться</h2>
    <div class="card">На <b>Главной</b> — что сделать на этой неделе. Нажмите на дело — откроется подсказка.
    Сделали — нажмите квадратик. Если сделали в другой день, откройте дело и выберите день: следующие сроки сами сдвинутся.</div>
    <div class="card">На <b>Участке</b> — схема. Нажмите на грядку, теплицу или огород — увидите, что там посажено и что делать.</div>
    <div class="card">Красная плашка на Главной — <b>предупреждение о погоде</b>: заморозок, жара, ливень. Прогноз на неделю — внизу Главной.</div>
    <div class="card">Посадили или собрали урожай — запишите в <b>Дневник</b>. По записям на следующий год составится план, что куда сажать.</div>
    <div class="card">В <b>Покупках</b> — что и когда заказать. Есть уже — нажмите квадратик.</div>
    <h2>Предупреждения о погоде</h2>
    ${pushBlock()}
    <h2>Настройки</h2>
    <button class="second" id="moonBtn">🌙 ${load('dacha.moon', false) ? 'Выключить' : 'Включить'} лунный календарь</button>
    <p class="note">Народная традиция: на главной будет фаза Луны и подсказка.</p>`;
}

// ---------- Маршруты ----------
function render() {
  const [, page, a, b] = (location.hash || '#/').split('/');
  const tab = { '': 'home', uchastok: 'uchastok', zona: 'uchastok', kalendar: 'kalendar', delo: 'kalendar',
    kultury: 'kultury', kultura: 'kultury', eshche: 'eshche', pokupki: 'eshche', chto: 'eshche', priznak: 'eshche',
    dnevnik: 'eshche', zapis: 'eshche', kopiya: 'eshche' }[page || ''] || 'home';
  document.querySelectorAll('.tabs a').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  const pages = { '': home, uchastok, zona: () => zona(a), kalendar: () => kalendar(a), delo: () => delo(a, b),
    kultury, kultura: () => kultura(a), eshche, pokupki, chto: () => chto(a), priznak: () => priznak(a),
    dnevnik, zapis: () => zapis(a), kopiya };
  view.innerHTML = (pages[page || ''] || home)();
  // в шапке главной — сегодняшняя дата
  const t = today();
  const wd = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][t.getDay()];
  document.getElementById('sub').textContent = page ? '' : `${wd}, ${fmt(t)} · Февральск`;
  bindChecks();
  view.querySelectorAll('[data-have]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.have;
    if (have[k]) delete have[k]; else have[k] = true;
    save('dacha.have', have);
    render();
  }));
  bindPush();
  bindDiary(a);
  bindBackup();
  const mb = document.getElementById('moonBtn');
  if (mb) mb.onclick = () => { save('dacha.moon', !load('dacha.moon', false)); render(); };
  window.scrollTo(0, 0);
}

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const files = ['calendar', 'crops', 'varieties', 'zones', 'plan', 'cards', 'shopping', 'symptoms', 'weather', 'push'];
  const got = await Promise.all(files.map(f => fetch(`data/${f}.json`).then(r => r.json())));
  files.forEach((f, n) => { D[f] = got[n]; });
  D.tasks = Object.fromEntries(D.calendar['дела'].map(t => [t.id, t]));
  D.cropsList = D.crops['культуры'];
  D.crops = Object.fromEntries(D.cropsList.map(c => [c.id, c]));
  // культуры-«служебные» для дел календаря
  Object.assign(D.crops, {
    teplitsa: { id: 'teplitsa', 'название': 'Теплица', 'значок': '🏡' }, rassada: { id: 'rassada', 'название': 'Рассада', 'значок': '🌱' },
    zelen: { id: 'zelen', 'название': 'Зелень', 'значок': '🌿' }, 'зелень': { id: 'zelen', 'название': 'зелень', 'значок': '🌿' },
  });
  window.addEventListener('hashchange', render);
  render();
  loadForecast();
}

start().catch(e => { view.innerHTML = `<p>Не получилось загрузить данные. Проверьте интернет и обновите страницу.</p><p class="note">${esc(e)}</p>`; });
