"""Lokasi berkas dataset & pembaca/penulis CSV/JSONL bersama."""

from __future__ import annotations

import csv
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_DATA = Path(__file__).resolve().parent / "data"

MANIFEST_FIELDS = [
    "id", "file", "image_url", "page_url", "site", "width", "height", "sha1", "dhash",
    "alt", "caption", "page_title", "collected_at",
]
REFERENCE_FIELDS = ["id", "jenis", "acuan_1", "acuan_2", "teks_dalam_gambar", "annotator", "updated_at"]
RATING_FIELDS = ["run", "id", "nilai", "annotator", "updated_at"]

JENIS = (
    "foto", "ilustrasi", "grafik", "infografis", "tangkapan_layar",
    "diagram", "logo", "meme", "dokumen", "lainnya",
)
NILAI = ("akurat", "sebagian", "salah")


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def images(self) -> Path:
        return self.root / "images"

    @property
    def predictions(self) -> Path:
        return self.root / "predictions"

    @property
    def reports(self) -> Path:
        return self.root / "reports"

    @property
    def manifest(self) -> Path:
        return self.root / "manifest.csv"

    @property
    def references(self) -> Path:
        return self.root / "references.csv"

    @property
    def ratings(self) -> Path:
        return self.root / "ratings.csv"

    @property
    def fewshot(self) -> Path:
        return self.root / "fewshot.json"

    def prediction_file(self, run: str) -> Path:
        return self.predictions / f"{safe_name(run)}.jsonl"


def safe_name(run: str) -> str:
    clean = "".join(c if c.isalnum() or c in "-_." else "-" for c in run.strip())
    if not clean.strip("-."):
        raise ValueError("Nama run tidak valid.")
    return clean


def read_csv(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    """Tulis ke berkas sementara lalu ganti (berkas tidak pernah setengah tertulis)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})
    os.replace(tmp, path)


def upsert_csv(path: Path, fields: list[str], row: dict, keys: tuple[str, ...]) -> None:
    rows = read_csv(path)
    match = tuple(str(row[k]) for k in keys)
    rows = [r for r in rows if tuple(r.get(k, "") for k in keys) != match]
    rows.append(row)
    write_csv(path, fields, rows)


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def utf8_console() -> None:
    """Konsol/pipa Windows (cp1252) tidak bisa mencetak "≤", "→", "×": paksa UTF-8."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def load_dotenv(path: Path) -> None:
    """Baca KEY=VALUE dari .env ke os.environ (tanpa menimpa yang sudah ada, tanpa mencetak isinya)."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if value[:1] in "\"'" and value[-1:] == value[:1] and len(value) >= 2:
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].strip()
        os.environ.setdefault(key.strip(), value)
