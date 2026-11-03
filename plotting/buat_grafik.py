"""Grafik akhir evaluasi deskripsi gambar NaraVisi → docs/gambar/evaluasi/*.png

    python -I plotting/buat_grafik.py            # dari folder repo, dengan venv ai-service
    python -I plotting/buat_grafik.py --keluar folder/lain

Membaca hasil ai-service/eval (lihat plotting/data_evaluasi.py) lalu menulis:
- latensi_per_provider.png : latensi p50 & p95 per run, dengan garis target RNF-04 (≤ 5 detik)
- akurasi_per_jenis.png    : akurasi per jenis gambar per run (penilaian manusia bila sudah ada,
                             bila belum: ketepatan label jenis gambar). Butuh berkas prediksi.
- ringkasan.csv            : angka yang digambar, untuk tabel di laporan

Bila belum ada hasil evaluasi, skrip menampilkan pesan dan keluar dengan kode 0.
Butuh matplotlib (ai-service/requirements-dev.txt).
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import data_evaluasi  # noqa: E402

KELUAR = data_evaluasi.ROOT / "docs" / "gambar" / "evaluasi"
TARGET_MS = 5000  # RNF-04

# Palet kategorikal (urutan tetap, divalidasi untuk buta warna) dan token teks/permukaan.
SERI = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
PERMUKAAN, TEKS, TEKS_2, GARIS_BANTU = "#fcfcfb", "#0b0b0b", "#52514e", "#e2e1dc"


def _gaya(plt) -> None:
    plt.rcParams.update({
        "figure.facecolor": PERMUKAAN, "axes.facecolor": PERMUKAAN, "savefig.facecolor": PERMUKAAN,
        "axes.edgecolor": GARIS_BANTU, "axes.labelcolor": TEKS_2, "xtick.color": TEKS_2, "ytick.color": TEKS_2,
        "text.color": TEKS, "font.size": 11, "axes.titlesize": 13, "axes.titleweight": "bold",
        "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "axes.grid.axis": "y",
        "grid.color": GARIS_BANTU, "grid.linewidth": 0.8, "axes.axisbelow": True,
        "legend.frameon": False,
    })


def grafik_latensi(plt, runs: list[dict], out: Path) -> Path | None:
    runs = [r for r in runs if r.get("p50") is not None]
    if not runs:
        print("Lewati latensi: tidak ada run yang berhasil.")
        return None
    fig, ax = plt.subplots(figsize=(8, 4.6), dpi=150)
    lebar = 0.36
    xs = range(len(runs))
    for k, (kunci, nama, warna) in enumerate([("p50", "p50 (median)", SERI[0]), ("p95", "p95", SERI[1])]):
        pos = [x + (k - 0.5) * lebar for x in xs]
        nilai = [r[kunci] / 1000 for r in runs]
        bars = ax.bar(pos, nilai, width=lebar, color=warna, edgecolor=PERMUKAAN, linewidth=2, label=nama)
        ax.bar_label(bars, labels=[f"{v:.1f}" for v in nilai], padding=3, color=TEKS, fontsize=9,
                     bbox={"facecolor": PERMUKAAN, "edgecolor": "none", "pad": 1})
    ax.axhline(TARGET_MS / 1000, color=TEKS_2, linestyle=(0, (4, 3)), linewidth=1.2, label="target ≤ 5 dtk (RNF-04)")
    ax.set_xticks(list(xs), [f"{r['run']}\n{r['provider']} · {r['n_ok']}/{r['n_attempted']} berhasil" for r in runs])
    ax.set_ylabel("detik per gambar")
    ax.set_title("Latensi deskripsi gambar per provider", loc="left", pad=8)
    ax.legend(loc="upper left", ncols=3)
    ax.set_ylim(0, max(max(r["p95"] for r in runs) / 1000, TARGET_MS / 1000) * 1.18)
    fig.tight_layout()
    path = out / "latensi_per_provider.png"
    fig.savefig(path)
    plt.close(fig)
    return path


def grafik_per_jenis(plt, per_jenis: list[dict], out: Path) -> Path | None:
    dinilai = any(g["n_dinilai"] for g in per_jenis)
    # Run yang tidak pernah memberi jenis (mis. BLIP) tidak bisa dinilai ketepatan jenisnya.
    runs = [r for r in dict.fromkeys(g["run"] for g in per_jenis)
            if dinilai or any(g["memberi_jenis"] for g in per_jenis if g["run"] == r)]
    if not runs:
        print("Lewati akurasi per jenis: butuh berkas prediksi (ai-service/eval/data/predictions/*.jsonl) "
              "dan acuan berjenis di references.csv.")
        return None
    dilewati = sorted({g["run"] for g in per_jenis} - set(runs))
    jenis = sorted({g["jenis"] for g in per_jenis if g["run"] in runs})
    fig, ax = plt.subplots(figsize=(8, 4.6), dpi=150)
    lebar = 0.8 / len(runs)
    for k, run in enumerate(runs):
        idx = {g["jenis"]: g for g in per_jenis if g["run"] == run}
        pos, nilai, label = [], [], []
        for x, j in enumerate(jenis):
            g = idx.get(j)
            n = (g or {}).get("n_dinilai" if dinilai else "n", 0)
            if not n:
                continue
            benar = g["akurat"] if dinilai else g["jenis_benar"]
            pos.append(x + (k - (len(runs) - 1) / 2) * lebar)
            nilai.append(benar / n * 100)
            label.append(f"{benar}/{n}")
        bars = ax.bar(pos, nilai, width=lebar, color=SERI[k % len(SERI)], edgecolor=PERMUKAAN, linewidth=2, label=run)
        ax.bar_label(bars, labels=label, padding=3, color=TEKS, fontsize=9,
                     bbox={"facecolor": PERMUKAAN, "edgecolor": "none", "pad": 1})
    ax.set_xticks(range(len(jenis)), jenis)
    ax.set_ylim(0, 135)
    ax.set_yticks(range(0, 101, 25), [f"{v}%" for v in range(0, 101, 25)])
    ukuran = "% deskripsi akurat menurut penilaian manusia" if dinilai else "% label jenis gambar tepat (deskripsi belum dinilai manusia)"
    ax.set_title("Akurasi per jenis gambar", loc="left", pad=20)
    ax.text(0, 1.01, ukuran, transform=ax.transAxes, color=TEKS_2, fontsize=9)
    if dilewati:
        ax.text(0, -0.2, f"Tidak digambar (tidak memberi jenis gambar): {', '.join(dilewati)}",
                transform=ax.transAxes, color=TEKS_2, fontsize=9)
    ax.legend(loc="upper right", ncols=min(len(runs), 3))
    fig.tight_layout()
    path = out / "akurasi_per_jenis.png"
    fig.savefig(path)
    plt.close(fig)
    return path


def tulis_csv(runs: list[dict], out: Path) -> Path:
    path = out / "ringkasan.csv"
    kolom = ["run", "provider", "model", "n_ok", "n_attempted", "n_rated", "acc", "jenis_acc", "jenis_n", "p50", "p95", "fast"]
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=kolom, extrasaction="ignore")
        w.writeheader()
        w.writerows(runs)
    return path


def main(argv: list[str] | None = None) -> int:
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=data_evaluasi.DATA, help="folder ai-service/eval/data")
    ap.add_argument("--keluar", type=Path, default=KELUAR, help="folder PNG hasil")
    args = ap.parse_args(argv)

    hasil = data_evaluasi.muat(args.data)
    if hasil is None:
        print(data_evaluasi.PESAN_KOSONG)
        return 0
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib belum terpasang. Dari folder ai-service: pip install -r requirements-dev.txt")
        return 1

    _gaya(plt)
    args.keluar.mkdir(parents=True, exist_ok=True)
    print(f"Sumber data: {hasil['sumber']} ({len(hasil['runs'])} run: {', '.join(r['run'] for r in hasil['runs'])})")
    ditulis = [grafik_latensi(plt, hasil["runs"], args.keluar), grafik_per_jenis(plt, hasil["per_jenis"], args.keluar),
               tulis_csv(hasil["runs"], args.keluar)]
    for p in ditulis:
        if p:
            print(f"ditulis: {p.relative_to(data_evaluasi.ROOT).as_posix() if p.is_relative_to(data_evaluasi.ROOT) else p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
