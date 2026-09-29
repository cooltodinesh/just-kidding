"""Dev-only: render every letter's stroke data to a PNG contact sheet so the
shapes, stroke order and direction can be eyeballed. Not part of the app.

Usage:
  jsc tools/dump_letters.js > /tmp/letters.json
  python3 tools/render_check.py /tmp/letters.json /tmp/upper.png upper
"""
import json
import math
import struct
import sys
import zlib

STROKE_COLORS = [(41, 98, 255), (0, 170, 110), (240, 120, 40), (150, 60, 200)]


def tokenize(d):
    out, num = [], ""
    for c in d:
        if c in "MLA":
            if num:
                out.append(float(num))
                num = ""
            out.append(c)
        elif c in " ,":
            if num:
                out.append(float(num))
                num = ""
        elif c == "-" and num and num[-1] not in "eE":
            out.append(float(num))
            num = "-"
        else:
            num += c
    if num:
        out.append(float(num))
    return out


def arc_points(x0, y0, rx, ry, laf, sf, x1, y1, step=1.0):
    """Endpoint -> center parameterisation (SVG spec F.6.5), rotation 0."""
    if rx == 0 or ry == 0 or (x0 == x1 and y0 == y1):
        return [(x1, y1)]
    dx2, dy2 = (x0 - x1) / 2.0, (y0 - y1) / 2.0
    rx, ry = abs(rx), abs(ry)
    lam = dx2 * dx2 / (rx * rx) + dy2 * dy2 / (ry * ry)
    if lam > 1:
        s = math.sqrt(lam)
        rx, ry = rx * s, ry * s
    num = rx * rx * ry * ry - rx * rx * dy2 * dy2 - ry * ry * dx2 * dx2
    den = rx * rx * dy2 * dy2 + ry * ry * dx2 * dx2
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if laf == sf:
        co = -co
    cx = co * rx * dy2 / ry + (x0 + x1) / 2.0
    cy = -co * ry * dx2 / rx + (y0 + y1) / 2.0
    t0 = math.atan2((y0 - cy) / ry, (x0 - cx) / rx)
    t1 = math.atan2((y1 - cy) / ry, (x1 - cx) / rx)
    dt = t1 - t0
    if sf and dt < 0:
        dt += 2 * math.pi
    if not sf and dt > 0:
        dt -= 2 * math.pi
    n = max(2, int(abs(dt) * max(rx, ry) / step))
    return [
        (cx + rx * math.cos(t0 + dt * k / n), cy + ry * math.sin(t0 + dt * k / n))
        for k in range(1, n + 1)
    ]


def path_points(d):
    t = tokenize(d)
    pts, i, cur, cmd = [], 0, (0.0, 0.0), None
    while i < len(t):
        if isinstance(t[i], str):
            cmd = t[i]
            i += 1
            continue
        if cmd == "M":
            cur = (t[i], t[i + 1])
            pts.append(cur)
            i += 2
            cmd = "L"
        elif cmd == "L":
            nxt = (t[i], t[i + 1])
            steps = max(1, int(math.dist(cur, nxt)))
            pts += [
                (cur[0] + (nxt[0] - cur[0]) * k / steps, cur[1] + (nxt[1] - cur[1]) * k / steps)
                for k in range(1, steps + 1)
            ]
            cur = nxt
            i += 2
        elif cmd == "A":
            rx, ry, _rot, laf, sf, x, y = t[i:i + 7]
            pts += arc_points(cur[0], cur[1], rx, ry, int(laf), int(sf), x, y)
            cur = (x, y)
            i += 7
        else:
            raise ValueError("unsupported command %r in %r" % (cmd, d))
    return pts


class Canvas:
    def __init__(self, w, h, bg=(255, 253, 246)):
        self.w, self.h = w, h
        self.px = bytearray(bytes(bg) * (w * h))

    def dot(self, x, y, r, color):
        for yy in range(max(0, int(y - r)), min(self.h, int(y + r) + 1)):
            for xx in range(max(0, int(x - r)), min(self.w, int(x + r) + 1)):
                if (xx - x) ** 2 + (yy - y) ** 2 <= r * r:
                    o = (yy * self.w + xx) * 3
                    self.px[o:o + 3] = bytes(color)

    def polyline(self, pts, r, color):
        for p in pts:
            self.dot(p[0], p[1], r, color)

    def hline(self, y, x0, x1, color):
        y = int(y)
        if 0 <= y < self.h:
            for xx in range(max(0, int(x0)), min(self.w, int(x1))):
                o = (y * self.w + xx) * 3
                self.px[o:o + 3] = bytes(color)

    def save(self, path):
        rows = b"".join(
            b"\x00" + bytes(self.px[y * self.w * 3:(y + 1) * self.w * 3]) for y in range(self.h)
        )

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        png = (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 6))
            + chunk(b"IEND", b"")
        )
        with open(path, "wb") as fh:
            fh.write(png)


def main(src, out, which):
    data = json.load(open(src))
    box, guides = data["box"], data["guides"]
    letters = [(k, v) for k, v in data["letters"].items() if k.startswith(which[0] + ":")]
    cols, cell = 7, 140
    rows = math.ceil(len(letters) / cols)
    scale = cell / box["h"]
    cv = Canvas(cols * cell, rows * cell)

    for idx, (_key, strokes) in enumerate(letters):
        ox = (idx % cols) * cell + (cell - box["w"] * scale) / 2
        oy = (idx // cols) * cell
        for gy in (guides["cap"], guides["mid"], guides["base"], guides["desc"]):
            cv.hline(oy + gy * scale, ox, ox + box["w"] * scale, (205, 218, 230))
        for si, d in enumerate(strokes):
            color = STROKE_COLORS[si % len(STROKE_COLORS)]
            if d.startswith("DOT"):
                _, x, y = d.split()
                cv.dot(ox + float(x) * scale, oy + float(y) * scale, 5, color)
                continue
            pts = [(ox + p[0] * scale, oy + p[1] * scale) for p in path_points(d)]
            cv.polyline(pts, 4.2, color)
            cv.dot(pts[0][0], pts[0][1], 4.5, (230, 30, 30))   # start = red
            cv.dot(pts[-1][0], pts[-1][1], 3.0, (20, 20, 20))  # end = black
            mid = pts[len(pts) // 3]
            cv.dot(mid[0], mid[1], 3.0, (255, 200, 0))         # 1/3 along = gold
    cv.save(out)
    print("wrote", out, cv.w, "x", cv.h, len(letters), "letters")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
