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
const isRoma = () => load('dacha.roma', false);

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
    <button class="check${i.isDone ? ' on' : ''}" data-done="${i.key}" aria-label="Сделано">${i.isDone ? '✓' : ''}</button>
    <a class="txt" href="#/delo/${i.year}/${i.task.id}" style="color:inherit;text-decoration:none">
      <div>${esc(i.task['что'])}</div><div class="when">${when}</div></a></div>`;
}

function bindChecks() {
  view.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.done;
    if (done[k] && !D.tasks[k.split(':')[1]]['повтор']) delete done[k];
    else done[k] = iso(today());
    save('dacha.done', done);
    render();
  }));
}

function home() {
  const { now, soon } = weekTasks();
  let h = `<h2>На этой неделе</h2>`;
  h += now.length ? now.map(taskRow).join('') : `<p class="empty">На этой неделе дел по календарю нет.</p>`;
  if (soon.length) h += `<h2>Скоро</h2>` + soon.map(taskRow).join('');
  const toBuy = shopItems(shopYear()).filter(i => !i.has && i.order <= addDays(today(), 14));
  if (toBuy.length) h += `<a class="btn second" href="#/pokupki">🛒 Пора купить или заказать: ${toBuy.length}</a>`;
  h += `<p class="note">Нажмите на дело, чтобы прочитать, как его сделать. Квадратик — отметить «Сделано».</p>`;
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
  if (isRoma() && task['проверено'] === false) h += `<div class="roma">Для Ромы: срок этого дела без надёжного источника — уточнить.</div>`;
  setTimeout(() => view.querySelectorAll('[data-mark]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mark === 'undo') delete done[i.key];
    else done[i.key] = b.dataset.mark === 'today' ? iso(today()) : document.getElementById('otherDay').value;
    save('dacha.done', done);
    render();
  })));
  return h;
}

// --- Участок ---
const ZONE_FILL = { 'дом': '#c0504d', 'теплица': '#cfe3f0', 'парник': '#e6f2fa', 'огород': '#b98b5e', 'клумба': '#f2b8d0', 'ягодник': '#7fb27a', 'план': '#e9c46a' };

function mapSvg(activeId) {
  const zs = D.zones['зоны'];
  const pts = zs.flatMap(z => z['контур_м']);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minx = Math.min(...xs) - 2, maxx = Math.max(...xs) + 2, miny = Math.min(...ys) - 2, maxy = Math.max(...ys) + 2;
  const S = 10, W = (maxx - minx) * S, H = (maxy - miny) * S;
  const X = x => ((x - minx) * S).toFixed(0), Y = y => ((maxy - y) * S).toFixed(0);
  let s = `<svg class="map" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`;
  zs.forEach((z, n) => {
    const p = z['контур_м'].map(q => `${X(q[0])},${Y(q[1])}`).join(' ');
    const on = z.id === activeId;
    s += `<a href="#/zona/${z.id}" class="zone"><polygon points="${p}" fill="${ZONE_FILL[z['тип']] || '#ddd'}"
      stroke="${on ? '#d00' : '#333'}" stroke-width="${on ? 6 : 2}"/></a>`;
  });
  zs.forEach((z, n) => {
    const c = z['контур_м'];
    const cx = c.reduce((a, q) => a + q[0], 0) / c.length, cy = c.reduce((a, q) => a + q[1], 0) / c.length;
    s += `<text x="${X(cx)}" y="${Y(cy)}" font-size="22" font-weight="700" text-anchor="middle" dominant-baseline="middle"
      stroke="#fff" stroke-width="5" paint-order="stroke" pointer-events="none">${n + 1}</text>`;
  });
  s += `<text x="${W - 30}" y="40" font-size="30" text-anchor="middle">С↑</text></svg>`;
  return s;
}

function uchastok() {
  let h = `<p class="note">Нажмите на участок на схеме или на название в списке.</p>${mapSvg()}`;
  h += `<div class="zlist">` + D.zones['зоны'].map((z, n) =>
    `<a href="#/zona/${z.id}"><span class="num">${n + 1}</span>${esc(z['название'])}</a>`).join('') + `</div>`;
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
  const hist = Object.entries(z['история'] || {});
  if (hist.length) h += `<h3>Что росло раньше</h3>` + hist.map(([y, t]) => `<p><b>${y}:</b> ${esc(t)}</p>`).join('');
  if (isRoma() && !z['проверено']) h += `<div class="roma">Для Ромы: ${esc(z['откуда_размер'])}</div>`;
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
  if (isRoma() && c['примечание']) h += `<div class="roma">Для Ромы: ${esc(c['примечание'])}</div>`;
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
  return `<div class="task${late ? ' late' : ''}${i.has ? ' done' : ''}">
    <button class="check${i.has ? ' on' : ''}" data-have="${i.key}" aria-label="Уже есть">${i.has ? '✓' : ''}</button>
    <div class="txt"><div>${esc(i.p['что'])}</div>
    <div class="when">${late ? 'Пора! ' : ''}${how} ${fmt(i.order)} · нужно к ${fmt(i.need)}</div>
    ${i.p['сорта_культуры'] ? `<div class="note">Сорта: ${varietyLine(i.p['сорта_культуры'])}</div>` : ''}
    ${i.p['примечание'] ? `<div class="note">${esc(i.p['примечание'])}</div>` : ''}</div></div>`;
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
  if (isRoma()) h += `<div class="roma">Для Ромы: срок почтовой доставки (42 дня) — допущение, уточнить у мамы.</div>`;
  return h;
}

// --- Ещё ---
function eshche() {
  const roma = isRoma();
  return `<a class="btn" href="#/pokupki">🛒 Покупки</a>
    <h2>Как пользоваться</h2>
    <div class="card">На <b>Главной</b> — что сделать на этой неделе. Нажмите на дело — откроется подсказка.
    Сделали — нажмите квадратик. Если сделали в другой день, откройте дело и выберите день: следующие сроки сами сдвинутся.</div>
    <div class="card">На <b>Участке</b> — схема. Нажмите на грядку, теплицу или огород — увидите, что там посажено и что делать.</div>
    <h2>Скоро появится</h2>
    <p>Погода и предупреждения о заморозках, список покупок, дневник, справочник «что с растением».</p>
    <h2>Настройки</h2>
    <button class="second" id="romaBtn">${roma ? 'Выключить' : 'Включить'} режим для Ромы</button>
    <p class="note">В режиме для Ромы видны пометки о допущениях и непроверенных сроках.</p>`;
}

// ---------- Маршруты ----------
function render() {
  const [, page, a, b] = (location.hash || '#/').split('/');
  const tab = { '': 'home', uchastok: 'uchastok', zona: 'uchastok', kalendar: 'kalendar', delo: 'kalendar',
    kultury: 'kultury', kultura: 'kultury', eshche: 'eshche', pokupki: 'eshche' }[page || ''] || 'home';
  document.querySelectorAll('.tabs a').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  const pages = { '': home, uchastok, zona: () => zona(a), kalendar: () => kalendar(a), delo: () => delo(a, b),
    kultury, kultura: () => kultura(a), eshche, pokupki };
  view.innerHTML = (pages[page || ''] || home)();
  bindChecks();
  view.querySelectorAll('[data-have]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.have;
    if (have[k]) delete have[k]; else have[k] = true;
    save('dacha.have', have);
    render();
  }));
  const rb = document.getElementById('romaBtn');
  if (rb) rb.onclick = () => { save('dacha.roma', !isRoma()); render(); };
  window.scrollTo(0, 0);
}

async function start() {
  const files = ['calendar', 'crops', 'varieties', 'zones', 'plan', 'cards', 'shopping'];
  const got = await Promise.all(files.map(f => fetch(`data/${f}.json`).then(r => r.json())));
  files.forEach((f, n) => { D[f] = got[n]; });
  D.tasks = Object.fromEntries(D.calendar['дела'].map(t => [t.id, t]));
  D.cropsList = D.crops['культуры'];
  D.crops = Object.fromEntries(D.cropsList.map(c => [c.id, c]));
  // культуры-«служебные» для дел календаря
  Object.assign(D.crops, {
    teplitsa: { id: 'teplitsa', 'название': 'Теплица' }, rassada: { id: 'rassada', 'название': 'Рассада' },
    zelen: { id: 'zelen', 'название': 'Зелень' }, 'зелень': { id: 'zelen', 'название': 'зелень' },
  });
  window.addEventListener('hashchange', render);
  render();
}

start().catch(e => { view.innerHTML = `<p>Не получилось загрузить данные. Проверьте интернет и обновите страницу.</p><p class="note">${esc(e)}</p>`; });
