"""Kumpulkan gambar evaluasi dari artikel berita (sources.txt) atau folder lokal.

    python -m eval.collect --sources eval/sources.txt
    python -m eval.collect --folder D:/foto-uji

Aturan: hormati robots.txt, jeda ≥ 1 detik antar-permintaan, filter seperti extension
(sisi terpendek ≥ 150 px, bukan SVG/ikon/logo, bukan duplikat), simpan JPEG ≤ 1280 px ke
data/images/ dan catat di data/manifest.csv. Gambar TIDAK masuk repo (hak cipta & privasi).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image, UnidentifiedImageError

from eval.common import DEFAULT_DATA, MANIFEST_FIELDS, Paths, read_csv, utf8_console, write_csv

USER_AGENT = "NaraVisiEvalBot/1.0 (tugas kuliah; pengumpulan dataset evaluasi kecil)"
MIN_SIDE = 150
MAX_SIDE = 1280
MAX_BYTES = 10 * 1024 * 1024
DUP_DISTANCE = 4  # selisih bit dHash ≤ 4 → gambar yang sama (mis. versi ukuran lain)
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"}

# Sama semangatnya dengan NOISE_RE di extension/content/content.js.
NOISE_RE = re.compile(
    r"(^|[^a-z])(icons?|ikon|logos?|avatars?|sprites?|emoji|badges?|ads?|advert\w*|iklan|sponsor\w*|"
    r"tracking|pixel|spacer|favicon|placeholder|blank|loading)([^a-z]|$)",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Parser HTML
# ---------------------------------------------------------------------------
class ArticleImageParser(HTMLParser):
    """Ambil <img> (src/srcset/data-src), alt, keterangan <figcaption>, dan judul halaman."""

    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.images: list[dict] = []
        self.title = ""
        self.og_title = ""
        self._in_title = False
        self._figure_stack: list[list[dict]] = []  # gambar di dalam <figure> yang sedang terbuka
        self._caption_parts: list[str] | None = None
        self._skip_depth = 0  # di dalam <noscript>/<script>/<style>/<svg>

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag in ("script", "style", "noscript", "svg", "template"):
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._in_title = True
        elif tag == "meta" and a.get("property", "").lower() == "og:title":
            self.og_title = a.get("content", "").strip()
        elif tag == "figure":
            self._figure_stack.append([])
        elif tag == "figcaption":
            self._caption_parts = []
        elif tag == "img":
            self._add_image(a)

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg", "template"):
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._in_title = False
        elif tag == "figcaption" and self._caption_parts is not None:
            caption = " ".join(" ".join(self._caption_parts).split())
            if self._figure_stack:
                for img in self._figure_stack[-1]:
                    img["caption"] = img["caption"] or caption
            self._caption_parts = None
        elif tag == "figure" and self._figure_stack:
            self._figure_stack.pop()

    def handle_data(self, data):
        if self._skip_depth:
            return
        if self._in_title:
            self.title += data
        if self._caption_parts is not None:
            self._caption_parts.append(data)

    def _add_image(self, a: dict) -> None:
        src = best_src(a)
        if not src or src.startswith("data:"):
            return
        url = urllib.parse.urljoin(self.base_url, src)
        if urllib.parse.urlparse(url).scheme not in ("http", "https"):
            return
        if is_noise(url, a):
            return
        try:
            declared = [int(a[k]) for k in ("width", "height") if a.get(k, "").isdigit()]
        except ValueError:
            declared = []
        if declared and min(declared) < MIN_SIDE:
            return
        item = {"url": url, "alt": " ".join(a.get("alt", "").split()), "caption": ""}
        if any(i["url"] == url for i in self.images):
            return
        self.images.append(item)
        if self._figure_stack:
            self._figure_stack[-1].append(item)

    @property
    def page_title(self) -> str:
        return " ".join((self.og_title or self.title).split())


def best_src(a: dict) -> str:
    """srcset terbesar (w atau x), lalu data-src/data-lazy-src (lazy load), lalu src."""
    for key in ("srcset", "data-srcset"):
        candidates = []
        for part in a.get(key, "").split(","):
            bits = part.strip().split()
            if not bits:
                continue
            size = 1.0
            if len(bits) > 1 and bits[1][:-1].replace(".", "", 1).isdigit():
                size = float(bits[1][:-1]) * (1 if bits[1].endswith("w") else 1000)
            candidates.append((size, bits[0]))
        if candidates:
            return max(candidates)[1]
    for key in ("data-src", "data-lazy-src", "data-original", "src"):
        if a.get(key, "").strip():
            return a[key].strip()
    return ""


def is_noise(url: str, a: dict) -> bool:
    path = urllib.parse.urlparse(url).path.lower()
    if path.endswith(".svg") or path.endswith(".ico"):
        return True
    if a.get("role", "").lower() in ("presentation", "none") or a.get("aria-hidden", "").lower() == "true":
        return True
    haystack = " ".join([path, a.get("class", ""), a.get("id", "")])
    return bool(NOISE_RE.search(haystack))


def parse_article(html: str, base_url: str) -> tuple[str, list[dict]]:
    parser = ArticleImageParser(base_url)
    parser.feed(html)
    parser.close()
    return parser.page_title, parser.images


# ---------------------------------------------------------------------------
# Gambar
# ---------------------------------------------------------------------------
def dhash(image: Image.Image) -> int:
    """Difference hash 64-bit: tahan terhadap perubahan ukuran & kompresi."""
    small = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    px = small.tobytes()  # mode L: satu byte per piksel
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (px[row * 9 + col] > px[row * 9 + col + 1])
    return bits


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


class Rejected(Exception):
    """Gambar tidak memenuhi syarat dataset (alasan di pesan)."""


def prepare_image(data: bytes, min_side: int = MIN_SIDE, max_side: int = MAX_SIDE) -> Image.Image:
    head = data[:512].lstrip().lower()
    if head.startswith(b"<svg") or head.startswith(b"<?xml"):
        raise Rejected("SVG")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise Rejected("bukan gambar") from exc
    if getattr(img, "is_animated", False):
        img.seek(0)
    if min(img.size) < min_side:
        raise Rejected(f"terlalu kecil ({img.width}×{img.height})")
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return img


class Dataset:
    """Manifest + folder gambar; mencegah duplikat (sha1 berkas asli & dHash)."""

    def __init__(self, paths: Paths, min_side: int = MIN_SIDE, max_side: int = MAX_SIDE):
        self.paths = paths
        self.min_side = min_side
        self.max_side = max_side
        self.rows = read_csv(paths.manifest)
        self._sha = {r["sha1"] for r in self.rows}
        self._dh = [int(r["dhash"], 16) for r in self.rows if r.get("dhash")]
        self._urls = {r["image_url"] for r in self.rows}

    def next_id(self) -> str:
        nums = [int(r["id"].split("-")[-1]) for r in self.rows if r["id"].split("-")[-1].isdigit()]
        return f"img-{(max(nums) + 1) if nums else 1:04d}"

    def seen_url(self, url: str) -> bool:
        return url in self._urls

    def add(self, data: bytes, *, image_url: str, page_url: str = "", alt: str = "", caption: str = "", page_title: str = "") -> dict:
        sha = hashlib.sha1(data).hexdigest()
        if sha in self._sha:
            raise Rejected("duplikat (berkas sama)")
        img = prepare_image(data, self.min_side, self.max_side)
        dh = dhash(img)
        if any(hamming(dh, other) <= DUP_DISTANCE for other in self._dh):
            raise Rejected("duplikat (gambar mirip)")
        image_id = self.next_id()
        self.paths.images.mkdir(parents=True, exist_ok=True)
        file = f"{image_id}.jpg"
        img.save(self.paths.images / file, "JPEG", quality=85, optimize=True)
        row = {
            "id": image_id, "file": file, "image_url": image_url, "page_url": page_url,
            "site": urllib.parse.urlparse(page_url or image_url).hostname or "lokal",
            "width": img.width, "height": img.height, "sha1": sha, "dhash": f"{dh:016x}",
            "alt": alt, "caption": caption, "page_title": page_title,
            "collected_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        self.rows.append(row)
        self._sha.add(sha)
        self._dh.append(dh)
        self._urls.add(image_url)
        write_csv(self.paths.manifest, MANIFEST_FIELDS, self.rows)
        return row


# ---------------------------------------------------------------------------
# Unduhan sopan: robots.txt + jeda per host
# ---------------------------------------------------------------------------
class PoliteFetcher:
    def __init__(self, delay: float = 1.0, user_agent: str = USER_AGENT, opener=None, sleep=time.sleep, clock=time.monotonic):
        self.delay = max(1.0, delay)
        self.user_agent = user_agent
        self._open = opener or urllib.request.urlopen
        self._sleep = sleep
        self._clock = clock
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._last: dict[str, float] = {}

    def _wait(self, host: str) -> None:
        last = self._last.get(host)
        if last is not None:
            remaining = self.delay - (self._clock() - last)
            if remaining > 0:
                self._sleep(remaining)
        self._last[host] = self._clock()

    def _raw_get(self, url: str, max_bytes: int) -> bytes:
        host = urllib.parse.urlparse(url).netloc
        self._wait(host)
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept-Language": "id,en;q=0.5"})
        with self._open(req, timeout=20) as resp:
            data = resp.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise Rejected("berkas terlalu besar")
        return data

    def allowed(self, url: str) -> bool:
        parts = urllib.parse.urlparse(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                rp.parse(self._raw_get(f"{origin}/robots.txt", 512 * 1024).decode("utf-8", "replace").splitlines())
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403):
                    rp.disallow_all = True  # robots.txt dilarang dibaca → anggap semua dilarang
                else:
                    rp.allow_all = True  # 404 dll. → tidak ada aturan
            except (urllib.error.URLError, OSError, Rejected):
                rp = None  # tidak bisa dicek → jangan ambil apa pun dari situs ini
            self._robots[origin] = rp
        rp = self._robots[origin]
        return bool(rp and rp.can_fetch(self.user_agent, url))

    def get(self, url: str, max_bytes: int = MAX_BYTES) -> bytes:
        if urllib.parse.urlparse(url).scheme not in ("http", "https"):
            raise Rejected("hanya http/https")
        if not self.allowed(url):
            raise Rejected("dilarang robots.txt")
        return self._raw_get(url, max_bytes)


def read_sources(path: Path) -> list[str]:
    urls = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split(" #", 1)[0].strip()  # komentar di akhir baris; "#" di dalam URL tetap
        if line and not line.startswith("#"):
            urls.append(line)
    return urls


def collect_from_urls(dataset: Dataset, urls: list[str], fetcher: PoliteFetcher, per_page: int = 5, log=print) -> int:
    added = 0
    for page_url in urls:
        try:
            html = fetcher.get(page_url, 5 * 1024 * 1024).decode("utf-8", "replace")
        except (Rejected, urllib.error.URLError, OSError) as exc:
            log(f"[lewati] {page_url}: {exc}")
            continue
        title, images = parse_article(html, page_url)
        taken = 0
        for img in images:
            if taken >= per_page:
                break
            if dataset.seen_url(img["url"]):
                continue
            try:
                row = dataset.add(fetcher.get(img["url"]), image_url=img["url"], page_url=page_url,
                                  alt=img["alt"], caption=img["caption"], page_title=title)
            except (Rejected, urllib.error.URLError, OSError) as exc:
                log(f"  [lewati] {img['url']}: {exc}")
                continue
            taken += 1
            added += 1
            log(f"  [+] {row['id']} {row['width']}×{row['height']} {img['url']}")
    return added


def collect_from_folder(dataset: Dataset, folder: Path, log=print) -> int:
    added = 0
    for file in sorted(p for p in folder.rglob("*") if p.is_file()):
        if file.suffix.lower() not in IMAGE_EXT:
            if file.suffix.lower() == ".svg":
                log(f"[lewati] {file.name}: SVG")
            continue
        if NOISE_RE.search(file.stem):
            log(f"[lewati] {file.name}: ikon/logo")
            continue
        try:
            row = dataset.add(file.read_bytes(), image_url=f"lokal:{file.relative_to(folder).as_posix()}")
        except Rejected as exc:
            log(f"[lewati] {file.name}: {exc}")
            continue
        added += 1
        log(f"[+] {row['id']} {row['width']}×{row['height']} {file.name}")
    return added


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--sources", type=Path, help="berkas berisi URL artikel, satu per baris")
    src.add_argument("--folder", type=Path, help="folder gambar lokal")
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--per-page", type=int, default=5, help="maks. gambar per artikel (bawaan 5)")
    ap.add_argument("--delay", type=float, default=1.0, help="jeda antar-permintaan per situs, min. 1 dtk")
    ap.add_argument("--min-side", type=int, default=MIN_SIDE)
    args = ap.parse_args(argv)

    dataset = Dataset(Paths(args.data), min_side=args.min_side)
    if args.sources:
        added = collect_from_urls(dataset, read_sources(args.sources), PoliteFetcher(args.delay), args.per_page)
    else:
        added = collect_from_folder(dataset, args.folder)
    print(f"Selesai: {added} gambar baru, total {len(dataset.rows)} di {args.data / 'manifest.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
