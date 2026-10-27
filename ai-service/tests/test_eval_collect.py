"""Pengumpul dataset: parser HTML, filter gambar, duplikat, robots.txt & jeda."""

import io
import tempfile
import unittest
import urllib.error
from pathlib import Path

from PIL import Image

from eval import collect
from eval.common import Paths, read_csv

ARTICLE = """<!doctype html><html><head><title>Judul tag title</title>
<meta property="og:title" content="Banjir Rendam Ratusan Rumah di Samarinda">
<script>var x = '<img src="/dari-script.jpg">';</script></head>
<body>
<header><img src="/static/logo-situs.png" alt="Logo"><img src="/icons/search.png" alt=""></header>
<article>
  <figure>
    <img src="/foto/banjir-kecil.jpg" srcset="/foto/banjir-480.jpg 480w, /foto/banjir-1200.jpg 1200w" alt="Warga  menyeberangi banjir">
    <figcaption>Warga menyeberangi banjir di Jalan Pahlawan, <b>Senin</b> (27/10).</figcaption>
  </figure>
  <img data-src="https://cdn.contoh.id/grafik-curah-hujan.png" src="data:image/gif;base64,R0lGOD" alt="Grafik curah hujan">
  <img src="/foto/peta.svg" alt="Peta">
  <img src="/foto/kecil.jpg" width="40" height="40" alt="kecil">
  <img src="/foto/hias.jpg" role="presentation">
  <img src="/foto/iklan.jpg" class="ads-banner">
  <img src="/foto/banjir-kecil.jpg" srcset="/foto/banjir-480.jpg 480w, /foto/banjir-1200.jpg 1200w" alt="duplikat">
  <noscript><img src="/foto/noscript.jpg"></noscript>
</article></body></html>"""


def gradient(direction: str) -> bytes:
    """Gambar bergradasi; arah berbeda → dHash sangat berbeda."""
    img = Image.new("L", (400, 300))
    for x in range(400):
        for y in range(300):
            v = x * 255 // 399 if direction == "kanan" else 255 - x * 255 // 399
            img.putpixel((x, y), v)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG")
    return buf.getvalue()


def jpeg(size=(400, 300), color=(200, 30, 30), pattern=False) -> bytes:
    img = Image.new("RGB", size, color)
    if pattern:  # pola agar dHash berbeda dari gambar polos
        for x in range(0, size[0], 20):
            for y in range(size[1]):
                img.putpixel((x, y), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


class TestParser(unittest.TestCase):
    def test_artikel(self):
        title, images = collect.parse_article(ARTICLE, "https://berita.contoh.id/2026/10/banjir")
        self.assertEqual(title, "Banjir Rendam Ratusan Rumah di Samarinda")  # og:title didahulukan
        self.assertEqual([i["url"] for i in images], [
            "https://berita.contoh.id/foto/banjir-1200.jpg",  # srcset terbesar
            "https://cdn.contoh.id/grafik-curah-hujan.png",  # data-src (lazy load), bukan data: URL
        ])
        self.assertEqual(images[0]["alt"], "Warga menyeberangi banjir")
        self.assertEqual(images[0]["caption"], "Warga menyeberangi banjir di Jalan Pahlawan, Senin (27/10).")
        self.assertEqual(images[1]["caption"], "")

    def test_title_bila_tanpa_og(self):
        title, _ = collect.parse_article("<title>  Halo\n dunia </title>", "https://a.id/")
        self.assertEqual(title, "Halo dunia")

    def test_best_src_density(self):
        self.assertEqual(collect.best_src({"srcset": "a.jpg 1x, b.jpg 2x"}), "b.jpg")
        self.assertEqual(collect.best_src({"src": " c.jpg "}), "c.jpg")

    def test_read_sources(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.txt"
            p.write_text("# komentar\n\nhttps://a.id/1  # catatan\nhttps://b.id/2#bagian\n", encoding="utf-8")
            self.assertEqual(collect.read_sources(p), ["https://a.id/1", "https://b.id/2#bagian"])


class TestDataset(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.paths = Paths(Path(self.tmp.name))
        self.ds = collect.Dataset(self.paths)

    def tearDown(self):
        self.tmp.cleanup()

    def test_simpan_jpeg_maks_1280_dan_manifest(self):
        row = self.ds.add(jpeg((3000, 1500)), image_url="https://a.id/x.jpg", page_url="https://a.id/berita", alt="x")
        self.assertEqual(row["id"], "img-0001")
        img = Image.open(self.paths.images / row["file"])
        self.assertEqual((img.format, img.size), ("JPEG", (1280, 640)))
        self.assertEqual(read_csv(self.paths.manifest)[0]["site"], "a.id")

    def test_filter(self):
        with self.assertRaisesRegex(collect.Rejected, "terlalu kecil"):
            self.ds.add(jpeg((149, 400)), image_url="u1")
        with self.assertRaisesRegex(collect.Rejected, "SVG"):
            self.ds.add(b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', image_url="u2")
        with self.assertRaisesRegex(collect.Rejected, "bukan gambar"):
            self.ds.add(b"<html>404</html>", image_url="u3")

    def test_duplikat_berkas_dan_mirip(self):
        data = jpeg(pattern=True)
        self.ds.add(data, image_url="u1")
        with self.assertRaisesRegex(collect.Rejected, "berkas sama"):
            self.ds.add(data, image_url="u2")
        # gambar sama, ukuran lain → dHash mirip
        big = Image.open(io.BytesIO(data)).resize((800, 600))
        buf = io.BytesIO()
        big.save(buf, "JPEG", quality=70)
        with self.assertRaisesRegex(collect.Rejected, "mirip"):
            self.ds.add(buf.getvalue(), image_url="u3")
        self.assertEqual(len(read_csv(self.paths.manifest)), 1)

    def test_png_transparan_jadi_latar_putih(self):
        img = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        row = self.ds.add(buf.getvalue(), image_url="u")
        self.assertEqual(Image.open(self.paths.images / row["file"]).getpixel((5, 5))[0] > 240, True)

    def test_folder(self):
        src = Path(self.tmp.name) / "masukan"
        src.mkdir()
        (src / "a.jpg").write_bytes(jpeg(pattern=True))
        (src / "logo-kantor.jpg").write_bytes(jpeg(color=(0, 90, 0)))
        (src / "kecil.jpg").write_bytes(jpeg((80, 80)))
        (src / "b.svg").write_text("<svg/>")
        (src / "catatan.txt").write_text("bukan gambar")
        self.assertEqual(collect.collect_from_folder(self.ds, src, log=lambda *_: None), 1)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeWeb:
    def __init__(self, pages: dict):
        self.pages = pages
        self.requests = []

    def __call__(self, req, timeout=None):
        url = req.full_url
        self.requests.append(url)
        if url not in self.pages:
            raise urllib.error.HTTPError(url, 404, "not found", {}, None)
        return FakeResponse(self.pages[url])


class TestPoliteFetcher(unittest.TestCase):
    def test_robots_dan_jeda(self):
        t = {"now": 0.0}
        sleeps = []
        web = FakeWeb({
            "https://a.id/robots.txt": b"User-agent: *\nDisallow: /privat/\n",
            "https://a.id/berita": b"<html></html>",
        })
        f = collect.PoliteFetcher(delay=0.2, opener=web, sleep=lambda s: (sleeps.append(s), t.__setitem__("now", t["now"] + s)), clock=lambda: t["now"])
        self.assertEqual(f.delay, 1.0)  # jeda minimal 1 detik
        f.get("https://a.id/berita")
        with self.assertRaisesRegex(collect.Rejected, "robots"):
            f.get("https://a.id/privat/rahasia.jpg")
        self.assertNotIn("https://a.id/privat/rahasia.jpg", web.requests)  # tidak pernah diminta
        self.assertEqual(sleeps, [1.0])  # robots.txt lalu halaman: dijeda 1 dtk
        with self.assertRaisesRegex(collect.Rejected, "http"):
            f.get("file:///etc/passwd")

    def test_tanpa_robots_boleh_robots_403_dilarang(self):
        web = FakeWeb({"https://b.id/x": b"ok"})
        f = collect.PoliteFetcher(opener=web, sleep=lambda s: None)
        self.assertEqual(f.get("https://b.id/x"), b"ok")

        class Forbidden(FakeWeb):
            def __call__(self, req, timeout=None):
                raise urllib.error.HTTPError(req.full_url, 403, "forbidden", {}, None)

        f2 = collect.PoliteFetcher(opener=Forbidden({}), sleep=lambda s: None)
        self.assertFalse(f2.allowed("https://c.id/x"))

    def test_collect_from_urls(self):
        html = b'<title>T</title><img src="/a.jpg" alt="A"><img src="/b.jpg"><img src="/rusak.jpg">'
        web = FakeWeb({
            "https://a.id/robots.txt": b"",
            "https://a.id/artikel": html,
            "https://a.id/a.jpg": gradient("kanan"),
            "https://a.id/b.jpg": gradient("kiri"),
            "https://a.id/rusak.jpg": b"bukan",
        })
        with tempfile.TemporaryDirectory() as d:
            ds = collect.Dataset(Paths(Path(d)))
            n = collect.collect_from_urls(ds, ["https://a.id/artikel"], collect.PoliteFetcher(opener=web, sleep=lambda s: None), log=lambda *_: None)
            self.assertEqual(n, 2)
            rows = read_csv(Paths(Path(d)).manifest)
            self.assertEqual([(r["alt"], r["page_title"], r["page_url"]) for r in rows][0], ("A", "T", "https://a.id/artikel"))


if __name__ == "__main__":
    unittest.main()
