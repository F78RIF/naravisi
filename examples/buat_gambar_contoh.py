"""Menggambar ulang dua gambar PNG contoh di examples/gambar/ dengan kode (Pillow), tanpa mengunduh apa pun.

    python -I examples/buat_gambar_contoh.py

Hasil:
- gambar/foto-pantai.png  : "foto" pemandangan pantai saat senja (gradien langit, matahari, laut, bukit, perahu)
- gambar/grafik-garis.png : grafik garis suhu harian tiruan (data contoh, bukan data nyata)

Gambar SVG di folder yang sama ditulis tangan. Semua gambar contoh berlisensi MIT seperti proyek ini.
Pillow sudah ada di ai-service/requirements.txt, jadi skrip ini bisa dijalankan dengan venv ai-service.
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path(__file__).resolve().parent / "gambar"


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def foto_pantai(w: int = 640, h: int = 400) -> Image.Image:
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    horizon = int(h * 0.58)
    for y in range(horizon):  # langit: ungu tua → jingga
        d.line([(0, y), (w, y)], fill=lerp((58, 40, 110), (250, 150, 70), y / horizon))
    d.ellipse([w * 0.58, horizon - 70, w * 0.58 + 120, horizon + 50], fill=(255, 214, 120))  # matahari
    for y in range(horizon, h):  # laut: biru kehijauan, makin gelap ke bawah
        d.line([(0, y), (w, y)], fill=lerp((60, 110, 150), (15, 45, 80), (y - horizon) / (h - horizon)))
    for i in range(10):  # pantulan matahari di air
        y = horizon + 8 + i * 9
        half = 50 - i * 4
        d.line([(w * 0.58 + 60 - half, y), (w * 0.58 + 60 + half, y)], fill=(255, 200, 110), width=3)
    d.polygon([(0, horizon), (0, horizon - 90), (90, horizon - 130), (200, horizon - 70), (260, horizon)], fill=(40, 60, 50))  # bukit
    d.polygon([(0, h), (0, h - 60), (220, h - 90), (420, h - 40), (w, h - 70), (w, h)], fill=(214, 180, 120))  # pasir
    d.polygon([(380, horizon + 40), (460, horizon + 40), (445, horizon + 55), (395, horizon + 55)], fill=(30, 25, 30))  # perahu
    d.line([(420, horizon + 40), (420, horizon + 5)], fill=(30, 25, 30), width=3)
    d.polygon([(422, horizon + 8), (422, horizon + 36), (450, horizon + 36)], fill=(240, 235, 220))
    return img


def grafik_garis(w: int = 640, h: int = 360) -> Image.Image:
    suhu = [29, 30, 32, 33, 31, 34, 35]  # data tiruan
    hari = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
    img = Image.new("RGB", (w, h), (252, 252, 251))
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=16)
    left, right, top, bottom = 70, w - 30, 50, h - 50
    d.text((left, 14), "Contoh: suhu siang tertinggi (°C), data tiruan", fill=(11, 11, 11), font=font)
    lo, hi = 26, 36
    for v in range(lo, hi + 1, 2):  # garis bantu
        y = bottom - (v - lo) / (hi - lo) * (bottom - top)
        d.line([(left, y), (right, y)], fill=(226, 225, 220), width=1)
        d.text((left - 34, y - 9), str(v), fill=(82, 81, 78), font=font)
    step = (right - left) / (len(suhu) - 1)
    pts = [(left + i * step, bottom - (v - lo) / (hi - lo) * (bottom - top)) for i, v in enumerate(suhu)]
    d.line(pts, fill=(42, 120, 214), width=3)
    for (x, y), label in zip(pts, hari):
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(42, 120, 214), outline=(252, 252, 251), width=2)
        d.text((x - 14, bottom + 12), label, fill=(82, 81, 78), font=font)
    x, y = pts[-1]
    d.text((x - 40, y - 28), f"{suhu[-1]} °C", fill=(11, 11, 11), font=font)
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    foto_pantai().save(OUT / "foto-pantai.png", optimize=True)
    grafik_garis().save(OUT / "grafik-garis.png", optimize=True)
    for name in ("foto-pantai.png", "grafik-garis.png"):
        print(f"ditulis: examples/gambar/{name} ({(OUT / name).stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
