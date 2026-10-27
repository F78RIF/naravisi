# Dataset Evaluasi NaraVisi

Folder: `ai-service/eval/` · Hanya pustaka standar Python + Pillow · Tes: `ai-service/tests/test_eval_*.py`

## 1. Untuk apa dataset ini — penjelasan jujur

Dataset ini dipakai untuk **dua hal saja**:

1. **Evaluasi** — mengukur seberapa akurat dan cepat deskripsi Gemini dan BLIP pada gambar yang mirip dengan
   yang dibuka pengguna (foto berita Indonesia), dengan acuan yang ditulis manusia.
2. **Few-shot (prompt tuning)** — 3–5 acuan terbaik dimasukkan ke instruksi sistem Gemini sebagai contoh gaya
   jawaban (`eval/data/fewshot.json` → `app/prompts.py`, `build_system_instruction`).

Dataset ini **TIDAK dipakai untuk melatih ulang (fine-tune) bobot model**. Bobot Gemini dan BLIP tidak berubah sama
sekali. ±150 gambar juga terlalu sedikit untuk fine-tuning yang berarti. Bila nanti ada perbaikan mutu, itu berasal
dari prompt dan contoh, dan hanya boleh diklaim bila terlihat di `laporan.md` pada gambar yang **bukan** contoh few-shot.

## 2. Target isi

| Kategori | Target | Contoh |
|---|---|---|
| Orang | ±40 | warga di lokasi banjir, atlet, petugas |
| Hewan | ±25 | satwa di taman nasional, hewan peliharaan |
| Tempat | ±30 | jalan, pasar, bangunan, pemandangan |
| Benda | ±25 | makanan, kendaraan, alat |
| Teks / grafik | ±30 | infografis, grafik harga, tangkapan layar, poster |
| **Jumlah** | **±150** | dari **≥ 3 situs berita** yang berbeda |

Usahakan setiap situs menyumbang paling banyak setengah dari dataset supaya hasilnya tidak hanya mencerminkan gaya
satu redaksi.

## 3. Alur kerja

```text
sources.txt ──collect.py──▶ data/images/*.jpg + data/manifest.csv
                                  │
                     annotate.py (fase "acuan", tanpa keluaran model)
                                  ▼
                           data/references.csv
                                  │
         run_eval.py predict (gemini / blip / mock / http)   ──▶ data/predictions/<run>.jsonl
                                  │
                     annotate.py (fase "nilai": 1 Akurat · 2 Sebagian · 3 Salah)
                                  ▼
                            data/ratings.csv
                                  │
          run_eval.py score  ──▶ data/reports/laporan.md
          make_fewshot.py    ──▶ data/fewshot.json ──▶ prompt Gemini (setelah layanan AI dimulai ulang)
```

Semua perintah dijalankan dari folder `ai-service` dengan venv aktif:

```bash
# 1. Kumpulkan gambar
copy eval\sources.example.txt eval\sources.txt        # lalu isi URL artikel
python -m eval.collect --sources eval/sources.txt     # atau: --folder D:/foto-sendiri

# 2. Tulis acuan (buka http://127.0.0.1:8765/)
python -m eval.annotate --annotator rifat

# 3. Jalankan model (contoh 10 gambar)
python -m eval.run_eval predict --provider gemini --run gemini-1 --limit 10
python -m eval.run_eval predict --provider blip   --run blip-1   --limit 10

# 4. Nilai keluaran di alat anotasi (fase "nilai"), lalu hitung skor
python -m eval.run_eval score --runs gemini-1 blip-1

# 5. (opsional) Buat contoh few-shot, mulai ulang layanan AI, lalu ulangi langkah 3–4 dengan nama run baru
python -m eval.make_fewshot --n 5 --run gemini-1
```

### 3.1 `collect.py`

- Membaca URL artikel di `sources.txt` atau gambar di folder lokal.
- **Mematuhi `robots.txt`** setiap situs. Bila `robots.txt` tidak bisa dibaca karena galat jaringan, situs itu dilewati.
  Bila jawabannya 401/403, semua halaman dianggap dilarang.
- **Jeda minimal 1 detik** antar-permintaan ke situs yang sama. User-Agent menyebut tujuannya.
- Filternya mengikuti semangat filter extension: sisi terpendek **≥ 150 px**, bukan SVG/ICO, bukan ikon/logo/avatar/iklan
  (dikenali dari nama file, kelas, dan id), bukan `role="presentation"`/`aria-hidden`, bukan `data:` URL. Duplikat dibuang
  (SHA-1 berkas yang sama, atau dHash dengan selisih ≤ 4 bit untuk gambar yang sama tetapi ukurannya lain).
  Catatan: batas di extension lebih longgar (100 px) karena di sana pengguna sendiri yang memilih gambar.
- Gambar disimpan sebagai JPEG kualitas 85 dengan sisi terpanjang **≤ 1280 px** (PNG transparan diberi latar putih).
- Untuk setiap gambar, `manifest.csv` mencatat URL gambar & artikel, situs, ukuran, hash, alt asli, `<figcaption>`, dan judul halaman.

### 3.2 `annotate.py`

Server lokal `http.server` yang **hanya listen di 127.0.0.1**. Server menolak Host asing (anti DNS rebinding) dan
menolak POST tanpa header khusus (anti formulir lintas situs). Semua teks di-escape, gambar hanya dilayani lewat
ID manifest, dan setiap perubahan **tersimpan otomatis** ke CSV.

- **Fase "acuan"**: gambar + konteks halaman (judul, keterangan, alt asli), **tanpa keluaran model** supaya acuan tidak
  ikut terpengaruh model. Isian: jenis gambar, acuan 1 (wajib), acuan 2 (penulis kedua, opsional), teks di dalam gambar.
- **Fase "nilai"**: keluaran satu run ditampilkan di samping acuan. Tombol 1 = Akurat, 2 = Sebagian, 3 = Salah,
  lalu otomatis lanjut ke gambar berikutnya. Alt+N / Alt+P untuk berpindah gambar. Status dibacakan lewat `aria-live`.

### 3.3 `run_eval.py`

- `predict`: provider `gemini` / `blip` / `mock` memakai kode layanan AI yang sama dengan produksi (`app.main.build_service`)
  **tanpa provider cadangan**, supaya hasil Gemini tidak tercampur BLIP. Provider `http` memanggil `/caption` layanan yang
  sedang berjalan. Alt/keterangan/judul ikut dikirim sebagai konteks seperti di extension (`--no-context` untuk mematikannya).
  Bawaan untuk Gemini adalah jeda 4 dtk antar-gambar (batas RPM tingkat gratis). Galat ikut dicatat. Setelah 3 kali
  `MODEL_BUSY` berturut-turut (kuota habis), proses berhenti. Bila dijalankan ulang, gambar yang sudah berhasil dilewati.
  Kunci API dibaca dari `ai-service/.env`, tidak pernah dicetak, dan disamarkan bila muncul di pesan galat.
- `score` menghasilkan `laporan.md` berisi:
  - **Akurasi penilaian manusia**: proporsi Akurat, dan Akurat+Sebagian, dengan **interval Wilson 95%**.
  - **Akurasi jenis gambar** dibanding jenis di acuan (BLIP tidak memberi jenis, jadi ditulis "–").
  - **Latensi** p50/p95 dan **% ≤ 5 dtk** (target RNF-04).
  - **BLEU-1..4, ROUGE-L, CIDEr-D** terhadap acuan. Kandidat = ringkasan + detail. Implementasinya ada di `eval/metrics.py`
    dan diuji dengan nilai yang dihitung tangan.
  - **Perbandingan antar-run**, berpasangan pada gambar yang dinilai di kedua run (A lebih baik / seri / B lebih baik).
  - Daftar galat per kode dan contoh keluaran.
  - Gambar yang dipakai sebagai contoh few-shot **otomatis dikeluarkan** dari penilaian (`--include-fewshot` untuk memasukkannya).

### 3.4 `make_fewshot.py`

Memilih 3–5 acuan yang lengkap, dengan ringkasan 6–20 kata dan jenis gambar sebisa mungkin berbeda. Acuan yang punya
acuan kedua atau teks di dalam gambar didahulukan. Dengan `--run`, gambar yang dinilai Salah/Sebagian pada run itu ikut
didahulukan. Hasilnya `data/fewshot.json` (`{"ids": [...], "contoh": [{"situasi", "jawaban"}]}`), yang dibaca `load_fewshot`
saat layanan AI start. Log start menyebut jumlah contohnya: *"Provider utama: Gemini … (5 contoh few-shot)"*.
Bila berkas tidak ada atau rusak, Gemini berjalan tanpa contoh.

## 4. Pedoman menulis acuan

1. **Kalimat pertama = ringkasan, ≤ 20 kata**: subjek utama → kegiatan → latar.
   *"Dua petugas mendorong perahu karet berisi warga di jalan yang terendam banjir."*
2. **Lalu 1–2 kalimat detail** yang penting bagi pendengar: warna, suasana, jumlah, posisi. Jangan mengulang ringkasan.
3. **Teks di gambar** ditulis di kolom terpisah, berurutan atas → bawah, kiri → kanan, satu baris per baris.
4. **Grafik/infografis**: sebut judul, apa yang dibandingkan, dan kesimpulan utamanya.
5. **Jangan menebak identitas** (nama, tokoh terkenal), usia pasti, ras, agama, atau kondisi kesehatan, meskipun keterangan
   artikel menyebutnya. Cukup "seorang pria berbaju batik".
6. Jangan memulai dengan "Gambar ini menunjukkan…". Pakai bahasa Indonesia sederhana yang enak didengar.
7. Tulis acuan **sebelum** melihat keluaran model mana pun. Bila ada dua penulis, acuan 2 ditulis tanpa melihat acuan 1.
8. **Penilaian**: *Akurat* = benar dan cukup lengkap untuk memahami gambar · *Sebagian* = inti benar tetapi ada yang kurang
   atau keliru kecil · *Salah* = objek utama salah, ada halusinasi penting, atau menyesatkan.

## 5. Hak cipta & privasi

- `data/images/`, `data/predictions/`, dan `eval/sources.txt` ada di `.gitignore` sehingga **gambar berita tidak pernah
  masuk repo**. Yang di-commit hanya metadata (`manifest.csv`: URL dan teks pendek dari halaman), acuan buatan kita,
  penilaian, `fewshot.json`, dan laporan.
- Gambar dipakai untuk evaluasi internal tugas kuliah, bukan untuk diterbitkan ulang. Hapus `data/images/` setelah selesai.
- Dengan `--provider gemini`, gambar dikirim ke Google. Pada tingkat gratis AI Studio, data itu dapat dipakai Google untuk
  meningkatkan produknya, jadi **jangan memasukkan foto pribadi** ke dataset.
- Pengumpulan bersifat kecil dan sopan: robots.txt dipatuhi, ada jeda ≥ 1 dtk, maks. 5 gambar per artikel, dan tanpa login atau paywall.

## 6. Keterbatasan

- Satu atau dua penulis acuan → bias gaya penulis. Interval Wilson pada n ±10–150 lebar, jadi bacalah sebagai perkiraan.
- BLEU/CIDEr dirancang untuk banyak acuan per gambar (COCO: 5). Dengan 1–2 acuan, skornya rendah dan berisik, jadi
  **penilaian manusia adalah ukuran utama**.
- Metrik dihitung dengan implementasi sendiri (tanpa pycocoevalcap/Java). Rumusnya mengikuti makalah aslinya, tetapi
  tokenisasinya sederhana (huruf kecil, tanpa tanda baca, tanpa stemming), sehingga angkanya tidak bisa dibandingkan
  langsung dengan angka di makalah.
