"""Планы посадки по местам: ряды и растения внутри настоящего контура каждого огорода, теплицы, парника.

Запуск:  python scripts/layouts.py
Читает data/zones.json (контуры), data/plan.json (что где в 2027, раздел «посадка»), data/spacing.json (расстояния).
Пишет data/layouts.json — приложение рисует по нему крупный план места.

Система координат плана: ось x — вдоль рядов (по направлению грядок), y — поперёк. Метры.
Полосы культур идут поперёк участка одна за другой, между ними тропинка 0,5 м.
"""
import json
import math
from pathlib import Path

from shapely.geometry import LineString, Polygon
from shapely.affinity import rotate, translate

ROOT = Path(__file__).resolve().parent.parent
J = lambda f: json.loads((ROOT / "data" / f).read_text(encoding="utf-8"))
ZONES = {z["id"]: z for z in J("zones.json")["зоны"]}
GRID = J("zones.json").get("азимут_грядок", 130)
PLAN = J("plan.json")["2027"]["зоны"]
SP = J("spacing.json")["схемы"]
PATH = 0.5      # тропинка между полосами, м
EDGE = 0.3      # отступ рядов от края участка, м


def long_side_az(poly):
    """Азимут длинной стороны — для узких мест (парники, малина) ряды идут вдоль неё."""
    rect = poly.minimum_rotated_rectangle
    c = list(rect.exterior.coords)
    e = max(((c[i], c[i + 1]) for i in range(4)), key=lambda e: math.dist(*e))
    return math.degrees(math.atan2(e[1][0] - e[0][0], e[1][1] - e[0][1])) % 180, rect


def frame_for(poly):
    az, rect = long_side_az(poly)
    c = list(rect.exterior.coords)
    sides = sorted(math.dist(c[i], c[i + 1]) for i in range(4))
    if sides[-1] / max(sides[0], 0.1) < 2.2:     # не узкое место — ряды по направлению грядок
        az = GRID % 180
    return az


def to_local(poly, az):
    """Повернуть так, чтобы ряды (азимут az) шли по оси x. Азимут считается от севера по часовой."""
    ang = az - 90                                  # на сколько повернуть по часовой, чтобы az стал «востоком»
    p = rotate(poly, ang, origin=(0, 0))           # shapely: + против часовой; поворот по часовой на ang
    minx, miny = p.bounds[0], p.bounds[1]
    return translate(p, -minx, -miny), ang, (minx, miny)


def row_extent(P, y, margin):
    """Самый длинный отрезок ряда на высоте y внутри контура, с отступом от краёв."""
    minx, _, maxx, _ = P.bounds
    seg = P.intersection(LineString([(minx - 1, y), (maxx + 1, y)]))
    if seg.is_empty:
        return None
    parts = [seg] if seg.geom_type == "LineString" else [g for g in getattr(seg, "geoms", []) if g.geom_type == "LineString"]
    if not parts:
        return None
    best = max(parts, key=lambda s: s.length)
    x0, x1 = sorted([best.coords[0][0], best.coords[-1][0]])
    x0, x1 = x0 + margin, x1 - margin
    return (x0, x1) if x1 - x0 > 0.2 else None


def plants_in(x0, x1, step):
    n = int((x1 - x0) // step) + 1
    if n < 1:
        return []
    off = (x1 - x0 - (n - 1) * step) / 2           # ряд по центру отрезка
    return [round(x0 + off + k * step, 3) for k in range(n)]


def layout_zone(zid):
    z = ZONES[zid]
    spec = PLAN.get(zid, {}).get("посадка")
    if not spec:
        return None
    poly = Polygon(z["контур_м"])
    az = frame_for(poly)
    if PLAN[zid].get("ряды_поперёк"):            # ряды вдоль короткой стороны — культуры встают полосами по длине
        long_az, _ = long_side_az(poly)
        short = (long_az + 90) % 180
        az = min((GRID % 180, (GRID - 90) % 180), key=lambda g: min(abs(g - short), 180 - abs(g - short)))
    P, ang, shift = to_local(poly, az)
    W, H = P.bounds[2], P.bounds[3]
    narrow = min(W, H) < 2.5                        # парник, малина — без отступов и тропинок
    glass = z["тип"] == "теплица"                   # в теплице короба вплотную к стенам, проход задан явно
    margin = 0.1 if narrow else 0.05 if glass else EDGE
    gap = 0 if (narrow or glass) else PATH
    y = 0 if (narrow or glass) else margin
    bands = []
    for i, b in enumerate(spec):
        if "проход" in b:
            y += b["проход"]
            continue
        rs = SP[b["схема"]]["ряды"] / 100
        parts = b.get("части") or [dict(b, доля=1)]
        start = y + (rs / 2 if not narrow else 0)
        if narrow and len(spec) == 1:              # в узком месте ряды — по центру ширины
            nfit = b.get("ряды") or max(1, int(H // rs))
            start = (H - (nfit - 1) * rs) / 2
        rows_y = []
        # сколько рядов
        if "ряды" in b:
            rows_y = [start + k * rs for k in range(b["ряды"])]
        elif "растений" in b:
            need, yy, got = b["растений"], start, 0
            while got < need and yy < H:
                ext = row_extent(P, yy, margin)
                if ext:
                    got += len(plants_in(*ext, SP[b["схема"]]["в_ряду"] / 100))
                rows_y.append(yy); yy += rs
        else:
            left = H - margin - y
            height = left if b.get("все") else left * b["доля"]
            n = max(1, int(round(height / rs)))
            rows_y = [start + k * rs for k in range(n)]
        rows_y = [r for r in rows_y if r <= H - (0 if narrow else margin / 2)]
        if not rows_y:
            continue
        out_parts, need_left = [], b.get("растений")
        for part in parts:
            step = SP[part["схема"]]["в_ряду"] / 100
            rows = []
            for ry in rows_y:
                ext = row_extent(P, ry, margin)
                if not ext:
                    continue
                # деление ряда по длине между частями (перцы | баклажаны)
                acc = sum(p["доля"] for p in parts[:parts.index(part)])
                x0 = ext[0] + (ext[1] - ext[0]) * acc + (0.15 if acc > 0 else 0)
                x1 = ext[0] + (ext[1] - ext[0]) * (acc + part["доля"]) - (0.15 if acc + part["доля"] < 1 else 0)
                xs = plants_in(x0, x1, step)
                if need_left is not None:
                    xs = xs[:max(0, need_left)]; need_left -= len(xs)
                if xs:
                    rows.append({"y": round(ry, 3), "x": xs})
            if rows:
                sch = SP[part["схема"]]
                out_parts.append({"культура": part["культура"], "что": part["что"], "схема": part["схема"],
                                  "ряды_см": sch["ряды"], "в_ряду_см": sch["в_ряду"],
                                  "проверено": sch.get("проверено", True),
                                  "рядов": len(rows), "растений": sum(len(r["x"]) for r in rows), "ряды": rows})
        if out_parts:
            y0 = rows_y[0] - rs / 2; y1 = rows_y[-1] + rs / 2
            bands.append({"y0": round(max(0, y0), 3), "y1": round(min(H, y1), 3), "части": out_parts})
        y = rows_y[-1] + rs / 2 + gap
    return {"название": z["название"], "азимут_рядов": round(az), "поворот": round(ang, 2), "сдвиг": [round(v, 3) for v in shift],
            "ширина_м": round(W, 2), "длина_м": round(H, 2),
            "контур": [[round(x, 3), round(yv, 3)] for x, yv in list(P.exterior.coords)[:-1]], "полосы": bands}


out = {"_описание": "Планы посадки по местам (2027). Генерируется scripts/layouts.py — руками не править.", "места": {}}
for zid in ZONES:
    L = layout_zone(zid)
    if L:
        out["места"][zid] = L
        total = ", ".join(f"{p['что'].split(' (')[0]} {p['растений']}" for b in L["полосы"] for p in b["части"])
        print(f"{L['название']}: {total}")
(ROOT / "data" / "layouts.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
