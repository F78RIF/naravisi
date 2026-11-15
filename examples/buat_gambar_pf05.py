"""[PF-05] Menggambar gambar uji deteksi objek lokal di examples/gambar/pf05/ dengan kode (Pillow), tanpa mengunduh apa pun.

    ai-service\\.venv\\Scripts\\python -I examples/buat_gambar_pf05.py

Hasil (semua buatan sendiri, berlisensi MIT seperti proyek ini):
- rambu-stop.png      : rambu STOP merah segi delapan di tiang, latar langit
- jam-dinding.png     : jam dinding bulat dengan angka dan jarum
- lampu-lalu-lintas.png : lampu lalu lintas tiga warna di tiang
- sepeda.png          : sepeda tampak samping (gambar garis)
- parkir-sepeda.png   : dua sepeda dan rambu STOP kecil (contoh penggabungan jumlah)
- polos-krem.png      : bidang krem polos (contoh gambar yang dilewati Mode Baca Berurutan)

Gambar buatan tidak selalu dikenali model seperti foto asli; hasil deteksi yang diharapkan dicatat di
examples/halaman-uji-pf05.html dan docs/PENGUJIAN.md bagian 3d.
"""
from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path(__file__).resolve().parent / "gambar" / "pf05"


def font(size: int) -> ImageFont.ImageFont:
    for name in ("arialbd.ttf", "DejaVuSans-Bold.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def langit(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(round(120 + 80 * t), round(170 + 50 * t), round(225 + 20 * t)))
    d.rectangle([0, int(h * 0.8), w, h], fill=(110, 140, 90))  # rumput
    return img


def rambu_stop(w: int = 480, h: int = 480) -> Image.Image:
    img = langit(w, h)
    d = ImageDraw.Draw(img)
    cx, cy, r = w // 2, int(h * 0.38), 140
    d.rectangle([cx - 9, cy, cx + 9, h], fill=(140, 140, 145))  # tiang
    pts = [(cx + r * math.cos(math.radians(22.5 + 45 * i)), cy + r * math.sin(math.radians(22.5 + 45 * i))) for i in range(8)]
    d.polygon(pts, fill=(255, 255, 255))
    inner = [(cx + (r - 10) * math.cos(math.radians(22.5 + 45 * i)), cy + (r - 10) * math.sin(math.radians(22.5 + 45 * i))) for i in range(8)]
    d.polygon(inner, fill=(200, 16, 30))
    d.text((cx, cy), "STOP", fill=(255, 255, 255), font=font(84), anchor="mm")
    return img


def jam_dinding(w: int = 480, h: int = 480) -> Image.Image:
    img = Image.new("RGB", (w, h), (236, 226, 208))  # dinding
    d = ImageDraw.Draw(img)
    cx, cy, r = w // 2, h // 2, 190
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(40, 40, 40))
    d.ellipse([cx - r + 14, cy - r + 14, cx + r - 14, cy + r - 14], fill=(250, 250, 248))
    for i in range(60):
        a = math.radians(i * 6 - 90)
        r1 = r - 26 if i % 5 else r - 40
        d.line([(cx + r1 * math.cos(a), cy + r1 * math.sin(a)), (cx + (r - 20) * math.cos(a), cy + (r - 20) * math.sin(a))],
               fill=(30, 30, 30), width=2 if i % 5 else 6)
    f = font(34)
    for n in range(1, 13):
        a = math.radians(n * 30 - 90)
        d.text((cx + (r - 68) * math.cos(a), cy + (r - 68) * math.sin(a)), str(n), fill=(20, 20, 20), font=f, anchor="mm")
    for deg, ln, wd in ((300, 95, 10), (60, 140, 6)):  # jarum jam 10, jarum menit 2 → 10.10
        a = math.radians(deg - 90)
        d.line([(cx, cy), (cx + ln * math.cos(a), cy + ln * math.sin(a))], fill=(20, 20, 20), width=wd)
    a = math.radians(200 - 90)
    d.line([(cx, cy), (cx + 150 * math.cos(a), cy + 150 * math.sin(a))], fill=(200, 30, 30), width=2)
    d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=(20, 20, 20))
    return img


def lampu_lalu_lintas(w: int = 360, h: int = 520) -> Image.Image:
    img = langit(w, h)
    d = ImageDraw.Draw(img)
    cx = w // 2
    d.rectangle([cx - 10, 330, cx + 10, h], fill=(70, 70, 75))  # tiang
    d.rounded_rectangle([cx - 70, 30, cx + 70, 340], radius=24, fill=(30, 30, 32))
    for i, warna in enumerate(((235, 40, 35), (90, 75, 20), (25, 70, 35))):  # merah menyala, kuning & hijau redup
        y = 85 + i * 100
        d.ellipse([cx - 42, y - 42, cx + 42, y + 42], fill=warna)
    return img


def sepeda(w: int = 640, h: int = 400) -> Image.Image:
    img = Image.new("RGB", (w, h), (240, 238, 232))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 330, w, h], fill=(150, 150, 150))  # jalan
    rr, y0 = 95, 235
    belakang, depan = (170, y0), (470, y0)
    pedal = (300, y0)
    sadel = (255, 105)
    setang = (430, 95)
    hitam = (25, 25, 25)
    for c in (belakang, depan):
        d.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], outline=hitam, width=12)
        for k in range(12):
            a = math.radians(k * 30)
            d.line([c, (c[0] + rr * math.cos(a), c[1] + rr * math.sin(a))], fill=(110, 110, 110), width=2)
        d.ellipse([c[0] - 8, c[1] - 8, c[0] + 8, c[1] + 8], fill=hitam)
    merah = (190, 30, 40)
    kepala = (420, 125)
    for a, b in ((belakang, pedal), (pedal, sadel), (sadel, belakang), (sadel, kepala), (pedal, kepala), (kepala, depan)):
        d.line([a, b], fill=merah, width=11)
    d.line([sadel, (sadel[0] - 8, sadel[1] - 25)], fill=hitam, width=8)
    d.rounded_rectangle([sadel[0] - 45, sadel[1] - 38, sadel[0] + 25, sadel[1] - 22], radius=8, fill=hitam)  # sadel
    d.line([kepala, setang], fill=hitam, width=9)
    d.line([setang, (setang[0] + 45, setang[1] + 5)], fill=hitam, width=9)  # setang
    d.ellipse([pedal[0] - 22, pedal[1] - 22, pedal[0] + 22, pedal[1] + 22], outline=hitam, width=6)
    d.line([(pedal[0] - 30, pedal[1] - 25), (pedal[0] + 30, pedal[1] + 25)], fill=hitam, width=7)
    return img


def parkir_sepeda(w: int = 900, h: int = 420) -> Image.Image:
    """Dua sepeda berdampingan dan rambu STOP kecil → contoh penggabungan jumlah ("2 sepeda, 1 rambu berhenti")."""
    img = Image.new("RGB", (w, h), (240, 238, 232))
    kiri = sepeda(640, 400).resize((420, 262))
    img.paste(kiri, (10, 150))
    img.paste(kiri, (440, 150))
    stop = rambu_stop(480, 480).crop((90, 0, 390, 300)).resize((150, 150))
    img.paste(stop, (w // 2 - 75, 0))
    return img


def polos_krem(w: int = 480, h: int = 300) -> Image.Image:
    return Image.new("RGB", (w, h), (243, 236, 220))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for nama, fn in (("rambu-stop", rambu_stop), ("jam-dinding", jam_dinding), ("lampu-lalu-lintas", lampu_lalu_lintas),
                     ("sepeda", sepeda), ("parkir-sepeda", parkir_sepeda), ("polos-krem", polos_krem)):
        fn().save(OUT / f"{nama}.png", optimize=True)
        print("ditulis", OUT / f"{nama}.png")


if __name__ == "__main__":
    main()
