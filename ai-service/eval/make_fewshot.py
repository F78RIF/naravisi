"""Pilih 3–5 contoh terbaik dari acuan → data/fewshot.json (dibaca prompt Gemini, app/prompts.py).

    python -m eval.make_fewshot              # 5 contoh, jenis gambar dibuat beragam
    python -m eval.make_fewshot --n 3 --run gemini-1

Kriteria: acuan lengkap (jenis + acuan_1), panjang ringkasan 6–20 kata (aturan 3 di prompt),
jenis sebanyak mungkin berbeda. Dengan --run, gambar yang dinilai "salah"/"sebagian" pada run itu
didahulukan — contoh tersulit paling banyak mengajari model. ID contoh dicatat di fewshot.json
supaya `run_eval.py score` tidak menilai gambar yang sudah menjadi contoh (mencegah kebocoran).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eval.common import DEFAULT_DATA, JENIS, Paths, read_csv, utf8_console
from eval.metrics import tokenize

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def split_reference(text: str) -> tuple[str, str]:
    """Kalimat pertama → ringkasan, sisanya → detail."""
    parts = _SENTENCE_END.split(" ".join(text.split()), maxsplit=1)
    return parts[0].strip(), (parts[1].strip() if len(parts) > 1 else "")


def situasi(ref: dict, row: dict) -> str:
    """Gambaran singkat gambar contoh (teks, karena few-shot di prompt tidak menyertakan gambarnya)."""
    jenis = ref["jenis"].replace("_", " ")
    hint = row.get("caption") or row.get("alt") or row.get("page_title") or ""
    hint = " ".join(hint.split())[:160]
    return f"{jenis} dari artikel berita" + (f" berketerangan \"{hint}\"" if hint else "")


def quality(ref: dict) -> float | None:
    ringkasan, _ = split_reference(ref["acuan_1"])
    words = len(tokenize(ringkasan))
    if ref.get("jenis") not in JENIS or not 6 <= words <= 20:
        return None
    score = 1.0
    if ref.get("acuan_2", "").strip():
        score += 0.5  # dua penulis acuan sepakat tentang gambar ini → contoh lebih andal
    if ref.get("teks_dalam_gambar", "").strip():
        score += 0.3  # mengajarkan aturan menyalin teks
    return score


def build(paths: Paths, n: int = 5, run: str | None = None) -> dict:
    refs = [r for r in read_csv(paths.references) if r.get("acuan_1", "").strip()]
    manifest = {r["id"]: r for r in read_csv(paths.manifest)}
    hard = {}
    if run:
        hard = {r["id"]: r["nilai"] for r in read_csv(paths.ratings) if r["run"] == run and r["nilai"] in ("salah", "sebagian")}

    ranked = []
    for ref in refs:
        q = quality(ref)
        if q is None:
            continue
        q += {"salah": 1.0, "sebagian": 0.5}.get(hard.get(ref["id"]), 0.0)
        ranked.append((q, ref["id"], ref))
    ranked.sort(key=lambda t: (-t[0], t[1]))

    # Beragam: ambil terbaik per jenis dulu, baru sisa terbaik.
    chosen, used_jenis = [], set()
    for q, _, ref in ranked:
        if ref["jenis"] not in used_jenis:
            chosen.append(ref)
            used_jenis.add(ref["jenis"])
        if len(chosen) == n:
            break
    for q, _, ref in ranked:
        if len(chosen) >= n:
            break
        if ref not in chosen:
            chosen.append(ref)

    contoh = []
    for ref in chosen:
        ringkasan, detail = split_reference(ref["acuan_1"])
        contoh.append({
            "situasi": situasi(ref, manifest.get(ref["id"], {})),
            "jawaban": {
                "jenis": ref["jenis"],
                "ringkasan": ringkasan,
                "detail": detail,
                "teks_dalam_gambar": ref.get("teks_dalam_gambar", "").strip(),
                "keyakinan": "tinggi",
            },
        })
    return {"ids": [r["id"] for r in chosen], "contoh": contoh}


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--n", type=int, default=5, choices=[3, 4, 5])
    ap.add_argument("--run", help="dahulukan gambar yang dinilai salah/sebagian pada run ini")
    args = ap.parse_args(argv)
    paths = Paths(args.data)
    data = build(paths, args.n, args.run)
    if len(data["contoh"]) < 3:
        print(f"Baru {len(data['contoh'])} acuan yang memenuhi syarat; butuh minimal 3. fewshot.json tidak diubah.")
        return 1
    paths.fewshot.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(data['contoh'])} contoh ditulis ke {paths.fewshot}: {', '.join(data['ids'])}")
    print("Mulai ulang layanan AI agar prompt Gemini memakai contoh baru.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
