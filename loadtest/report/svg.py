"""Tiny dependency-free SVG line chart (latency vs tier, log-log)."""
from __future__ import annotations

import math
from html import escape

PALETTE = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#4b5563"]


def line_chart(title: str, series: dict[str, list[tuple[float, float]]], y_label: str = "p95 latency (ms)",
               width: int = 760, height: int = 420, hlines: list[tuple[float, str]] | None = None) -> str:
    pts = [(x, y) for s in series.values() for x, y in s if x and y]
    if not pts:
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="60"><text x="10" y="30">{escape(title)}: no data</text></svg>'
    ml, mr, mt, mb = 70, 170, 40, 50
    xs = [math.log10(x) for x, _ in pts]
    ys = [math.log10(max(y, 1)) for _, y in pts] + [math.log10(v) for v, _ in (hlines or []) if v > 0]
    x0, x1 = min(xs), max(xs) if max(xs) > min(xs) else min(xs) + 1
    y0, y1 = math.floor(min(ys)), math.ceil(max(ys)) if math.ceil(max(ys)) > math.floor(min(ys)) else math.floor(min(ys)) + 1

    def px(x):
        return ml + (math.log10(x) - x0) / (x1 - x0) * (width - ml - mr)

    def py(y):
        return height - mb - (math.log10(max(y, 1)) - y0) / (y1 - y0) * (height - mt - mb)

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" font-family="sans-serif" font-size="11">',
           f'<rect width="100%" height="100%" fill="white"/>',
           f'<text x="{ml}" y="22" font-size="14" font-weight="bold">{escape(title)}</text>']
    for e in range(int(y0), int(y1) + 1):
        y = height - mb - (e - y0) / (y1 - y0) * (height - mt - mb)
        out.append(f'<line x1="{ml}" x2="{width - mr}" y1="{y:.1f}" y2="{y:.1f}" stroke="#e5e7eb"/>')
        out.append(f'<text x="{ml - 6}" y="{y + 4:.1f}" text-anchor="end">{10 ** e:g}</text>')
    tiers = sorted({x for x, _ in pts})
    for t in tiers:
        x = px(t)
        out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{mt}" y2="{height - mb}" stroke="#f3f4f6"/>')
        out.append(f'<text x="{x:.1f}" y="{height - mb + 16}" text-anchor="middle">{t / 1000:g}K</text>' if t >= 1000
                   else f'<text x="{x:.1f}" y="{height - mb + 16}" text-anchor="middle">{t:g}</text>')
    out.append(f'<text x="{(ml + width - mr) / 2}" y="{height - 12}" text-anchor="middle">tier (tenders, log scale)</text>')
    out.append(f'<text transform="translate(16,{(mt + height - mb) / 2}) rotate(-90)" text-anchor="middle">{escape(y_label)}</text>')
    for v, label in hlines or []:
        y = py(v)
        out.append(f'<line x1="{ml}" x2="{width - mr}" y1="{y:.1f}" y2="{y:.1f}" stroke="#9ca3af" stroke-dasharray="4 3"/>')
        out.append(f'<text x="{width - mr + 4}" y="{y + 4:.1f}" fill="#6b7280">{escape(label)}</text>')
    for i, (name, s) in enumerate(sorted(series.items())):
        c = PALETTE[i % len(PALETTE)]
        s = sorted((x, y) for x, y in s if x and y)
        if not s:
            continue
        out.append('<polyline fill="none" stroke="{}" stroke-width="2" points="{}"/>'.format(c, " ".join(f"{px(x):.1f},{py(y):.1f}" for x, y in s)))
        for x, y in s:
            out.append(f'<circle cx="{px(x):.1f}" cy="{py(y):.1f}" r="3" fill="{c}"/>')
        ly = mt + 14 * i
        out.append(f'<rect x="{width - mr + 10}" y="{ly}" width="10" height="10" fill="{c}"/>')
        out.append(f'<text x="{width - mr + 24}" y="{ly + 9}">{escape(name)}</text>')
    out.append("</svg>")
    return "\n".join(out)
