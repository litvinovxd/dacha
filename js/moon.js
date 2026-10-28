// Фаза Луны — астрономический расчёт (Ж. Меёс, «Астрономические алгоритмы», гл. 47–48,
// упрощённая теория: точность около 1°, этого достаточно, чтобы определить фазу на день).
'use strict';

(function (root) {
  const rad = d => d * Math.PI / 180;

  // Элонгация Луны (угол Луна–Солнце, 0…360°) на момент date
  function elongation(date) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const T = (jd - 2451545) / 36525;
    const D = 297.8501921 + 445267.1114034 * T;   // средняя элонгация
    const M = 357.5291092 + 35999.0502909 * T;    // аномалия Солнца
    const Mp = 134.9633964 + 477198.8675055 * T;  // аномалия Луны
    const e = D + 6.289 * Math.sin(rad(Mp)) - 2.100 * Math.sin(rad(M)) + 1.274 * Math.sin(rad(2 * D - Mp))
      + 0.658 * Math.sin(rad(2 * D)) + 0.214 * Math.sin(rad(2 * Mp)) + 0.110 * Math.sin(rad(D));
    return ((e % 360) + 360) % 360;
  }

  // Фаза на день (полдень по Амурской области, UTC+9)
  function phase(y, m, d) {
    const e = elongation(new Date(Date.UTC(y, m - 1, d, 3)));
    const lit = Math.round((1 - Math.cos(rad(e))) / 2 * 100);
    let name;
    if (e < 12 || e > 348) name = 'новолуние';
    else if (e > 168 && e < 192) name = 'полнолуние';
    else name = e < 180 ? 'растущая' : 'убывающая';
    return { name, lit, elong: e };
  }

  root.Moon = { phase, elongation };
})(typeof window !== 'undefined' ? window : globalThis);
