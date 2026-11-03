# Laporan & Rencana Pengujian NaraVisi (Fase 6)

Versi kode: 1.1.0 · Tanggal: 10 Oktober 2026 (diperbarui di Fase 7, 16 Oktober, dan 2 November 2026 — Langkah 3: bukti RNF, Langkah 4: rilis 1.1.0)

## 1. Ringkasan hasil uji otomatis

| Suite | Lokasi | Jumlah | Hasil | Cara menjalankan |
|---|---|---|---|---|
| Unit + integrasi API (backend) | `backend/test/` | 121 tes | **121 lulus** · cakupan baris **94,04%**, cabang 88,96%, fungsi 95,22% | `cd backend && npm test` (cakupan: `node --test --experimental-test-coverage "test/**/*.test.js"`) |
| Layanan AI (logika, Gemini, endpoint, evaluasi) | `ai-service/tests/` | 85 tes + 13 subtes | **85 lulus** | `cd ai-service && .venv\Scripts\python -m pytest` |
| End-to-end extension + backend + Admin | `e2e/run.mjs` | 113 skenario | **113 lulus** | `cd e2e && npm install && npm test` |
| Audit aksesibilitas axe-core 4.14.0 (di dalam E2E) | `e2e/run.mjs` (`axeAudit`) | 15 audit, 39 aturan WCAG 2.x A/AA | **0 pelanggaran** | ikut `npm test` di `e2e/` |
| Kinerja non-AI (p50/p95) | `backend/scripts/bench.js` | 10 endpoint × 200 (login × 50) | p95 maks. **67,9 ms** (≤ 2 dtk) | `cd backend && node --no-warnings scripts/bench.js` |
| `npm audit` | `backend/`, `e2e/` | – | **0 kerentanan** | `npm audit` |
| `pip-audit` | `ai-service/.venv` | 82 paket | 9 temuan tersisa di `transformers` (risiko diterima, bagian 3b) | lihat bagian 3b |
| Pindai rahasia | `scripts/pindai_rahasia.py` | 131 berkas + 43 commit | **0 temuan** | `python -I scripts/pindai_rahasia.py` |

Angka di atas dari jalan ulang 2 November 2026 (Langkah 3). Mesin: Windows 11, Intel i5-11400H (12 thread), RAM 8 GB,
Node.js 24.19, Python 3.12.10.

Lingkungan uji otomatis: Chromium 141 (headless, extension dimuat), Node.js 22, basis data SQLite di memori dengan skema yang sama seperti MySQL, model AI dipalsukan (teks tetap). Yang **belum** tercakup otomatis — model AI asli, MySQL sungguhan, pembaca layar, suara nyata — diuji manual di bagian 4.

Teknik yang dipakai:
- **Black-box** per use case: setiap UC diuji alur utama, alur alternatif, dan kondisi gagal.
- **Boundary value**: kuota ke-10/ke-11, pergantian hari 23.59→00.01 WITA, riwayat hari ke-7/ke-8, kecepatan suara 0.5/2.0/5, sandi 7/8 karakter.
- **Keamanan**: token palsu, token kedaluwarsa, akses lintas pengguna, akses Admin oleh pengguna biasa, tanda tangan webhook palsu, permintaan serentak (race condition kuota).
- **Audit aksesibilitas otomatis** (E2E): pemeriksaan buatan sendiri (setiap kontrol berlabel, tombol bernama, gambar
  ber-alt, satu `h1`, atribut `lang`) **ditambah axe-core** dengan aturan WCAG 2.0/2.1/2.2 level A & AA, serta rasio
  kontras token warna terang/gelap.

## 2. Matriks traceability kebutuhan fungsional

Legenda file: **A** = `backend/test/auth.test.js`, **D** = `describeQuotaHistory.test.js`, **S** = `settingsReports.test.js`, **P** = `premiumAdmin.test.js`, **I** = `image.test.js`/`aiClient.test.js`, **E** = `e2e/run.mjs`, **M** = uji manual (bagian 4).

| RF | Kebutuhan | UC | Tes | Status |
|---|---|---|---|---|
| RF-01 | Registrasi akun | UC-AKUN-01 | A: registrasi, email ganda, data tidak valid · E: registrasi dari popup | ✅ |
| RF-02 | Lihat profil | UC-AKUN-02 | A: melihat profil · E: profil Premium | ✅ |
| RF-03 | Ubah profil | UC-AKUN-03 | A: ubah nama & sandi · E: ubah nama, sandi pendek ditolak | ✅ |
| RF-04 | Hapus akun permanen | UC-AKUN-04 | A: hapus wajib konfirmasi sandi, lalu tak bisa login | ✅ |
| RF-05 | Login | UC-AKUN-05 | A: login benar/salah · E: login popup & Admin | ✅ |
| RF-06 | Memindai gambar | UC-GBR-01 | E: 5 gambar ditemukan, ikon/tersembunyi/duplikat diabaikan, halaman tanpa gambar, halaman chrome:// | ✅ |
| RF-07 | Menampilkan gambar terdeteksi | UC-GBR-02 | E: daftar menyebut teks alternatif, gambar ditandai | ✅ |
| RF-08 | Memilih gambar | UC-GBR-03 | E: panah atas/bawah, Home, klik | ✅ |
| RF-09 | Mengirim gambar ke AI | UC-GBR-04 | D: wajib login, kuota · I: validasi format/ukuran · E: AVIF→JPEG, SVG→JPEG (`<img>`, SVG inline, latar CSS), data: URL | ✅ |
| RF-10 | Menerima & menyimpan deskripsi | UC-GBR-05 | D: tersimpan ke riwayat · I: error AI dipetakan | ✅ |
| RF-11 | Menampilkan deskripsi teks | UC-GBR-06 | E: teks tampil di panel | ✅ |
| RF-12 | Membacakan + kontrol putar/jeda/ulang/berhenti | UC-GBR-07 | E: teks dikirim ke Web Speech API, tombol kontrol · M: suara nyata | ✅ otomatis · ⏳ manual |
| RF-13 | Menyimpan riwayat | UC-RWY-01 | D: riwayat tercipta; tidak tercipta bila AI gagal | ✅ |
| RF-14 | Daftar riwayat | UC-RWY-02 | D: batas 7 hari Gratis, data lama disembunyikan, paginasi, kosong · E | ✅ |
| RF-15 | Detail riwayat + putar ulang | UC-RWY-03 | D: tidak bisa lihat milik orang lain · E: putar ulang | ✅ |
| RF-16 | Hapus riwayat | UC-RWY-04 | D · E: hapus dengan konfirmasi | ✅ |
| RF-17 | Halaman pengaturan | UC-AKS-01 | S: nilai bawaan · E | ✅ |
| RF-18 | Ubah bahasa & pintasan | UC-AKS-02 | S: normalisasi, bentrok, format salah · E | ✅ |
| RF-19 | Ubah kecepatan, nada, jenis suara | UC-AKS-03 | S: Gratis kecepatan saja, Premium nada & suara · E: "Coba suara", terbuka setelah Premium | ✅ |
| RF-20 | Melaporkan deskripsi | UC-LAP-01 | S: alasan wajib, milik sendiri · E: dari panel (tombol L) | ✅ |
| RF-21 | Admin: daftar laporan | UC-LAP-02 | S · P: rute laporan wajib peran Admin (pengguna 403, tanpa login 401) · E: dashboard | ✅ |
| RF-22 | Admin: ubah status laporan | UC-LAP-03 | S: tindak lanjut wajib, peninjau tercatat · P: hanya status SRS `baru`/`ditinjau` (lainnya 400), laporan tak ada 404, peninjau yang dihapus → laporan tetap ada · E | ✅ |
| RF-23 | Daftar paket Premium | UC-PRM-01 | P: Bulanan Rp15.000/30 hari · E | ✅ |
| RF-24 | Memilih paket | UC-PRM-02 | P: paket tidak ada → 404; harga dari database, jumlah kiriman klien diabaikan; halaman bayar berlabel "SIMULASI" (judul tab, h1, tiap tombol) · E: label SIMULASI, keterangan tombol beli (aria-describedby), audit aksesibilitas halaman bayar | ✅ |
| RF-25 | Pembayaran & aktivasi Premium | UC-PRM-03 | P: simulasi, Midtrans (Snap, webhook, tanda tangan, cek status, idempoten, gagal, kedaluwarsa); webhook dicocokkan dengan database ("nominal dimanipulasi ditolak", order tak dikenal → 404) dan dikonfirmasi ulang ke Status API (pending/404/nominal beda → tidak aktif); server key tidak ada di respons · E: alur bayar lengkap · M: Sandbox asli | ✅ otomatis · ⏳ manual |
| RF-26 | Status & masa aktif langganan | UC-PRM-04 | P: perpanjangan disambung, kembali Gratis saat habis · E | ✅ |
| RF-27 | Admin: tambah pengguna | UC-ADM-01 | P · E | ✅ |
| RF-28 | Admin: daftar pengguna | UC-ADM-02 | P: daftar & cari · E | ✅ |
| RF-29 | Admin: ubah pengguna | UC-ADM-03 | P: nonaktifkan → login & token ditolak; tidak bisa nonaktifkan diri; Admin aktif terakhir tidak bisa diturunkan/dinonaktifkan (409 `LAST_ADMIN`, juga saat dua Admin saling menurunkan bersamaan); Admin yang diturunkan langsung ditolak (peran dibaca dari database) · E | ✅ |
| RF-30 | Admin: hapus pengguna | UC-ADM-04 | P: konfirmasi dengan mengetik email pengguna (kosong/salah → 400); Admin aktif terakhir tidak bisa dihapus (409, juga saat saling menghapus bersamaan); riwayat terhapus + transaksi dianonimkan dalam satu transaksi database (gagal di tengah → semua batal) · E: email salah ditolak & dibacakan, email benar → terhapus | ✅ |

**Cakupan: 30/30 RF memiliki tes otomatis.** Dua RF (RF-12, RF-25) masih butuh konfirmasi manual karena bergantung pada perangkat suara dan akun Midtrans.

## 3. Matriks kebutuhan non-fungsional

Status: ✅ terbukti otomatis · ⏳ menunggu uji manual (bagian 4, kolom hasil kosong) · ❌ diukur dan belum tercapai ·
📄 hanya didokumentasikan.

| RNF | Kebutuhan | Bukti otomatis / terukur | Bukti manual | Status |
|---|---|---|---|---|
| RNF-01 | Antarmuka sederhana | E: alur utama diuji ujung ke ujung ("ALUR MANUAL: Alt+Shift+K → panel → panah → Enter → dibacakan → Esc"); kesederhanaan hanya bisa dinilai pengguna | M-05 | ⏳ manual |
| RNF-02 | Kompatibel pembaca layar | E: axe-core 4.14.0, 15 audit di 9 tampilan (sambutan, popup, panel, Riwayat, Pengaturan, Premium, halaman bayar SIMULASI, Profil, dashboard Admin), 39 aturan WCAG A/AA yang berlaku pada tampilan itu → **0 pelanggaran**; pemeriksaan label/nama/alt/h1/lang; live region & `aria-activedescendant` diuji | M-03 (NVDA) | ✅ otomatis · ⏳ manual |
| RNF-03 | Navigasi keyboard penuh | E: panel penuh keyboard, fokus kembali setelah Esc, tab Admin pakai panah, dialog hapus Admin memfokus kolom & mengembalikan fokus saat galat · "ALUR MANUAL" Alt+Shift+K | M-03 | ✅ otomatis · ⏳ manual |
| RNF-04 | Deskripsi ≤ 5 detik | Evaluasi 1 Nov 2026 (bagian 4, M-01): BLIP p50 2,8 dtk / p95 4,1 dtk (9/9 ≤ 5 dtk); Gemini p50 10,2 dtk / p95 20,3 dtk (0% ≤ 5 dtk). Overhead backend saja (AI dipalsukan): p50 15,3 ms / p95 17,1 ms | M-01 (tabel kosong untuk penguji manusia) | ❌ belum tercapai dengan Gemini · ✅ dengan BLIP pada dataset |
| RNF-05 | Non-AI ≤ 2 detik | `bench.js` (bagian 3a): p95 tertinggi 67,9 ms (`POST /auth/login`, sengaja lambat karena scrypt); endpoint lain p95 ≤ 17,0 ms | M-06 (MySQL asli) | ✅ |
| RNF-06 | Pesan error jelas | I, D: semua kode error berpesan Indonesia · E: kuota habis, belum masuk, server mati, email konfirmasi salah | M-03 | ✅ |
| RNF-07 | HTTPS/TLS | Konfigurasi deploy (di luar cakupan demo localhost); token & kunci tidak pernah dikirim ke halaman web | – | 📄 didokumentasikan |
| RNF-08 | Sandi ter-hash | A: hash scrypt + salt, tidak memuat teks asli · pindai rahasia: 0 temuan | – | ✅ |
| RNF-09 | Autentikasi token | A: token palsu/kedaluwarsa/akun terhapus ditolak; 10 login gagal → dikunci 15 menit | – | ✅ |
| RNF-10 | Hak akses per peran | P: SETIAP rute `/api/v1/admin/*` diuji satu per satu (pengguna 403, tanpa login 401, data tidak berubah); peran dibaca dari database tiap permintaan; Admin aktif terakhir dilindungi (409); Premium-only di pengaturan | – | ✅ |
| RNF-11 | Manifest V3 | `extension/manifest.json` · E: extension dimuat di Chromium 141 | – | ✅ |
| RNF-12 | Info jelas saat AI/internet mati | D: AI mati → 503 & kuota dikembalikan · E: server mati dibacakan | M-03 | ✅ |
| RNF-13 (baru) | File gambar tidak disimpan | Kode: `descriptionService` hanya menyimpan URL & teks · E: data: URL tersimpan tanpa URL gambar | – | ✅ |
| Keamanan dependensi | Tidak ada kerentanan yang diketahui tanpa alasan | `npm audit` 0 · `pip-audit`: semua paket diperbaiki kecuali `transformers` (risiko diterima, bagian 3b) | – | ✅ dengan catatan |
| Rahasia | Tidak ada kunci di repo | `scripts/pindai_rahasia.py`: 131 berkas + 43 commit → 0 temuan | – | ✅ |

### 3a. Kinerja non-AI (RNF-05) — `backend/scripts/bench.js`, 2 November 2026

SQLite di memori, 200 baris riwayat, server `node:http` di 127.0.0.1, setiap endpoint dipanaskan 1× lalu diukur 200×
(login 50×). Waktu = kirim permintaan → respons diterima di klien uji.

| Endpoint | n | p50 (ms) | p95 (ms) | maks (ms) |
|---|---|---|---|---|
| GET /me | 200 | 15.2 | 16.9 | 19.9 |
| GET /me/quota | 200 | 15.4 | 16.7 | 23.7 |
| GET /history | 200 | 15.3 | 17.0 | 18.1 |
| GET /settings | 200 | 15.4 | 16.8 | 19.0 |
| PUT /settings | 200 | 15.3 | 16.9 | 22.8 |
| GET /plans | 200 | 15.4 | 16.4 | 17.1 |
| GET /admin/users | 200 | 15.4 | 16.6 | 23.1 |
| GET /admin/reports | 200 | 15.2 | 16.5 | 18.5 |
| POST /auth/login | 50 | 61.7 | 67.9 | 72.1 |
| POST /descriptions* | 200 | 15.3 | 17.1 | 19.1 |

\* Model AI dipalsukan: angka = overhead backend (validasi, kuota, riwayat). Hampir semua endpoint berada di sekitar
15 ms, termasuk `GET /plans` yang tidak menyentuh basis data. Jadi angka ini didominasi biaya koneksi lokal di mesin
uji, bukan kerja endpoint. Pengukuran Fase 7 di mesin lain mencatat p95 ≤ 3,5 ms. Kedua angka jauh di bawah batas 2 detik.

### 3b. Keamanan dependensi & rahasia — 2 November 2026

**npm audit**

| Folder | Sebelum | Tindakan | Sesudah |
|---|---|---|---|
| `backend/` | 2 (high: `body-parser` 2.0.0–2.3.0 DoS GHSA-27r3-jxmh-p828; moderate: `qs` ≤ 6.16.0 GHSA-6pq8-jhm2-2vcw) | `npm audit fix` (hanya lockfile, tanpa perubahan kode) | **0** |
| `e2e/` (alat uji, tidak dikirim ke pengguna) | 1 (high: `sharp` ≤ 0.35.5-rc.1, libvips/libheif/librsvg) | `sharp` ^0.33 → ^0.35.5; E2E tetap 113/113 | **0** |

**pip-audit 2.10.1** (`pip-audit --path ai-service/.venv/Lib/site-packages`, dijalankan dari venv terpisah agar venv layanan
tidak berubah)

| Paket | Sebelum | Tindakan | Sesudah |
|---|---|---|---|
| `starlette` 0.46.2 (lewat `fastapi==0.115.*`) | 7 ID | `fastapi` 0.115 → 0.162, `starlette` 1.10.0 | 0 |
| `pillow` 12.3.0 | 39 ID | → 13.0.0 | 0 |
| `filelock` 3.32.3 | 12 ID | → ≥ 4.2.1 | 0 |
| `pyasn1` 0.6.4 | 4 ID | → ≥ 0.6.5 | 0 |
| `setuptools` 78.1.0 | 3 ID | → ≥ 84.1.0 | 0 |
| `certifi` 2026.7.22 | 1 ID | → ≥ 2026.10.18 | 0 |
| `transformers` 4.57.6 | 6 ID (PYSEC-2025-217, PYSEC-2026-2288/2289/2290/3929/4174) | **tidak di-upgrade** | 6 ID (9 baris) |
| `torch` 2.14.1+cpu | – | tidak bisa diaudit (build `+cpu` tidak ada di PyPI) | – |

Batas minimum baru ditulis di `ai-service/requirements.txt`. Tes ai-service tetap 85/85 setelah upgrade.

**Risiko yang diterima — `transformers` < 5.** Keenam temuan hanya terpicu bila aplikasi (a) memuat **repo model milik
penyerang** dari Hugging Face Hub (`config.json`/`tokenizer_config.json` jahat, LightGlue, `custom_generate`), (b) memakai
`Trainer` untuk memuat checkpoint latih, atau (c) mengonversi checkpoint X-CLIP. Layanan NaraVisi hanya memuat dua repo
tetap yang ditentukan operator lewat `.env` (`Salesforce/blip-image-captioning-base`, `Helsinki-NLP/opus-mt-en-id`),
tidak memakai `Trainer` saat melayani, dan menerima **gambar** (bukan model) dari backend lewat `127.0.0.1`. Upgrade ke
transformers 5.x ditunda karena BLIP & MarianMT perlu diuji ulang. Mitigasi: jangan mengisi `BLIP_MODEL` /
`TRANSLATION_MODEL` dengan repo yang tidak dipercaya. Setelah model terunduh, layanan bisa dijalankan dengan
`HF_HUB_OFFLINE=1`.

**Pindai rahasia** (`python -I scripts/pindai_rahasia.py`). Skrip ini memindai berkas yang dilacak git **dan** setiap baris
yang pernah ditambahkan di 43 commit. Polanya: kunci Google/Gemini, kunci Midtrans, private key, token
GitHub/Slack/Hugging Face/AWS, JWT, dan penugasan `*SECRET*`/`*PASSWORD*`/`*API_KEY*`/`*SERVER_KEY*`/`*TOKEN*`. Nilai yang
ditemukan tidak pernah dicetak.

| Hasil | |
|---|---|
| Berkas dilacak dipindai | 131 |
| Berkas `.env` dilacak saat ini | tidak ada (`backend/.env`, `ai-service/.env` diabaikan lewat `*.env` di `.gitignore`) |
| Berkas `.env` di riwayat | `ai-service.env` di commit 2c7e0c2, **0 byte** (kosong), dihapus di 09dc21c |
| Temuan | **0** |

Skrip diuji dengan kunci palsu (kunci Google, kunci Midtrans, `JWT_SECRET` harfiah → terdeteksi; placeholder & kode →
diabaikan).

### 3c. Audit aksesibilitas otomatis (RNF-02, RNF-03)

`a11yAudit()` di `e2e/run.mjs` menjalankan dua pemeriksaan di setiap tampilan:

1. **Pemeriksaan buatan sendiri**: kontrol berlabel, tombol/tautan bernama, gambar ber-`alt`, tepat satu `h1`, atribut `lang`.
2. **axe-core 4.14.0** dengan tag `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. Skrip disuntik lewat DevTools
   Protocol sehingga juga berjalan di halaman extension dan halaman ber-CSP. Panel di halaman web diaudit di dalam
   shadow root-nya.

Selain itu, rasio kontras setiap pasangan token warna (tema terang & gelap) dihitung dan harus ≥ 4,5:1.

Hasil 2 November 2026: **15 audit, 39 aturan, 0 pelanggaran.** Audit axe pertama menemukan satu masalah nyata:
`label-content-name-mismatch` (WCAG 2.5.3 *Label in Name*) pada opsi daftar gambar di panel. Teks yang terlihat
("Gambar 1 dari 5" langsung disambung keterangan tanpa spasi) tidak menjadi bagian dari nama aksesibel, sehingga
menyulitkan pengguna perintah suara. Perbaikan (C-13): satu spasi di antara judul dan keterangan. Tampilan dan nama yang
dibacakan NVDA (`aria-label`) tidak berubah.

Audit otomatis **tidak** menggantikan uji dengan pembaca layar sungguhan (M-03) dan pengguna tunanetra (M-05).

## 4. Uji manual (wajib dijalankan di laptop)

Kolom hasil di bagian ini **sengaja dikosongkan** dan diisi oleh penguji manusia setelah benar-benar menjalankan langkahnya. Catatan uji yang pernah dijalankan otomatis oleh agen (bukan pengganti uji manusia) dipindah ke Lampiran A.

### M-01 — Kualitas & kecepatan model AI asli (RNF-04)
Jalankan stack lengkap (`README.md`), deskripsikan 10 gambar dari 3 situs berita. Catat waktu dari tekan Enter sampai suara mulai.

| # | Situs | Jenis gambar | Deskripsi NaraVisi | Waktu (dtk) | Akurat? (Y/Sebagian/T) |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| … | | | | | |

Lulus bila rata-rata ≤ 5 detik (setelah model termuat) dan ≥ 70% deskripsi dinilai Y/Sebagian.

**Hasil 16 Oktober 2026** (dijalankan agen; skrip Playwright memuat extension asli, backend + MySQL 8.0.30 Laragon, BLIP base + MarianMT di CPU, laptop RTX 3050 tetapi torch versi CPU). Waktu = tekan Enter → teks tampil & suara mulai diantrekan (headless, suara tidak terdengar). Gambar terbesar di halaman yang dipilih. Penilaian akurasi oleh agen setelah melihat gambarnya; **sebaiknya dikonfirmasi manusia**.

| # | Situs | Jenis gambar | Deskripsi NaraVisi | Waktu (dtk) | Akurat? |
|---|---|---|---|---|---|
| 1 | detik.com | ilustrasi OTT KPK: tangan diborgol, logo KPK | Seorang pria dalam setelan jas dan dasi berdiri di sisi jalan dengan bangunan di latar belakang. | 22,62 | Sebagian (borgol & KPK tidak disebut) |
| 2 | detik.com | dua petugas PLN di depan dinding bergrafiti | Dua orang dalam rompi oranye dan topi keras berdiri di depan gedung terbakar. | 12,22 | Y ("topi keras" = helm proyek) |
| 3 | detik.com | pria memikul tong biru sitaan KPK | Seorang pria dengan seragam polisi memegang ember biru besar. | 9,22 | Sebagian (bukan seragam polisi; tong) |
| 4 | kompas.com | ruang sidang penuh pengunjung | Sekelompok orang duduk di ruang sidang. | 7,11 | Y |
| 5 | kompas.com | dua pejabat berpeci memberi keterangan pers | Dua pria berjas dan topi berbicara ke mikrofon. | 4,14 | Y |
| 6 | kompas.com | dua pria berjas di Istana | Seorang pria dengan setelan berdiri di samping pria lain dalam setelan. | 4,28 | Y |
| 7 | antaranews.com | warga memikul kasur di dekat van biru | Sekelompok orang berjalan di sekitar van biru. | 3,66 | Sebagian (kasur tidak disebut) |
| 8 | antaranews.com | tangan memegang emas batangan | Seorang pria memegang beberapa emas batangan di tangannya. | 2,97 | Y |
| 9 | antaranews.com | pria bermasker diantar polisi | Seorang pria memakai topeng wajah dikawal oleh polisi. | 3,60 | Y ("topeng wajah" = masker) |
| 10 | antaranews.com (beranda) | konferensi pers barang bukti | Sekelompok orang berdiri di sekitar meja. | 3,15 | Sebagian |

- **Akurasi:** 6 Y, 4 Sebagian, 0 T → 100% Y/Sebagian ✅.
- **Kecepatan:** rata-rata **7,30 dtk** ❌ (median 4,21; tanpa permintaan pertama 5,59; kompas + antara saja 4,13). Model sendirian tanpa browser: 2,2–5,9 dtk (rata-rata 3,1), muat model 30,8 dtk.
- Penyebab lambat: model di CPU berbagi prosesor dengan Chromium yang sedang memuat halaman berita berat (detik paling berat; menunggu halaman tenang 15 dtk menurunkan permintaan pertama dari 19 ke 11,6 dtk); unduhan gambar CDN detik ±1,5 dtk.
- Temuan saat uji: permintaan pertama sempat **gagal** "Layanan AI terlalu lama merespons" (16–20 dtk > batas 15 dtk) → C-10.
- Rekomendasi: torch versi CUDA untuk RTX 3050, atau layanan AI di mesin terpisah.

**Hasil 1 November 2026 — dataset evaluasi (`eval/run_eval.py`)**. Dataset: 9 gambar (`eval/data/manifest.csv`), 9 punya
deskripsi acuan yang ditulis manusia lewat `eval.annotate` **sebelum** melihat keluaran model. Semua angka disalin dari
`eval/data/reports/laporan.md` (dihitung otomatis, tidak diisi tangan). Laptop 7,7 GB RAM, BLIP di CPU, Gemini lewat API
(`gemini-3.5-flash`, tanpa few-shot). Waktu = lama panggilan model saja (bukan Enter → suara seperti tabel di atas).

| Run | Keterangan | Berhasil | Jenis benar | p50 | p95 | ≤ 5 dtk | BLEU-1 | BLEU-4 | ROUGE-L | CIDEr-D |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini-1 | `GEMINI_MAX_OUTPUT_TOKENS` 1024 (bawaan lama) | 2/9 | 100% (n=1) | 9769 ms | 12044 ms | 0% | 0.337 | 0.113 | 0.384 | 0.011 |
| gemini-2 | bawaan baru 4096 (C-12) | 6/9 | 100% (n=6) | 10227 ms | 20340 ms | 0% | 0.347 | 0.078 | 0.340 | 0.355 |
| blip-1 | BLIP base + MarianMT en→id | 9/9 | – (tidak memberi jenis) | 2796 ms | 4091 ms | 100% | 0.003 | 0.001 | 0.110 | 0.010 |

- **Galat:** gemini-1 `MODEL_BAD_OUTPUT` × 7 (JSON terpotong, lihat C-12); gemini-2 `MODEL_BUSY` × 3 (img-0007..0009,
  HTTP 429 kuota Gemini gratis habis — bukan galat format). Beberapa panggilan sempat mendapat 503/504 dari Google lalu
  berhasil setelah diulang 1×.
- **Penilaian manusia: belum ada** (0 gambar dinilai di fase "nilai" `eval.annotate`), jadi akurasi Y/Sebagian untuk
  dataset ini **belum diketahui**; BLEU/ROUGE/CIDEr hanya pelengkap.
- **Kecepatan (RNF-04):** BLIP memenuhi ≤ 5 dtk pada 9/9 gambar. Gemini **tidak** (0%; p50 ±10 dtk, p95 ±20 dtk) karena
  model "berpikir" dulu. Gambar infografis padat teks paling lama (11–23 dtk).
- **Pengamatan kualitatif (belum dinilai formal):** BLIP memberi kalimat pendek dan sering salah konteks ("Poster untuk
  acara." untuk dua infografis berbeda; "idonia"). Gemini menyebut jenis, isi, dan membacakan seluruh teks di gambar —
  untuk infografis teksnya sangat panjang (>1.500 karakter).
- BLIP pertama kali **gagal dijalankan** (`DefaultCPUAllocator: not enough memory`, RAM bebas 1,5 GB); berhasil setelah
  aplikasi lain ditutup.

**Uji Gemini 3 November 2026** (dijalankan agen). Konfigurasi `.env`: `CAPTION_PROVIDER=gemini`, `FALLBACK_PROVIDER=blip`,
`GEMINI_MODEL=gemini-3.5-flash` (tanpa few-shot). Layanan dijalankan dengan `uvicorn app.main:app --host 127.0.0.1 --port 8000`
(tanpa `--env-file`). Log start: `Layanan AI siap: gemini-3.5-flash (cadangan: blip)`, lalu `Provider cadangan siap: BLIP base + MarianMT`
±20 dtk kemudian. `GET /health` → `status=ok, provider=gemini, fallback=blip, fallback_ready=true`; backend `GET /api/v1/health` → `status=ok, ai.ok=true`.
Permintaan langsung ke `POST /caption` (bukan lewat extension). `latency_ms` = waktu provider yang menjawab; "total" = waktu dari permintaan HTTP sampai jawaban.

| Gambar | Provider | Cadangan | Jenis | latency_ms | Total (ms) | Catatan |
|---|---|---|---|---|---|---|
| img-0001 | gemini | tidak | infografis | 28436 | 28492 | Gemini 504 sekali, berhasil setelah diulang 1× |
| img-0002 | blip | **ya** | – | 5491 | 24371 | Gemini 504 dua kali (`MODEL_UNAVAILABLE`), lalu otomatis pindah ke BLIP |
| img-0003 | gemini | tidak | infografis | 11164 | 11180 | – |
| img-0004 (uji cadangan) | blip | **ya** | – | 5391 | 5772 | Kunci palsu sementara di proses uji → `MODEL_AUTH` → BLIP; log `cadangan=True` |

- **Latensi rata-rata:** Gemini (2 berhasil) 19800 ms; 3 gambar utama 15030 ms (`latency_ms`) / 21348 ms (total). Masih jauh di atas
  RNF-04 (≤ 5 dtk).
- **Contoh deskripsi Gemini (img-0003, dipotong):** "Infografis: Hari Kesehatan Mental Sedunia menyajikan data kesehatan mental
  remaja, tips mengelola emosi, dan kontak layanan bantuan. Gambar berlatar putih krem dengan ilustrasi pita hijau transparan. …
  Tulisan di gambar: Hari Kesehatan Mental Sedunia | rri RADIO REPUBLIK INDONESIA | 1.101 Kasus Bunuh Diri …" (±1.900 karakter).
- **Contoh deskripsi BLIP (cadangan):** img-0002 "Poster untuk acara."; img-0004 "Kadal monitor berjalan di jalan tanah."
- **Kunci kosong:** dengan `GEMINI_API_KEY=` (kosong) di proses uji, layanan **menolak start** (`ValueError: GEMINI_API_KEY wajib
  diisi …`), sesuai desain (`app/config.py`). Jadi cadangan BLIP hanya dipakai saat Gemini gagal ketika menjawab permintaan
  (kunci salah, kuota habis, 5xx, waktu habis), dan tidak menggantikan kunci yang kosong.
- **Temuan & perbaikan:** tanpa `--env-file`, uvicorn tidak membaca `.env` sehingga layanan diam-diam memakai BLIP dengan
  `cadangan: none`. Sekarang `app/main.py` memuat `ai-service/.env` sendiri (tanpa menimpa variabel lingkungan yang sudah ada).
  Tes: `test_env_file_dimuat_tanpa_menimpa`.
- Dua instance BLIP berjalan bersamaan (port 8000 + 8001) membuat instance kedua crash (exit 139) di laptop 7,7 GB. Uji cadangan
  dijalankan setelah instance utama dihentikan sementara.

### M-02 — Respons non-AI di peramban (RNF-05)
Jalankan stack lengkap dengan MySQL (`DB_DRIVER=mysql`). Buka DevTools → Network, lalu muat halaman Riwayat, Profil,
Pengaturan, dan dashboard Admin masing-masing 5 kali. Lulus bila semua permintaan `/api/v1/*` < 2 detik.

| Halaman | Permintaan paling lambat (ms) | Lulus? (Y/T) |
|---|---|---|
| Riwayat | | |
| Profil | | |
| Pengaturan | | |
| Dashboard Admin | | |

Penguji: ________ · Tanggal: ________

### M-03 — Pembaca layar NVDA (RNF-02, RNF-03, RF-12)
Persiapan: Windows + NVDA (versi terbaru), Chrome dengan extension NaraVisi terpasang (`chrome://extensions` → Load
unpacked → `extension/`), backend + layanan AI berjalan, akun Gratis sudah masuk. Mouse tidak dipakai sama sekali.

| # | Langkah | Yang seharusnya terdengar / terjadi | Hasil (Y/T) | Catatan |
|---|---|---|---|---|
| 1 | Buka situs berita (mis. kompas.com), tekan **Alt+Shift+K** | NVDA: "NaraVisi, dialog" + "N gambar ditemukan" | | |
| 2 | Tekan **panah bawah** dua kali | "Gambar 3 dari N · …" beserta teks alternatif / keterangan | | |
| 3 | Tekan **Enter** | "Mendeskripsikan…", lalu suara NaraVisi membacakan deskripsi tanpa bertabrakan dengan NVDA | | |
| 4 | Tekan **Spasi**, lalu **R**, lalu **S** | jeda/lanjut, ulang dari awal, berhenti | | |
| 5 | Tekan **Esc** | panel tertutup, fokus kembali ke halaman | | |
| 6 | Tab ke gambar yang sudah dideskripsikan (mode baca NVDA) | NVDA membacakan deskripsi sebagai teks alternatif gambar | | |
| 7 | Buka Pengaturan (popup → Pengaturan), telusuri dengan Tab | setiap kontrol diumumkan dengan label & nilainya (penggeser: "1,2 kali") | | |
| 8 | Buka Riwayat, Tab ke "Detail" lalu "Putar ulang" | detail dibacakan, putar ulang berfungsi | | |
| 9 | Dari panel tekan **L** (Laporkan), kirim tanpa memilih alasan | pesan galat dibacakan, fokus ke pilihan alasan | | |
| 10 | Matikan backend, tekan Alt+Shift+K lalu Enter pada gambar | pesan "Tidak dapat terhubung ke server …" dibacakan | | |
| 11 | Halaman Premium → tombol beli | "SIMULASI" terdengar di tombol, judul tab, dan judul halaman bayar | | |
| 12 | Dashboard Admin → Hapus pengguna → ketik email salah → Enter | "Email tidak cocok …" dibacakan, fokus kembali ke kolom email | | |

Versi NVDA: ________ · Versi Chrome: ________ · Penguji: ________ · Tanggal: ________

Masalah yang ditemukan: ____________________

### M-04 — Midtrans Sandbox (RF-24, RF-25, RF-26)
Persiapan: akun Midtrans Sandbox. Isi `MIDTRANS_SERVER_KEY` dengan **Server Key Sandbox** di `backend/.env` (jangan di
berkas lain), lalu jalankan ulang backend. Log harus menulis "Pembayaran: sandbox".

| # | Langkah | Yang seharusnya terjadi | Hasil (Y/T) | Catatan |
|---|---|---|---|---|
| 1 | Popup → Premium → "Beli Premium Bulanan" | tab Snap Midtrans Sandbox terbuka; nominal **Rp15.000** (dari database) | | |
| 2 | Pilih QRIS → selesaikan dengan simulator pembayaran Sandbox | Midtrans: pembayaran berhasil | | |
| 3 | Kembali ke halaman Premium → "Cek status pembayaran" | status **Premium**, "Berlaku hingga" = hari ini + 30 hari | | |
| 4 | Dashboard Midtrans Sandbox → transaksi yang sama | `order_id` & nominal sama dengan tabel `transaksi` | | |
| 5 | Ulangi beli, lalu biarkan kedaluwarsa / batalkan di simulator | status tetap Gratis (atau masa aktif tidak bertambah) | | |
| 6 | (Opsional, perlu URL publik mis. ngrok) Atur Notification URL ke `…/api/v1/payments/notification` | notifikasi diterima; log tidak memuat server key | | |

Catatan: webhook dari Midtrans tidak bisa mencapai `localhost`, jadi langkah 3 memakai cek status langsung ke Status API.

Penguji: ________ · Tanggal: ________

### M-05 — Uji pengguna bersama pengguna tunanetra (RNF-01, evaluasi)
Durasi ±30 menit per peserta. Peserta memakai perangkat & pembaca layarnya sendiri. Sebelum mulai, minta persetujuan
lisan dan jelaskan bahwa yang diuji adalah aplikasinya, bukan pesertanya. Pengamat hanya mencatat, tidak membantu kecuali
peserta macet > 2 menit (catat sebagai "dibantu").

| Tugas | Berhasil tanpa bantuan? (Y/Dibantu/T) | Waktu | Catatan |
|---|---|---|---|
| T1. Daftar akun dari popup | | | |
| T2. Buka situs berita, pindai gambar dengan Alt+Shift+K | | | |
| T3. Dengarkan deskripsi gambar ke-3 | | | |
| T4. Ulangi & hentikan suara | | | |
| T5. Laporkan deskripsi yang salah | | | |
| T6. Ubah kecepatan suara | | | |
| T7. Buka Riwayat dan putar ulang satu deskripsi | | | |

Pertanyaan penutup (skala 1–5):

| Pertanyaan | Nilai |
|---|---|
| Seberapa mudah NaraVisi dipakai? | |
| Seberapa jelas deskripsi gambarnya? | |
| Seberapa nyaman suaranya? | |
| Apakah akan dipakai lagi? | |

Pembaca layar peserta: ________ · Jumlah peserta: ________ · Tanggal: ________

Masukan terbuka: ____________________

### M-06 — MySQL sungguhan
Persiapan: MySQL 8.x (mis. Laragon). Di `backend/.env` isi `DB_DRIVER=mysql` dan kredensial basis data, lalu jalankan
`npm run db:setup` dan `npm start`.

| # | Langkah | Periksa di MySQL (DBeaver / `mysql`) | Hasil (Y/T) |
|---|---|---|---|
| 1 | Daftar & masuk | baris baru di `users`, kata sandi berupa hash scrypt | |
| 2 | Deskripsikan 3 gambar | 3 baris `riwayat_deskripsi`; `kuota_harian.jumlah_permintaan` = 3 | |
| 3 | Laporkan 1 deskripsi | baris `laporan_deskripsi` berstatus `baru` | |
| 4 | Ubah kecepatan suara | `pengaturan_aksesibilitas` berubah | |
| 5 | Beli Premium (simulasi) | `transaksi` berhasil, `langganan` aktif 30 hari | |
| 6 | Admin meninjau laporan | status laporan `ditinjau`, `admin_id` & `tanggal_tinjau` terisi | |
| 7 | Admin menghapus akun uji (ketik emailnya) | riwayat & laporannya hilang; `transaksi.user_id` = NULL | |
| 8 | Dengan hanya satu Admin aktif, coba nonaktifkan / turunkan Admin itu dari akun Admin kedua yang baru saja diturunkan | ditolak (403 atau "Admin aktif terakhir …"), tetap ada 1 Admin aktif | |
| 9 | Matikan MySQL, buka Riwayat | pesan galat jelas, tidak crash; nyalakan lagi → normal | |

Versi MySQL: ________ · Penguji: ________ · Tanggal: ________

## 5. Cacat yang ditemukan & diperbaiki selama Fase 6

| # | Temuan | Perbaikan |
|---|---|---|
| C-01 | Pintasan `shift+alt+y` ditolak karena urutan modifier | Normalisasi sebelum validasi format |
| C-02 | Kotak pesan menempel di atas formulir menutupi kolom pintasan saat digulir | Kotak pesan tidak lagi `sticky` |
| C-03 | Service worker belum siap saat extension pertama dimuat (uji) | Uji menunggu API `chrome.*` siap |
| C-04 | Deskripsi gagal tetap mengurangi kuota (risiko desain) | Kuota dipesan lalu dikembalikan bila AI gagal; diuji |
| C-05 | Permintaan serentak berpotensi melewati batas kuota | `UPDATE … WHERE jumlah < batas` atomik; diuji 15 permintaan serentak |
| C-06 | (Fase 7) Login tanpa batas percobaan gagal | Dikunci 15 menit setelah 10 gagal per (email, IP) — E-01 |
| C-07 | (Fase 7) Semua rute menerima body JSON hingga ±7 MB | Batas 32 KB kecuali `/descriptions` — E-02 |
| C-08 | (Fase 7) Halaman HTML tanpa CSP | CSP & X-Frame-Options — E-03 |
| C-09 | (Fase 7) Video demo: rekaman terpotong saat extension aktif | `viewport: null` + tinggi jendela 860 di `e2e/demo.mjs` |
| C-10 | (M-01) Permintaan pertama ke model asli gagal "Layanan AI terlalu lama merespons": 16–20 dtk > `AI_TIMEOUT_MS` 15 dtk saat model CPU berbagi prosesor dengan browser | `AI_TIMEOUT_MS` bawaan 25 dtk (masih di bawah batas extension 30 dtk) + pemanasan model saat layanan AI start. Pemanasan saja tidak cukup (diuji ulang) |
| C-11 | (M-01) Thumbnail berita detik.com berupa gambar latar CSS sehingga tidak terdeteksi (3 dari 15 gambar); SVG ditolak | Pemindai mengenali `background-image`, SVG inline, dan `<img>` SVG; SVG diubah ke JPEG di dokumen offscreen |
| C-12 | (M-01, 1 Nov 2026) Gemini menolak 7 dari 9 gambar dengan "Jawaban Gemini tidak sesuai format". Diagnosis: `gemini-3.5-flash` memakai token "berpikir" dari jatah `max_output_tokens` 1024 yang sama (979 berpikir + 30 jawaban → `finish_reason=MAX_TOKENS`, JSON terpotong 116 karakter). Dengan 4096: 1881 berpikir + 581 jawaban, `STOP`, JSON utuh | Bawaan `GEMINI_MAX_OUTPUT_TOKENS` 4096 (`app/config.py`, `app/gemini.py`, `.env.example`); log menyebut "terpotong (MAX_TOKENS)" bila terjadi lagi. Tes: `test_batas_token_bawaan_cukup_untuk_model_berpikir`, `test_jawaban_terpotong_max_tokens_dicatat_jelas`. Ulang uji: 6/9 berhasil, 3 sisanya 429 kuota |
| C-13 | (Langkah 3, axe-core) Opsi daftar gambar di panel melanggar WCAG 2.5.3 *Label in Name*: teks terlihat "Gambar 1 dari 5" + keterangan disambung tanpa spasi sehingga bukan bagian dari `aria-label` | Satu spasi di antara judul & keterangan (`content.js`, `renderList`); tampilan & nama yang dibacakan NVDA tidak berubah. Dicegah berulang oleh audit axe-core di E2E |

Evaluasi lengkap (cakupan, performa, keamanan, aksesibilitas): `docs/EVALUASI.md`.

## Lampiran A — Catatan uji yang dijalankan agen (bukan uji manual)

Dicatat apa adanya agar tidak hilang. Uji ini **tidak** menggantikan kolom hasil di bagian 4, karena dijalankan
dengan skrip, bukan oleh manusia dengan perangkat sungguhan.

- **M-02, 16 Oktober 2026** (timing jaringan Playwright pada stack MySQL): `GET /history` 8–23 ms, `GET /me` 7–16 ms dari
  5 kali muat.
- **M-06, 16 Oktober 2026** (MySQL 8.0.30 Laragon; diperiksa dengan kueri SQL, bukan DBeaver): registrasi & login, 10
  deskripsi model asli (`riwayat_deskripsi`, `kuota_harian`), laporan (`laporan_deskripsi`), kecepatan suara 1.5
  (`pengaturan_aksesibilitas`), lihat/hapus riwayat, beli Premium simulasi (`transaksi` berhasil → `langganan` sampai
  2026-11-14), Admin meninjau laporan, Admin menghapus 5 akun uji (riwayat ikut terhapus, transaksi dianonimkan
  `user_id = NULL`). Permintaan yang gagal karena batas waktu tidak mengurangi kuota (9 riwayat = 9 kuota). Dijalankan
  sebelum Langkah 2, jadi belum mencakup konfirmasi email dan perlindungan Admin terakhir.
