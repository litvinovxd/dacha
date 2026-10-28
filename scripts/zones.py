"""Зоны участка: контуры по снимку, расчёт солнца/тени, схема.

Запуск:  python scripts/zones.py
Читает data/zones_src.json (контуры в пикселях снимка materials/uchastok.png и деревья),
пишет data/zones.json (метры, площади, часы солнца) и materials/skhema.svg + materials/skhema.png.
"""
import json
import math
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = json.loads((ROOT / "data" / "zones_src.json").read_text(encoding="utf-8"))
LAT, LON, TZ = 52.4504, 130.8998, 9
PX_PER_M = SRC["пикселей_на_метр"]
OX, OY = SRC["начало_координат_px"]


def to_m(px, py):
    """Пиксели снимка -> метры (x на восток, y на север)."""
    return ((px - OX) / PX_PER_M, (OY - py) / PX_PER_M)


def rect(cx, cy, length, width, azimuth):
    """Прямоугольник по центру (px), размерам (м) и направлению длинной стороны (азимут, °)."""
    x0, y0 = to_m(cx, cy)
    a = math.radians(azimuth)
    ux, uy = math.sin(a), math.cos(a)        # вдоль длинной стороны
    vx, vy = uy, -ux                          # поперёк
    pts = []
    for sl, sw in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
        pts.append((x0 + sl * ux * length / 2 + sw * vx * width / 2, y0 + sl * uy * length / 2 + sw * vy * width / 2))
    return pts


def area(poly):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]))) / 2


def inside(pt, poly):
    x, y = pt
    res = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            res = not res
    return res


def sun(dt):
    """Высота и азимут солнца (°) по местному времени — упрощённый алгоритм NOAA."""
    n = dt.timetuple().tm_yday
    g = 2 * math.pi / 365 * (n - 1 + (dt.hour - 12 - TZ + dt.minute / 60) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = dt.hour * 60 + dt.minute + eqt + 4 * LON - 60 * TZ
    ha = math.radians(tst / 4 - 180)
    lat = math.radians(LAT)
    cos_z = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1, min(1, cos_z)))
    az = math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(lat) - math.tan(decl) * math.cos(lat))) + 180
    return 90 - math.degrees(zen), az % 360


TREES = [(*to_m(t["px"], t["py"]), t["радиус_px"] / PX_PER_M, t.get("высота_м", SRC["высота_деревьев_м"]))
         for t in SRC["деревья"]]


def shaded(pt, elev, az):
    """Попадает ли точка в тень какого-нибудь дерева (крона как цилиндр)."""
    if elev <= 0:
        return True
    a = math.radians(az)
    dx, dy = math.sin(a), math.cos(a)  # направление на солнце
    for tx, ty, r, h in TREES:
        rx, ry = tx - pt[0], ty - pt[1]
        along = rx * dx + ry * dy
        if along <= 0:
            continue
        across = abs(rx * dy - ry * dx)
        if across < r and along - r < h / math.tan(math.radians(elev)):
            return True
    return False


MONTHS = {"апрель": 4, "май": 5, "июнь": 6, "июль": 7, "август": 8, "сентябрь": 9}


def sun_hours(poly):
    """Среднее по зоне число часов прямого солнца в день (15-е число месяца), солнце выше 5°."""
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    pts = []
    step = max(0.7, min(max(xs) - min(xs), max(ys) - min(ys)) / 6)
    y = min(ys)
    while y <= max(ys):
        x = min(xs)
        while x <= max(xs):
            if inside((x, y), poly):
                pts.append((x, y))
            x += step
        y += step
    if not pts:
        pts = [(sum(xs) / len(xs), sum(ys) / len(ys))]
    out = {}
    for name, m in MONTHS.items():
        t = datetime(2026, m, 15, 3, 0)
        lit = 0
        while t.hour < 22:
            elev, az = sun(t)
            if elev > 5:
                lit += sum(not shaded(p, elev, az) for p in pts) / len(pts)
            t += timedelta(minutes=10)
        out[name] = round(lit / 6, 1)
    return out


def grade(h):
    if h >= 7:
        return "солнце"
    if h >= 4.5:
        return "полутень"
    return "тень"


zones = []
for z in SRC["зоны"]:
    if "контур_px" in z:
        poly = [to_m(*p) for p in z["контур_px"]]
    else:
        poly = rect(*z["центр_px"], z["длина_м"], z["ширина_м"], z.get("азимут", SRC["азимут_грядок"]))
    hours = sun_hours(poly) if z["тип"] not in ("дом", "постройка") else None
    zones.append({
        "id": z["id"], "название": z["название"], "тип": z["тип"],
        "размер": z.get("размер") or (f'{z["длина_м"]} × {z["ширина_м"]} м' if "длина_м" in z else None),
        "площадь_м2": round(area(poly), 1),
        "контур_м": [[round(x, 2), round(y, 2)] for x, y in poly],
        "солнце_часов_в_день": hours,
        "освещённость": grade(hours["июнь"]) if hours else None,
        "откуда_размер": z.get("откуда_размер", "оценка по снимку"),
        "история": z.get("история", {}),
        "заметки": z.get("заметки", ""),
        "проверено": z.get("проверено", False),
    })

(ROOT / "data" / "zones.json").write_text(json.dumps({
    "_описание": "Зоны участка. Контуры в метрах (x — на восток, y — на север, 0 — условная точка в центре участка). "
                 "Часы солнца — расчёт тени от деревьев по положению солнца на 15-е число месяца; высота деревьев — допущение. "
                 "Генерируется scripts/zones.py из data/zones_src.json; историю посадок править в zones_src.json.",
    "высота_деревьев_м_допущение": SRC["высота_деревьев_м"],
    "зоны": zones,
    "деревья_м": [[round(x, 1), round(y, 1), round(r, 1)] for x, y, r, _ in TREES],
}, ensure_ascii=False, indent=1), encoding="utf-8")

# --- Схема ---
COLORS = {"солнце": "#f6d743", "полутень": "#9fc97a", "тень": "#5f8f6b", None: "#d9d4cc"}
TYPE_FILL = {"дом": "#c0504d", "постройка": "#b9b2a6"}
BORDER = [to_m(*p) for p in SRC["граница_px"]]
allx = [p[0] for p in BORDER]
ally = [p[1] for p in BORDER]
minx, maxx, miny, maxy = min(allx) - 2, max(allx) + 2, min(ally) - 2, max(ally) + 2
S = 22  # пикселей схемы на метр
W, H = int((maxx - minx) * S), int((maxy - miny) * S)


def sx(x):
    return (x - minx) * S


def sy(y):
    return (maxy - y) * S


svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="sans-serif">',
       f'<rect width="{W}" height="{H}" fill="#f4f1ea"/>',
       '<polygon points="' + " ".join(f"{sx(x):.0f},{sy(y):.0f}" for x, y in BORDER)
       + '" fill="#e8e2d4" stroke="#7a6f5c" stroke-width="3" stroke-dasharray="12 8"/>']
for x, y, r, _ in TREES:
    svg.append(f'<circle cx="{sx(x):.0f}" cy="{sy(y):.0f}" r="{r * S:.0f}" fill="#2f5d3a" opacity="0.35"/>')
for z in zones:
    pts = " ".join(f"{sx(x):.0f},{sy(y):.0f}" for x, y in z["контур_м"])
    fill = TYPE_FILL.get(z["тип"], COLORS[z["освещённость"]])
    svg.append(f'<polygon points="{pts}" fill="{fill}" stroke="#333" stroke-width="2"/>')
for z in zones:
    cx = sum(sx(p[0]) for p in z["контур_м"]) / len(z["контур_м"])
    cy = sum(sy(p[1]) for p in z["контур_м"]) / len(z["контур_м"])
    svg.append(f'<text x="{cx:.0f}" y="{cy:.0f}" font-size="22" text-anchor="middle" fill="#111" '
               f'stroke="#fff" stroke-width="5" paint-order="stroke">{z["название"]}</text>')
svg.append(f'<text x="{W - 40}" y="50" font-size="30" text-anchor="middle">С ↑</text>')
svg.append("</svg>")
(ROOT / "materials" / "skhema.svg").write_text("\n".join(svg), encoding="utf-8")

try:  # картинка для проверки (нужен Pillow)
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGB", (W, H), "#f4f1ea")
    d = ImageDraw.Draw(im, "RGBA")
    font = ImageFont.truetype("arial.ttf", 18)
    d.polygon([(sx(x), sy(y)) for x, y in BORDER], fill="#e8e2d4", outline="#7a6f5c")
    for x, y, r, _ in TREES:
        d.ellipse([sx(x) - r * S, sy(y) - r * S, sx(x) + r * S, sy(y) + r * S], fill=(47, 93, 58, 90))
    for z in zones:
        fill = TYPE_FILL.get(z["тип"], COLORS[z["освещённость"]])
        d.polygon([(sx(x), sy(y)) for x, y in z["контур_м"]], fill=fill, outline="#333")
    for i, z in enumerate(zones):
        cx = sum(sx(p[0]) for p in z["контур_м"]) / len(z["контур_м"])
        cy = sum(sy(p[1]) for p in z["контур_м"]) / len(z["контур_м"])
        d.text((cx, cy), str(i + 1), fill="#000", font=font, anchor="mm", stroke_width=3, stroke_fill="#fff")
    im.save(ROOT / "materials" / "skhema.png")
except ImportError:
    pass

for i, z in enumerate(zones):
    print(i + 1, z["название"], z["площадь_м2"], "м²", z["освещённость"], z["солнце_часов_в_день"])
