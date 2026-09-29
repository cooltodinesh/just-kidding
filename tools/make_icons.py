"""Dev-only: generate the app icons (no third-party deps).

  python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "icons")

A_STROKES = ["M60,22 L28,124", "M60,22 L92,124", "M40,94 L80,94"]
BOX_W, BOX_H = 120, 170


def seg_points(d):
    parts = d.replace("M", "").replace("L", " ").split()
    pts = [tuple(float(v) for v in p.split(",")) for p in parts]
    out = []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        n = max(1, int(math.dist(a, b) * 4))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1)]
    return out


def make(size, path):
    px = bytearray(size * size * 3)
    r = size * 0.22  # corner radius

    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * size)
            col = (
                int(124 - 30 * t),
                int(92 + 40 * t),
                int(231 - 20 * t),
            )
            # rounded corners -> white so iOS/Android masking looks clean
            cx = min(max(x, r), size - r)
            cy = min(max(y, r), size - r)
            if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                col = (255, 253, 246)
            o = (y * size + x) * 3
            px[o:o + 3] = bytes(col)

    scale = size * 0.62 / BOX_H
    ox = (size - BOX_W * scale) / 2
    oy = (size - BOX_H * scale) / 2
    width = size * 0.055

    def dot(cx, cy, rad, color):
        for yy in range(max(0, int(cy - rad)), min(size, int(cy + rad) + 1)):
            for xx in range(max(0, int(cx - rad)), min(size, int(cx + rad) + 1)):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= rad * rad:
                    o = (yy * size + xx) * 3
                    px[o:o + 3] = bytes(color)

    for d in A_STROKES:
        for p in seg_points(d):
            dot(ox + p[0] * scale, oy + p[1] * scale, width, (255, 255, 255))

    start = seg_points(A_STROKES[0])[0]
    dot(ox + start[0] * scale, oy + start[1] * scale, width * 0.95, (22, 178, 107))

    rows = b"".join(b"\x00" + bytes(px[y * size * 3:(y + 1) * size * 3]) for y in range(size))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(png)
    print("wrote", path)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in (180, 192, 512):
        make(s, os.path.join(OUT, "icon-%d.png" % s))
