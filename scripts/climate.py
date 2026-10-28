"""Анализ климата участка по архиву Open-Meteo.

Запуск:  python scripts/climate.py
Результат: data/climate.json (данные для приложения).
Сырые данные кэшируются в scripts/cache/, чтобы не качать повторно.
"""
import json
import statistics
import urllib.request
from datetime import date, timedelta
from pathlib import Path

LAT, LON = 52.4504, 130.8998
TZ = "Asia/Yakutsk"  # UTC+9, как в Амурской области
FIRST_YEAR, LAST_YEAR = 1991, 2025
MAIN_FROM = 2006  # основные выводы — по последним 20 годам

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / "cache"
API = "https://archive-api.open-meteo.com/v1/archive"


def fetch(model, variables):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{model}_{FIRST_YEAR}_{LAST_YEAR}.json"
    if not path.exists():
        url = (f"{API}?latitude={LAT}&longitude={LON}"
               f"&start_date={FIRST_YEAR}-01-01&end_date={LAST_YEAR}-12-31"
               f"&daily={','.join(variables)}&timezone={TZ.replace('/', '%2F')}&models={model}")
        with urllib.request.urlopen(url, timeout=300) as r:
            path.write_bytes(r.read())
    return json.loads(path.read_text(encoding="utf-8"))


land = fetch("era5_land", ["temperature_2m_min", "temperature_2m_max",
                           "soil_temperature_0_to_7cm_mean", "soil_temperature_7_to_28cm_mean",
                           "snow_depth_mean"])
era5 = fetch("era5", ["precipitation_sum", "snowfall_sum"])

# Сводим всё в словарь: дата -> показатели
days = {}
for i, t in enumerate(land["daily"]["time"]):
    d = land["daily"]
    days[date.fromisoformat(t)] = {
        "tmin": d["temperature_2m_min"][i], "tmax": d["temperature_2m_max"][i],
        "soil7": d["soil_temperature_0_to_7cm_mean"][i], "soil28": d["soil_temperature_7_to_28cm_mean"][i],
        "snow": d["snow_depth_mean"][i],
    }
for i, t in enumerate(era5["daily"]["time"]):
    days[date.fromisoformat(t)]["rain"] = era5["daily"]["precipitation_sum"][i]

# --- Поправка по метеостанции ---
# Сетка сглаживает рельеф и не видит ночного выхолаживания в долинах, поэтому
# ночи по ней теплее реальных. Берём станцию Норск (та же долина Селемджи, 67 км),
# считаем по месяцам среднюю разницу «станция − сетка в точке станции»
# и прибавляем её к данным участка.
STATION = {"id": "RSM00031388", "название": "Норск", "lat": 52.35, "lon": 129.9167}
BIAS_YEARS = (2006, LAST_YEAR)


def station_daily():
    path = CACHE / f"{STATION['id']}.dly"
    if not path.exists():
        url = f"https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/{STATION['id']}.dly"
        with urllib.request.urlopen(url, timeout=300) as r:
            path.write_bytes(r.read())
    data = {"TMIN": {}, "TMAX": {}}
    for line in path.read_text().splitlines():
        el, y, m = line[17:21], int(line[11:15]), int(line[15:17])
        if el not in data or not BIAS_YEARS[0] <= y <= BIAS_YEARS[1]:
            continue
        for i in range(31):
            v, q = int(line[21 + i * 8:26 + i * 8]), line[27 + i * 8]
            if v == -9999 or q != " ":  # пропуск или значение, не прошедшее контроль качества
                continue
            try:
                data[el][date(y, m, i + 1)] = v / 10
            except ValueError:
                pass
    return data


def station_grid():
    path = CACHE / f"grid_at_{STATION['id']}.json"
    if not path.exists():
        url = (f"{API}?latitude={STATION['lat']}&longitude={STATION['lon']}"
               f"&start_date={BIAS_YEARS[0]}-01-01&end_date={BIAS_YEARS[1]}-12-31"
               f"&daily=temperature_2m_min,temperature_2m_max&timezone={TZ.replace('/', '%2F')}&models=era5_land")
        with urllib.request.urlopen(url, timeout=300) as r:
            path.write_bytes(r.read())
    d = json.loads(path.read_text(encoding="utf-8"))["daily"]
    t = [date.fromisoformat(x) for x in d["time"]]
    return {"TMIN": dict(zip(t, d["temperature_2m_min"])), "TMAX": dict(zip(t, d["temperature_2m_max"]))}


st, gr = station_daily(), station_grid()
bias = {"TMIN": {}, "TMAX": {}}
for el in bias:
    for m in range(1, 13):
        pairs = [(st[el][d], gr[el][d]) for d in st[el] if d.month == m and gr[el].get(d) is not None]
        bias[el][m] = round(statistics.mean(a - b for a, b in pairs), 1)

for d, v in days.items():
    v["tmin_grid"], v["tmax_grid"] = v["tmin"], v["tmax"]
    v["tmin"] = v["tmin"] + bias["TMIN"][d.month]
    v["tmax"] = v["tmax"] + bias["TMAX"][d.month]

YEARS = range(FIRST_YEAR, LAST_YEAR + 1)


def doy(d):
    """День года в «невисокосном» календаре, чтобы даты разных лет были сравнимы."""
    day = min(d.day, 28) if d.month == 2 else d.day  # 29 февраля считаем как 28-е
    return (date(2001, d.month, day) - date(2001, 1, 1)).days + 1


def fmt(n):
    """Номер дня года -> «5 июня»."""
    months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
              "августа", "сентября", "октября", "ноября", "декабря"]
    d = date(2001, 1, 1) + timedelta(days=round(n) - 1)
    return f"{d.day} {months[d.month - 1]}"


def pct(values, p):
    """Процентиль по порядку (p от 0 до 100)."""
    s = sorted(values)
    k = (len(s) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def season_days(year, m1, d1, m2, d2):
    d, end = date(year, m1, d1), date(year, m2, d2)
    while d <= end:
        if d in days:
            yield d
        d += timedelta(days=1)


def last_spring_frost(year, thr):
    hits = [d for d in season_days(year, 1, 1, 7, 31) if days[d]["tmin"] <= thr]
    return doy(hits[-1]) if hits else None


def first_autumn_frost(year, thr):
    hits = [d for d in season_days(year, 8, 1, 12, 31) if days[d]["tmin"] <= thr]
    return doy(hits[0]) if hits else None


def soil_warm(year, key, thr):
    """Первый день весны, начиная с которого 5 дней подряд почва не холоднее порога."""
    ds = list(season_days(year, 3, 1, 7, 31))
    for i in range(len(ds) - 4):
        if all(days[x][key] >= thr for x in ds[i:i + 5]):
            return doy(ds[i])
    return None


def active_temp_sum(year):
    total = 0.0
    for d in season_days(year, 1, 1, 12, 31):
        mean = (days[d]["tmin"] + days[d]["tmax"]) / 2
        if mean > 10:
            total += mean
    return total


def snow_cover(year):
    """Устойчивый снег: ≥2 см 10 дней подряд. Возвращает (сход весной, установление осенью)."""
    spring = list(season_days(year, 2, 1, 6, 30))
    melt = None
    for i in range(len(spring) - 9):
        if all((days[x]["snow"] or 0) < 0.02 for x in spring[i:i + 10]):
            melt = doy(spring[i])
            break
    autumn = list(season_days(year, 8, 1, 12, 31))
    onset = None
    for i in range(len(autumn) - 9):
        if all((days[x]["snow"] or 0) >= 0.02 for x in autumn[i:i + 10]):
            onset = doy(autumn[i])
            break
    return melt, onset


def date_stats(values, early_is_risky):
    """Сводка по датам. Для весенних заморозков риск — поздняя дата, для осенних — ранняя."""
    v = [x for x in values if x is not None]
    if early_is_risky:
        r = {"медиана": pct(v, 50), "8_из_10_лет_позже": pct(v, 20),
             "9_из_10_лет_позже": pct(v, 10), "самый_ранний": min(v)}
    else:
        r = {"медиана": pct(v, 50), "8_из_10_лет_раньше": pct(v, 80),
             "9_из_10_лет_раньше": pct(v, 90), "самый_поздний": max(v)}
    out = {k: {"день_года": round(x), "дата": fmt(x)} for k, x in r.items()}
    out["лет_с_данными"] = len(v)
    return out


def analyze(years):
    res = {}
    for thr in (0, -2):
        spring = [last_spring_frost(y, thr) for y in years]
        autumn = [first_autumn_frost(y, thr) for y in years]
        free = [a - s - 1 for s, a in zip(spring, autumn) if s and a]
        res[f"заморозок_{thr}"] = {
            "последний_весной": date_stats(spring, early_is_risky=False),
            "первый_осенью": date_stats(autumn, early_is_risky=True),
            "безморозный_период_дней": {"медиана": round(pct(free, 50)),
                                        "в_8_из_10_лет_не_меньше": round(pct(free, 20)),
                                        "самый_короткий": min(free)},
        }
    res["почва"] = {}
    for key, depth in (("soil7", "0-7 см"), ("soil28", "7-28 см")):
        for thr in (8, 10):
            res["почва"][f"{depth}_прогрев_до_{thr}"] = date_stats(
                [soil_warm(y, key, thr) for y in years], early_is_risky=False)
    sums = [active_temp_sum(y) for y in years]
    res["сумма_активных_температур"] = {"медиана": round(pct(sums, 50)),
                                        "в_8_из_10_лет_не_меньше": round(pct(sums, 20)),
                                        "минимум": round(min(sums)), "максимум": round(max(sums))}
    melts, onsets = zip(*[snow_cover(y) for y in years])
    res["снег"] = {"сход": date_stats(melts, early_is_risky=False),
                   "установление": date_stats(onsets, early_is_risky=True)}
    return res


def monthly(years):
    """Средние по месяцам."""
    out = []
    names = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
    for m in range(1, 13):
        ds = [d for d in days if d.year in years and d.month == m]
        n_years = len(years)
        out.append({
            "месяц": names[m - 1],
            "средний_минимум": round(statistics.mean(days[d]["tmin"] for d in ds), 1),
            "средний_максимум": round(statistics.mean(days[d]["tmax"] for d in ds), 1),
            "осадки_мм": round(sum(days[d]["rain"] for d in ds) / n_years),
            "жарких_дней_28": round(sum(days[d]["tmax"] >= 28 for d in ds) / n_years, 1),
            "жарких_дней_30": round(sum(days[d]["tmax"] >= 30 for d in ds) / n_years, 1),
            "морозных_ночей_0": round(sum(days[d]["tmin"] <= 0 for d in ds) / n_years, 1),
        })
    return out


def weekly(years):
    """Сезон по неделям (апрель–октябрь): осадки и риск фитофторы."""
    out = []
    start = doy(date(2001, 4, 1))
    n_years = len(years)
    for w in range(31):
        lo, hi = start + w * 7, start + w * 7 + 6
        rain, rainy_days, hot, blight_years = 0.0, 0, 0, 0
        for y in years:
            ds = [d for d in season_days(y, 1, 1, 12, 31) if lo <= doy(d) <= hi]
            rain += sum(days[d]["rain"] for d in ds)
            rainy_days += sum(days[d]["rain"] >= 1 for d in ds)
            hot += sum(days[d]["tmax"] >= 28 for d in ds)
            # Фитофтора любит сырость и прохладные ночи: 3+ дождливых дня (≥1 мм)
            # подряд при ночной температуре не выше +14 °C (упрощённый признак).
            run = 0
            for d in ds:
                run = run + 1 if days[d]["rain"] >= 1 and days[d]["tmin"] <= 14 else 0
                if run >= 3:
                    blight_years += 1
                    break
        out.append({
            "неделя_с": fmt(lo), "неделя_по": fmt(hi), "день_года_с": lo,
            "осадки_мм": round(rain / n_years, 1),
            "дождливых_дней": round(rainy_days / n_years, 1),
            "жарких_дней_28": round(hot / n_years, 1),
            "риск_фитофторы_доля_лет": round(blight_years / n_years, 2),
        })
    return out


main_years = list(range(MAIN_FROM, LAST_YEAR + 1))
all_years = list(YEARS)

per_year = []
for y in all_years:
    melt, onset = snow_cover(y)
    s0, a0 = last_spring_frost(y, 0), first_autumn_frost(y, 0)
    per_year.append({
        "год": y,
        "последний_заморозок_0": fmt(s0) if s0 else None,
        "первый_заморозок_0": fmt(a0) if a0 else None,
        "безморозных_дней": a0 - s0 - 1 if s0 and a0 else None,
        "сумма_активных": round(active_temp_sum(y)),
        "почва_0_7_до_10": fmt(soil_warm(y, "soil7", 10)) if soil_warm(y, "soil7", 10) else None,
    })

def grid_frosts(years):
    """Заморозки по сетке без поправки — для сравнения."""
    for v in days.values():
        v["tmin"], v["tmin_grid"] = v["tmin_grid"], v["tmin"]
    r = {k: v for k, v in analyze(years).items() if k.startswith("заморозок")}
    for v in days.values():
        v["tmin"], v["tmin_grid"] = v["tmin_grid"], v["tmin"]
    return r


result = {
    "_описание": "Климат участка по сеточным данным Open-Meteo (ERA5-Land, ERA5) с поправкой "
                 "температуры воздуха по метеостанции Норск. Почва и снег — без поправки. "
                 "Даты — это дни года без учёта високосных лет. Считается скриптом scripts/climate.py.",
    "источник": {
        "сайт": "https://open-meteo.com/en/docs/historical-weather-api",
        "модели": "ERA5-Land (температура воздуха и почвы, снег), ERA5 (осадки)",
        "координаты": [LAT, LON],
        "ячейка_сетки": [land["latitude"], land["longitude"]],
        "высота_ячейки_м": land["elevation"],
        "станция_для_поправки": {**STATION, "данные": "NOAA GHCN-Daily, "
                                 f"https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/{STATION['id']}.dly",
                                 "годы": f"{BIAS_YEARS[0]}–{BIAS_YEARS[1]}"},
        "поправка_по_месяцам_градусов": {"ночь_минимум": bias["TMIN"], "день_максимум": bias["TMAX"]},
    },
    "без_поправки_по_сетке": grid_frosts(main_years),
    "основной_период": f"{MAIN_FROM}–{LAST_YEAR}",
    "основной": analyze(main_years),
    "весь_период": f"{FIRST_YEAR}–{LAST_YEAR}",
    "все_годы": analyze(all_years),
    "по_месяцам": monthly(main_years),
    "по_неделям": weekly(main_years),
    "по_годам": per_year,
    "уточнения_мамы": {"последний_заморозок": None, "первый_заморозок": None,
                       "_примечание": "Если мама поправит даты, они главнее расчётных."},
}

out = ROOT / "data" / "climate.json"
out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
print("Готово:", out)
