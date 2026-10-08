"""Renderer diagram use case sederhana (PIL) untuk SRS/SDD NaraVisi v1.1."""
import math
import sys
from PIL import Image, ImageDraw, ImageFont

S = 2  # skala render
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
INK = (17, 17, 17)
FILL = (234, 241, 252)
EDGE = (11, 87, 208)


def f(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size * S)


def actor(d, x, y, label):
    """Gambar aktor stick-figure, (x,y) = pusat badan. Kembalikan titik sambung."""
    r = 16 * S
    hy = y - 46 * S
    d.ellipse([x - r, hy - r, x + r, hy + r], outline=INK, width=3 * S // 2)
    d.line([x, hy + r, x, y + 20 * S], fill=INK, width=3 * S // 2)
    d.line([x - 30 * S, y - 10 * S, x + 30 * S, y - 10 * S], fill=INK, width=3 * S // 2)
    d.line([x, y + 20 * S, x - 24 * S, y + 58 * S], fill=INK, width=3 * S // 2)
    d.line([x, y + 20 * S, x + 24 * S, y + 58 * S], fill=INK, width=3 * S // 2)
    font = f(15, True)
    lines = label.split("\n")
    for i, ln in enumerate(lines):
        w = d.textlength(ln, font=font)
        d.text((x - w / 2, y + 66 * S + i * 20 * S), ln, font=font, fill=INK)
    return (x, y)


def ellipse_point(cx, cy, rx, ry, tx, ty):
    ang = math.atan2(ty - cy, tx - cx)
    # titik pada elips searah sudut
    t = math.atan2(math.sin(ang) * rx, math.cos(ang) * ry)
    return cx + rx * math.cos(t), cy + ry * math.sin(t)


def render(path, title, ucs, left, right=(), assoc=(), gen=None):
    """
    ucs: daftar nama use case (urutan vertikal)
    left/right: daftar (key, label, y_index_float) aktor
    assoc: daftar (actor_key, uc_index)
    gen: (child_key, parent_key) generalisasi
    """
    n = len(ucs)
    gap = 100
    top = 90
    H = max(top + n * gap + 60, 560)
    W = 1500 if right else 1300
    img = Image.new("RGB", (W * S, H * S), "white")
    d = ImageDraw.Draw(img)

    bx0, bx1 = 300, (W - 300) if right else W - 120
    d.rectangle([bx0 * S, 30 * S, bx1 * S, (H - 25) * S], outline=INK, width=2 * S)
    tf = f(17, True)
    tw = d.textlength(title, font=tf)
    d.text((((bx0 + bx1) / 2) * S - tw / 2, 42 * S), title, font=tf, fill=INK)

    cx = (bx0 + bx1) / 2
    rx, ry = 200, 34
    centers = []
    uf = f(15)
    for i, name in enumerate(ucs):
        cy = top + 40 + i * gap
        centers.append((cx, cy))

    pos = {}
    def place(items, x):
        for key, label, yi in items:
            y = top + 40 + yi * gap
            pos[key] = (x, y, label)

    place(left, 140)
    place(right, W - 150)

    # garis asosiasi (di bawah elips)
    for key, ui in assoc:
        ax, ay, _ = pos[key]
        ux, uy = centers[ui]
        sx = ax + (34 if ax < ux else -34)
        px, py = (ux - rx, uy) if ax < ux else (ux + rx, uy)  # ujung kiri/kanan elips
        d.line([sx * S, (ay - 10) * S, px * S, py * S], fill=INK, width=2 * S // 2 + 1)

    for i, (ux, uy) in enumerate(centers):
        d.ellipse([(ux - rx) * S, (uy - ry) * S, (ux + rx) * S, (uy + ry) * S], fill=FILL, outline=EDGE, width=2 * S)
        name = ucs[i]
        w = d.textlength(name, font=uf)
        if w > (2 * rx - 30) * S:
            words = name.split()
            mid = len(words) // 2
            parts = [" ".join(words[:mid]), " ".join(words[mid:])]
            for j, p in enumerate(parts):
                pw = d.textlength(p, font=uf)
                d.text((ux * S - pw / 2, (uy - 19 + j * 19) * S), p, font=uf, fill=INK)
        else:
            d.text((ux * S - w / 2, (uy - 9) * S), name, font=uf, fill=INK)

    for key, (x, y, label) in pos.items():
        actor(d, x * S, y * S, label)

    if gen:
        child, parent = gen
        cx_, cy_, _ = pos[child]
        px_, py_, _ = pos[parent]
        # dari kepala anak ke kaki/label induk
        y_start = cy_ - 66
        y_end = py_ + 110
        d.line([cx_ * S, y_start * S, px_ * S, (y_end + 18) * S], fill=INK, width=2 * S)
        tri = [(px_ * S, y_end * S), ((px_ - 12) * S, (y_end + 20) * S), ((px_ + 12) * S, (y_end + 20) * S)]
        d.polygon(tri, fill="white", outline=INK)
        d.line(tri + [tri[0]], fill=INK, width=2 * S)

    img = img.resize((W, H), Image.LANCZOS)
    img.save(path)


G, P = "gratis", "premium"
L_USERS = [(G, "Pengguna\nGratis", 1.2), (P, "Pengguna\nPremium", 3.6)]

out = sys.argv[1]

render(f"{out}/uc-A.png", "NaraVisi — A. Akun & Profil",
       ["Mendaftarkan Akun", "Melihat Data Profil", "Mengubah Data Profil", "Menghapus Akun", "Melakukan Login"],
       L_USERS, right=[("admin", "Admin", 4)],
       assoc=[(G, 0), (G, 1), (G, 2), (G, 3), (G, 4), ("admin", 4)], gen=(P, G))

render(f"{out}/uc-B.png", "NaraVisi — B. Pemrosesan Gambar & AI",
       ["Memindai Gambar pada Halaman Web", "Melihat Daftar Gambar", "Memilih Gambar", "Mengirim Gambar ke AI",
        "Menghasilkan Deskripsi Gambar", "Melihat Deskripsi Gambar", "Membacakan Deskripsi Gambar"],
       [(G, "Pengguna\nGratis", 2.0), (P, "Pengguna\nPremium", 5.0)],
       right=[("ai", "Layanan AI\nImage Captioning", 3.5)],
       assoc=[(G, 0), (G, 1), (G, 2), (G, 3), (G, 5), (G, 6), ("ai", 3), ("ai", 4)], gen=(P, G))

render(f"{out}/uc-C.png", "NaraVisi — C. Riwayat Deskripsi",
       ["Menyimpan Riwayat Deskripsi", "Melihat Daftar Riwayat Deskripsi", "Melihat Detail Riwayat Deskripsi",
        "Menghapus Riwayat Deskripsi"],
       [(G, "Pengguna\nGratis", 1.0), (P, "Pengguna\nPremium", 3.3)],
       assoc=[(G, 0), (G, 1), (G, 2), (G, 3)], gen=(P, G))

render(f"{out}/uc-D.png", "NaraVisi — D. Aksesibilitas",
       ["Melihat Pengaturan Aksesibilitas", "Mengubah Pengaturan Aksesibilitas", "Mengubah Pengaturan TTS"],
       [(G, "Pengguna\nGratis", 0.0), (P, "Pengguna\nPremium", 2.3)],
       assoc=[(G, 0), (G, 1), (G, 2)], gen=(P, G))

render(f"{out}/uc-E.png", "NaraVisi — E. Laporan",
       ["Menambahkan Laporan Deskripsi Tidak Akurat", "Melihat Daftar Laporan Deskripsi", "Mengubah Status Laporan Deskripsi"],
       [(G, "Pengguna\nGratis", 0.0), (P, "Pengguna\nPremium", 2.3)],
       right=[("admin", "Admin", 1.5)],
       assoc=[(G, 0), ("admin", 1), ("admin", 2)], gen=(P, G))

render(f"{out}/uc-F.png", "NaraVisi — F. Premium & Transaksi",
       ["Melihat Daftar Paket Premium", "Memilih Paket Premium", "Melakukan Pembayaran Premium", "Melihat Status Langganan Premium"],
       [(G, "Pengguna\nGratis", 0.2), (P, "Pengguna\nPremium", 2.6)],
       right=[("pg", "Payment Gateway\n(Midtrans)", 2)],
       assoc=[(G, 0), (G, 1), (G, 2), (P, 3), ("pg", 2)], gen=(P, G))

render(f"{out}/uc-G.png", "NaraVisi — G. Admin",
       ["Menambahkan Data Pengguna", "Melihat Daftar Pengguna", "Mengubah Data Pengguna", "Menghapus Data Pengguna"],
       [("admin", "Admin", 1.5)],
       assoc=[("admin", 0), ("admin", 1), ("admin", 2), ("admin", 3)])
print("ok")
