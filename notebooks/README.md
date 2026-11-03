# notebooks/

Tempat **eksplorasi** data: melihat-lihat hasil, mencoba ide, menyiapkan angka sebelum dijadikan skrip tetap.
Kode yang dipakai aplikasi tidak pernah ada di sini. Bila sebuah analisis sudah stabil, logikanya dipindah ke
skrip (`plotting/`, `ai-service/eval/`) dan notebook cukup memanggilnya.

| Notebook | Isi |
|---|---|
| `eksplorasi_evaluasi.ipynb` | Tabel ringkas akurasi & latensi Gemini vs BLIP dari hasil `ai-service/eval`, rincian per jenis gambar, dan pratinjau grafik di `docs/gambar/evaluasi/`. Tetap berjalan (dengan pesan) bila data evaluasi belum ada. |

Rencana berikutnya: notebook persiapan *fine-tune* BLIP (melihat sebaran jenis gambar dan panjang acuan di
`ai-service/eval/data/references.csv`) sebelum pelatihan dijadikan skrip.

## Menjalankan

Pakai venv `ai-service` (Python 3.12):

```bash
cd ai-service
pip install -r requirements-dev.txt          # matplotlib, nbclient, ipykernel, ...
cd ..
# Jalankan seluruh sel tanpa membuka Jupyter (cek semua sel lulus; berkas notebook tidak diubah):
ai-service/.venv/Scripts/python -c "import nbformat, nbclient; nb = nbformat.read('notebooks/eksplorasi_evaluasi.ipynb', 4); nbclient.NotebookClient(nb, timeout=120, resources={'metadata': {'path': 'notebooks'}}).execute(); print('notebook OK')"
```

Atau buka di VS Code / Jupyter dan pilih kernel dari `ai-service/.venv`.

Untuk mencoba tanpa data, arahkan ke folder kosong: `NARAVISI_EVAL_DATA=/folder/kosong`.

Sumber data dan cara hitung sama dengan `plotting/buat_grafik.py` (modul `plotting/data_evaluasi.py`), jadi angka
di notebook, grafik, dan `laporan.md` selalu sama.
