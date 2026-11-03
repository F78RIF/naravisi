"""Pemuat hasil evaluasi ai-service/eval untuk grafik (plotting/) dan notebook (notebooks/).

Sumber data, dari yang paling lengkap:
1. Berkas prediksi ai-service/eval/data/predictions/<run>.jsonl (+ references.csv, ratings.csv).
   Angkanya dihitung dengan fungsi yang sama dengan laporan (eval.run_eval.score_run), jadi tidak bisa berbeda.
   Berkas ini tidak masuk git (lihat .gitignore), jadi biasanya hanya ada di laptop yang menjalankan evaluasi.
2. Tabel "Ringkasan per run" di ai-service/eval/data/reports/laporan.md (ikut di-commit).
   Cukup untuk latensi & akurasi per run, tetapi tidak memuat rincian per jenis gambar.

Bila keduanya tidak ada, muat() mengembalikan None dan pemanggil menampilkan pesan, bukan error.
Modul ini hanya memakai pustaka standar Python.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AI_SERVICE = ROOT / "ai-service"
# NARAVISI_EVAL_DATA: folder data lain (mis. untuk menguji notebook/grafik tanpa data).
DATA = Path(os.environ.get("NARAVISI_EVAL_DATA") or AI_SERVICE / "eval" / "data")
LAPORAN = DATA / "reports" / "laporan.md"

PESAN_KOSONG = (
    "Belum ada hasil evaluasi: tidak ditemukan ai-service/eval/data/reports/laporan.md maupun "
    "ai-service/eval/data/predictions/*.jsonl.\n"
    "Jalankan dulu dari folder ai-service (lihat docs/DATASET.md):\n"
    "  python -m eval.run_eval predict --provider gemini --run gemini-1 --limit 10\n"
    "  python -m eval.run_eval score --runs gemini-1"
)


def nama_provider(model: str, run: str) -> str:
    teks = f"{model} {run}".lower()
    if "gemini" in teks:
        return "Gemini"
    if "blip" in teks:
        return "BLIP"
    return run.split("-")[0] or run


# ---------------------------------------------------------------------------
# Sumber 2: laporan.md
# ---------------------------------------------------------------------------
def _angka(sel: str) -> float | None:
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", sel.replace(",", ""))
    return float(m.group(1)) if m else None


def _persen(sel: str) -> float | None:
    x = _angka(sel) if "%" in sel.split("[")[0] else None
    return None if x is None else x / 100


def baca_laporan(path: Path = LAPORAN) -> list[dict]:
    """Baris tabel 'Ringkasan per run' → daftar dict. Kosong bila berkas/tabel tidak ada."""
    if not path.is_file():
        return []
    rows, dalam = [], False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            dalam = line.strip() == "## Ringkasan per run"
            continue
        if not dalam or not line.startswith("|") or line.startswith("|---") or line.startswith("| Run "):
            continue
        sel = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(sel) < 11:
            continue
        run, model, _fewshot, berhasil, dinilai, akurat, _lunak, jenis, p50, p95, cepat = sel[:11]
        ok, _, total = berhasil.partition("/")
        n_jenis = re.search(r"n=(\d+)", jenis)
        rows.append({
            "run": run, "model": model, "provider": nama_provider(model, run),
            "n_ok": int(_angka(ok) or 0), "n_attempted": int(_angka(total) or 0),
            "n_rated": int(_angka(dinilai) or 0), "acc": _persen(akurat),
            "jenis_acc": _persen(jenis), "jenis_n": int(n_jenis.group(1)) if n_jenis else 0,
            "p50": _angka(p50), "p95": _angka(p95), "fast": _persen(cepat),
        })
    return rows


# ---------------------------------------------------------------------------
# Sumber 1: berkas prediksi (dihitung ulang dengan kode evaluasi asli)
# ---------------------------------------------------------------------------
def _modul_eval():
    if str(AI_SERVICE) not in sys.path:
        sys.path.insert(0, str(AI_SERVICE))
    from eval import run_eval  # noqa: PLC0415  (impor setelah sys.path diatur)
    from eval.common import Paths, read_csv, read_jsonl  # noqa: PLC0415

    return run_eval, Paths, read_csv, read_jsonl


def _fewshot_ids(data: Path) -> set[str]:
    f = data / "fewshot.json"
    return set(json.loads(f.read_text(encoding="utf-8")).get("ids", [])) if f.is_file() else set()


def per_jenis(data: Path, run: str) -> list[dict]:
    """Per jenis gambar acuan: jumlah gambar, jenis tertebak benar, dinilai manusia, akurat."""
    run_eval, Paths, read_csv, read_jsonl = _modul_eval()
    paths = Paths(data)
    exclude = _fewshot_ids(data)
    refs = {r["id"]: r for r in read_csv(paths.references) if r.get("jenis") and r["id"] not in exclude}
    preds = run_eval.latest_by_id(read_jsonl(paths.prediction_file(run)))
    ratings = {r["id"]: r["nilai"] for r in read_csv(paths.ratings) if r["run"] == run}
    out: dict[str, dict] = {}
    for i, ref in refs.items():
        p = preds.get(i)
        if not p or p.get("error"):
            continue
        g = out.setdefault(ref["jenis"], {"run": run, "jenis": ref["jenis"], "n": 0, "memberi_jenis": 0,
                                          "jenis_benar": 0, "n_dinilai": 0, "akurat": 0})
        g["n"] += 1
        if p.get("jenis"):
            g["memberi_jenis"] += 1
            g["jenis_benar"] += p["jenis"] == ref["jenis"]
        if i in ratings:
            g["n_dinilai"] += 1
            g["akurat"] += ratings[i] == "akurat"
    return sorted(out.values(), key=lambda g: g["jenis"])


def dari_prediksi(data: Path, runs: list[str]) -> list[dict]:
    run_eval, Paths, _, _ = _modul_eval()
    paths = Paths(data)
    exclude = _fewshot_ids(data)
    rows = []
    for run in runs:
        r = run_eval.score_run(paths, run, exclude)
        rows.append({k: r[k] for k in ("run", "model", "n_ok", "n_attempted", "n_rated", "acc",
                                        "jenis_acc", "jenis_n", "p50", "p95", "fast")}
                    | {"provider": nama_provider(r["model"], run)})
    return rows


# ---------------------------------------------------------------------------
def muat(data: Path | None = None) -> dict | None:
    """{'sumber', 'runs': [...], 'per_jenis': [...]} atau None bila belum ada hasil evaluasi."""
    data = data or DATA
    laporan = baca_laporan(data / "reports" / "laporan.md")
    pred_dir = data / "predictions"
    ada_prediksi = sorted(p.stem for p in pred_dir.glob("*.jsonl")) if pred_dir.is_dir() else []
    runs = [r["run"] for r in laporan] or ada_prediksi
    if not runs:
        return None
    dengan_prediksi = [r for r in runs if r in ada_prediksi]
    if dengan_prediksi:
        dihitung = {r["run"]: r for r in dari_prediksi(data, dengan_prediksi)}
        dari_laporan = {r["run"]: r for r in laporan}
        rows = [dihitung.get(r) or dari_laporan[r] for r in runs]
        jenis = [g for r in dengan_prediksi for g in per_jenis(data, r)]
        sumber = "prediksi" if len(dengan_prediksi) == len(runs) else "prediksi+laporan"
    else:
        rows, jenis, sumber = laporan, [], "laporan"
    return {"sumber": sumber, "runs": rows, "per_jenis": jenis}
