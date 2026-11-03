# plotting/

Skrip **grafik akhir** untuk laporan/slide. Data dihitung di `ai-service/eval`; folder ini hanya membaca hasilnya
dan menggambar. Tidak ada angka yang diisi tangan.

| Berkas | Isi |
|---|---|
| `buat_grafik.py` | Menulis `docs/gambar/evaluasi/latensi_per_provider.png`, `akurasi_per_jenis.png`, dan `ringkasan.csv` |
| `data_evaluasi.py` | Pemuat data bersama (dipakai juga oleh `notebooks/eksplorasi_evaluasi.ipynb`) |

## Menjalankan

```bash
cd ai-service
pip install -r requirements-dev.txt           # sekali saja: matplotlib dkk.
cd ..
ai-service/.venv/Scripts/python -I plotting/buat_grafik.py     # macOS/Linux: ai-service/.venv/bin/python
```

Pilihan: `--data <folder eval/data lain>` dan `--keluar <folder PNG>`.

## Dari mana datanya

1. **Berkas prediksi** `ai-service/eval/data/predictions/<run>.jsonl` (+ `references.csv`, `ratings.csv`). Angka
   dihitung ulang dengan `eval.run_eval.score_run`, fungsi yang sama dengan pembuat `laporan.md`. Berkas ini tidak
   masuk git, jadi hanya ada di laptop yang menjalankan evaluasi.
2. Bila prediksi tidak ada: tabel **"Ringkasan per run"** di `ai-service/eval/data/reports/laporan.md` (ikut di-commit).
   Grafik latensi tetap dibuat; grafik per jenis gambar dilewati dengan pesan.
3. Bila keduanya tidak ada: skrip menampilkan cara membuat hasil evaluasi lalu keluar dengan kode 0 (bukan error).

## Grafik

- **Latensi per provider**: p50 dan p95 per run (detik), garis putus-putus = target RNF-04 (≤ 5 detik). Label sumbu
  menyebut provider dan jumlah gambar yang berhasil.
- **Akurasi per jenis gambar**: per jenis gambar acuan (foto, infografis, diagram, ...). Bila sudah ada penilaian
  manusia (`python -m eval.annotate`), yang digambar adalah % deskripsi *akurat*; bila belum, % label jenis gambar yang
  tepat (subjudul grafik menyebut ukuran yang dipakai). Run yang tidak memberi jenis (BLIP) disebut di bawah grafik.

Warna seri memakai palet kategorikal berurutan tetap yang sudah diperiksa untuk buta warna, dan setiap batang diberi
label angka, jadi grafik tetap terbaca tanpa membedakan warna.
