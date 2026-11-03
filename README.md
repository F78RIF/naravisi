# NaraVisi

Browser extension berbasis AI yang mendeskripsikan gambar di halaman web dan membacakannya dengan suara, untuk pengguna tunanetra. Tugas mata kuliah IPPL — Rifat Arifaldo (11241078).

```
Halaman web ──Alt+Shift+K──▶ Extension (scan, pilih, panel, TTS)
                                   │ gambar (base64) + token JWT
                                   ▼
                    Backend Express 5 ── MySQL 8.4
                    /api/v1  (akun, kuota, riwayat, pengaturan, laporan, Premium, Admin)
                       │                      │
                       ▼                      ▼
          Layanan AI FastAPI            Midtrans Snap (Sandbox)
          Gemini (utama)                atau mode simulasi
          BLIP + terjemahan ID (cadangan)
```

**Versi 1.1.0** · Progres **30/30 RF (100%)** · Dokumen pendukung: alur sistem bergambar `docs/ALUR.md`, pengujian
`docs/PENGUJIAN.md`, perubahan sejak SRS/SDD v1.1 `docs/PERUBAHAN_SRS_SDD.md`, keputusan desain `docs/KEPUTUSAN.md`,
API `docs/API.md`.

| Folder | Isi | Stack (SRS 2.4) |
|---|---|---|
| `extension/` | Chrome Extension: panel deskripsi, popup akun, halaman Riwayat/Pengaturan/Premium/Profil | Manifest V3, JavaScript ES2022, Web Speech API |
| `backend/` | REST API + dashboard Admin (`/admin/`) | Node.js 22, Express 5, MySQL 8.4 (`mysql2`) |
| `ai-service/` | Image captioning | Python 3.12, FastAPI 0.162, BLIP + MarianMT (lokal) atau Gemini Flash (Google AI Studio) |
| `e2e/` | Uji end-to-end di Chromium | Playwright |
| `docs/` | API, keputusan desain, pengujian, log Agentic SDLC | – |
| `scripts/`, `plotting/`, `notebooks/`, `examples/` | Skrip proyek, grafik evaluasi, eksplorasi, halaman uji | PowerShell, Python 3.12 (matplotlib) |

## Organisasi Kode

Pedoman organisasi kode mata kuliah dipetakan ke folder NaraVisi sebagai berikut:

| Pola pedoman | Di NaraVisi | Isi |
|---|---|---|
| `source/` (kode utama) | `extension/` · `backend/src/` · `ai-service/app/` | Kode tiga komponen (lihat alasan di bawah) |
| `scripts/` (skrip per tahap) | `scripts/` · `backend/scripts/` · `ai-service/eval/` | Proyek: `start-demo.ps1` (jalankan stack + tunggu `/health`), `run-all-tests.ps1`, `paket_extension.py`, `pindai_rahasia.py`. Backend: `setup-db.js`, `bench.js`. Evaluasi AI: `collect` → `annotate` → `run_eval predict` → `run_eval score` |
| `plotting/` (grafik akhir) | `plotting/` | `buat_grafik.py` → `docs/gambar/evaluasi/*.png` (latensi p50/p95, akurasi per jenis gambar) |
| `docs/` (dokumentasi) | `docs/` | Alur, API, keputusan desain, pengujian, evaluasi, SRS/SDD |
| `notebooks/` (eksplorasi) | `notebooks/` | `eksplorasi_evaluasi.ipynb`: tabel Gemini vs BLIP |
| `tests/` (tes) | `backend/test/` · `ai-service/tests/` · `e2e/` | Unit & API (node --test), pytest, end-to-end Playwright |
| `examples/` (contoh/demo) | `examples/` | `halaman-uji.html` + panduan coba, contoh respons `/caption` |
| `README.md` | `README.md` | Dokumen ini; tiap folder baru punya README sendiri |
| `requirements.txt` | `ai-service/requirements.txt` + `requirements-dev.txt` | Python: dependensi jalan / dependensi tes-grafik-notebook. Padanan Node: `backend/package.json` dan `e2e/package.json` (+ `package-lock.json` yang mematok versi persis) |
| `LICENSE.txt` | `LICENSE.txt` + `THIRD_PARTY_NOTICES.md` | MIT untuk kode NaraVisi; lisensi huruf, model, dan pustaka pihak ketiga |

**Mengapa kode tidak disatukan di satu folder `source/`?** NaraVisi terdiri dari tiga program yang berjalan terpisah,
dengan bahasa dan alat yang berbeda: extension Chrome (JavaScript, dimuat langsung oleh Chrome dari folder
`extension/` dan dipaketkan menjadi ZIP), backend (Node.js + `package.json`), dan layanan AI (Python + venv +
`requirements.txt`). Setiap komponen punya dependensi, cara menjalankan, dan tesnya sendiri, dan berkomunikasi hanya
lewat HTTP. Dengan folder per komponen, masing-masing bisa dipasang, diuji, dan dideploy sendiri tanpa ikut
membawa dependensi komponen lain. Memindahkan semuanya ke `source/` juga akan mengubah jalur `manifest.json`, import,
dan tes yang sudah berjalan. Jadi `source/` di pedoman berpadanan dengan tiga folder kode tersebut, sedangkan folder
pendukung (`scripts/`, `plotting/`, `docs/`, `notebooks/`, `examples/`) berada di akar repo seperti pada pedoman.

```
naravisi/
├── extension/        source: Chrome Extension MV3
├── backend/          source (src/), tes (test/), skrip (scripts/)
├── ai-service/       source (app/), tes (tests/), evaluasi (eval/), requirements*.txt
├── e2e/              tes end-to-end Playwright
├── scripts/          skrip tingkat proyek (demo, semua tes, paket, pindai rahasia)
├── plotting/         grafik akhir evaluasi
├── notebooks/        eksplorasi data
├── examples/         halaman uji & contoh respons
├── docs/             dokumentasi (+ gambar/evaluasi/ hasil plotting)
├── README.md · LICENSE.txt · THIRD_PARTY_NOTICES.md
```

## Progres Prototype: 30/30 RF (100%)

Ke-30 RF di SRS v1.1 sudah diterapkan dan masing-masing punya tes otomatis. Urutannya: 10 RF di tahap 30%, 5 RF di tahap
50%, 6 RF di tahap 70%, lalu 9 RF terakhir di tahap 100%:

- **Premium yang aman (RF-24..26):** harga diambil dari database, webhook diperiksa tiga lapis, dan halaman bayar demo
  berlabel SIMULASI.
- **Admin yang aman (RF-21, RF-22, RF-27..30):** setiap rute Admin dicek di server, Admin aktif terakhir dilindungi, dan
  hapus pengguna dikonfirmasi dengan mengetik email lalu dijalankan dalam satu transaksi.

Ada dua RF yang masih menunggu konfirmasi manusia, karena bergantung pada perangkat suara (RF-12) dan akun Midtrans
Sandbox (RF-25). Langkah ujinya ada di `docs/PENGUJIAN.md` bagian 4 dengan kolom hasil yang masih kosong.

| Bukti | Hasil (2 November 2026) |
|---|---|
| Tes backend | 121/121 lulus, cakupan baris 94% |
| Tes layanan AI | 85/85 lulus |
| Tes end-to-end (extension asli di Chromium) | 113/113 lulus, termasuk alur manual Alt+Shift+K |
| Audit aksesibilitas axe-core (WCAG 2.x A/AA) | 15 audit di 9 tampilan, 0 pelanggaran |
| Kinerja non-AI (RNF-05) | p95 ≤ 68 ms (batas 2 dtk) |
| Kinerja AI (RNF-04, ≤ 5 dtk) | BLIP p50 2,8 dtk ✅ · Gemini p50 10,2 dtk ❌ (lihat Keterbatasan) |
| `npm audit` / `pip-audit` / pindai rahasia | 0 / hanya `transformers` (risiko diterima) / 0 |

| RF | Fitur | Status | File & fungsi utama | Cara uji |
|---|---|---|---|---|
| RF-01 | Registrasi | ✅ | `extension/shared/auth-forms.js` (`mountAuthForms`) → `backend/src/services/accountService.js` (`register`) | popup/tab sambutan → "Daftar" · e2e "registrasi dari popup" |
| RF-05 | Login | ✅ | `auth-forms.js` → `accountService.js` (`login`, batas gagal di `lib/rateLimit.js`) | popup → Masuk · `test/auth.test.js`, `security.test.js` |
| RF-06 | Pindai gambar | ✅ | `extension/content/content.js` (`scanImages`), `background.js` (`handleScanCommand`, `togglePanel`) | Alt+Shift+K di halaman berita · e2e "5 gambar ditemukan" |
| RF-07 | Daftar gambar | ✅ | `content.js` (`renderList`, `markImages`) | panel menyebut "Gambar 1 dari 5", teks alternatif |
| RF-08 | Pilih gambar | ✅ | `content.js` (`select`, `onKeyDown`) | panah ↑/↓, Home/End, klik |
| RF-09 | Kirim ke AI | ✅ | `background.js` (`requestDescription`, `imageToBase64`) → `descriptionService.js` (`describe`) → `aiClient.js` → `ai-service/app/main.py` (`/caption`) | Enter pada gambar · `descriptionService.test.js` |
| RF-10 | Terima & simpan deskripsi | ✅ | `descriptionService.js` (`describe`) + `historyService.js` | `describeQuotaHistory.test.js` |
| RF-11 | Tampilkan teks | ✅ | `content.js` (`showResult`, area `aria-live`) | teks muncul di panel |
| RF-12 | Bacakan + kontrol | ✅ otomatis · ⏳ dengar manual | `content.js` (`speak`, `togglePause`, `play`, `stopSpeech`) | tombol Putar/Jeda/Ulang/Berhenti, tombol Spasi/R/S |
| RF-13 | Simpan riwayat | ✅ | `historyService.js` (dipanggil dari `describe`) | halaman Riwayat · `describeQuotaHistory.test.js` |
| RF-14 | Daftar riwayat (Gratis 7 hari, Premium semua; berhalaman) | ✅ | `extension/pages/riwayat.js` (`load`) → `historyService.js` (`list`) | halaman Riwayat · e2e "UC-RWY-02" |
| RF-15 | Detail riwayat + putar ulang (jenis gambar tampil) | ✅ | `riwayat.js` (`loadDetail`, `speak`) → `historyService.js` (`get`) | tombol Detail → Enter "Putar ulang" · e2e "RF-15" |
| RF-16 | Hapus riwayat (satu & semua, dengan konfirmasi) | ✅ | `riwayat.js` (`remove`, `removeAll`) → `historyService.js` (`remove`, `removeAll`) | e2e "UC-RWY-04", "RF-16" · `describeQuotaHistory.test.js` |
| RF-17 | Halaman pengaturan | ✅ | `extension/pages/pengaturan.js` → `settingsService.js` | e2e "UC-AKS-01" · `settingsReports.test.js` |
| RF-19 | Kecepatan, nada, jenis suara + "Coba suara" | ✅ | `pengaturan.js` (penggeser ber-`aria-valuetext`), `settingsService.js` (`update`) | e2e "UC-AKS-02/03", "Coba suara" |
| AI | Gemini terstruktur (jenis, ringkasan, detail, teks_dalam_gambar, keyakinan) + cadangan BLIP | ✅ | `ai-service/app/gemini.py`, `prompts.py`, `service.py` (`CaptionRouter`) | `ai-service/tests/test_gemini.py` (klien palsu) |
| A11y | Urutan baca atas→bawah + deskripsi disuntik ke `alt` untuk NVDA; mode Baca berurutan (bawaan mati, persetujuan, satu per satu, berhenti di kuota ≤ 2, tidak jalan di chrome://, halaman extension, Incognito, halaman sandi, domain dikecualikan) | ✅ | `content.js` (`readingOrder`, `applyAlt`, `autoDescribe`), `background.js` (`autoBlockedReason`, `autoGate`) | e2e "urutan baca", "alt asli …", "baca berurutan …", "TIDAK jalan di …" |
| Eval | Dataset evaluasi sendiri + alat anotasi + metrik + few-shot Gemini | ✅ | `ai-service/eval/` (`collect.py`, `annotate.py`, `run_eval.py`, `make_fewshot.py`) | `tests/test_eval_*.py` · `docs/DATASET.md` |
| RF-02 | Lihat profil | ✅ | `pages/profil.js` → `accountService.js` (`profile`) | e2e "UC-AKUN-02" |
| RF-03 | Ubah profil (nama, email, sandi dgn sandi lama; email unik) | ✅ | `profil.js` → `accountService.js` (`updateProfile`) | e2e "RF-03" · `auth.test.js` ("RF-03: …") |
| RF-04 | Hapus akun (ketik "HAPUS" + sandi; riwayat, laporan, pengaturan, kuota ikut terhapus; token lama ditolak) | ✅ | `profil.js` → `accountService.js` (`deleteAccount`) | e2e "RF-04" · `auth.test.js` ("RF-04: …") |
| RF-18 | Bahasa & pintasan (pintasan AKTIF dari `chrome.commands.getAll()`; kosong → "Pintasan belum diatur" + tautan `chrome://extensions/shortcuts`) | ✅ | `pengaturan.js`, `shared/guide.js` (`currentShortcut`, `openShortcutsPage`) | e2e "RF-18" (3 skenario) |
| RF-20 | Laporkan deskripsi (alasan wajib dipilih, catatan opsional maks. 500 karakter, hanya riwayat milik sendiri) | ✅ | panel `content.js`, `riwayat.js` → `reportService.js` (`CATATAN_MAKS`) | e2e "RF-20" · `settingsReports.test.js` |
| RF-23 | Daftar paket Premium (publik, hanya paket aktif; melihat paket tidak membuat transaksi) | ✅ | `pages/premium.js` → `paymentService.js` (`listPlans`) | e2e "UC-PRM-01", "RF-23" · `premiumAdmin.test.js` |
| Kuota | Gratis 10/hari, reset 00.00 WITA | ✅ | `quotaService.js` (`increment`: `UPDATE … WHERE jumlah_permintaan < batas`) | gambar ke-11 ditolak · e2e "setelah 10 deskripsi" |
| RF-21 | Admin: daftar laporan (filter status, gambar, deskripsi, alasan, pelapor) | ✅ | `backend/public/admin/admin.js` (`loadReports`) → `reportService.js` (`list`) | dashboard → tab Laporan · e2e "UC-LAP-02" |
| RF-22 | Admin: ubah status laporan (hanya `baru`/`ditinjau` sesuai SRS; `ditinjau` wajib tindak lanjut; peninjau tercatat) | ✅ | `admin.js` → `reportService.js` (`updateStatus`) | e2e "UC-LAP-03" · `premiumAdmin.test.js` "RF-22" |
| RF-24 | Pilih paket (harga dari database; halaman bayar demo berlabel **SIMULASI**) | ✅ | `pages/premium.js` → `paymentService.js` (`create`), `http/pages.js` | e2e "RF-24" · `premiumAdmin.test.js` "harga selalu dari database" |
| RF-25 | Bayar & aktivasi (tanda tangan → cocokkan order & nominal dengan database → konfirmasi Status API Midtrans) | ✅ otomatis · ⏳ Sandbox manual | `paymentService.js` (`handleNotification`, `applyStatus`), `midtransClient.js` | `premiumAdmin.test.js` "RF-25: …" (6 tes) · M-04 |
| RF-26 | Status & masa aktif langganan (perpanjangan disambung, kembali Gratis saat habis) | ✅ | `subscriptionService.js` → `pages/premium.js` | e2e "UC-PRM-04" · `premiumAdmin.test.js` "W2" |
| RF-27 | Admin: tambah pengguna | ✅ | `admin.js` → `adminService.js` (`createUser`) | e2e "UC-ADM-01" |
| RF-28 | Admin: daftar & cari pengguna | ✅ | `admin.js` (`loadUsers`) → `adminService.js` (`listUsers`) | e2e "UC-ADM-02" |
| RF-29 | Admin: ubah pengguna (nonaktifkan → token ditolak; Admin aktif terakhir tidak bisa diturunkan/dinonaktifkan) | ✅ | `adminService.js` (`updateUser`, `assertNotLastAdmin`) | e2e "UC-ADM-03" · `premiumAdmin.test.js` "LAST_ADMIN", uji balapan |
| RF-30 | Admin: hapus pengguna (ketik email pengguna; Admin terakhir dilindungi; riwayat dihapus + transaksi dianonimkan dalam satu transaksi) | ✅ | `admin.js` (`confirmDelete`) → `adminService.js` (`deleteUser`) | e2e "RF-30" · `premiumAdmin.test.js` "RF-30: hapus dalam SATU transaksi" |

Rencana uji manual lengkap: `docs/PENGUJIAN.md`. Alur sistem bergambar: `docs/ALUR.md`. Dataset & evaluasi model: `docs/DATASET.md`, laporan evaluasi terbaru: `ai-service/eval/data/reports/laporan.md`, hasil uji Gemini vs BLIP: `docs/PENGUJIAN.md` bagian M-01.

### Keamanan yang sudah diterapkan

| # | Poin | Status |
|---|---|---|
| a | Kata sandi di-hash **scrypt + salt acak**; tidak ada log kata sandi/token | ✅ `lib/password.js` |
| b | `JWT_SECRET` dari env; server **menolak start** di produksi bila memakai nilai bawaan | ✅ `config.js` |
| c | Pesan login gagal seragam; **10 gagal / 15 menit → 429** | ✅ `accountService.js`, `lib/rateLimit.js` |
| d | Semua query SQL berparameter (`?`) | ✅ |
| e | Batas body **32 KB**, kecuali `/api/v1/descriptions` | ✅ `app.js`, `http/routes.js` |
| f | Format gambar dikenali dari **magic bytes**; SVG mentah ditolak (extension lebih dulu mengubah SVG menjadi JPEG); backend **tidak pernah mengunduh URL** dari klien (anti-SSRF); file gambar **tidak disimpan** | ✅ `lib/image.js` |
| g | Kuota **atomik** (`UPDATE … WHERE jumlah < batas`) | ✅ `quotaService.js` |
| h | Error ke klien tanpa stack trace | ✅ `http/dispatch.js` |
| i | Teks ke DOM memakai `textContent` (`innerHTML` hanya untuk kerangka statis panel, tanpa data) | ✅ |
| j | Token hanya di `chrome.storage.local`, tidak pernah dikirim ke halaman web/content script | ✅ |
| k | ai-service hanya listen di `127.0.0.1` | ✅ (lihat perintah `uvicorn` di bawah) |
| + | **CORS** dibatasi ke `ALLOWED_ORIGINS` (bukan `*`) | ✅ `http/cors.js` |
| + | Service worker menolak pesan dari pengirim asing & tipe pesan tak dikenal | ✅ `extension/background.js` (`rejectReason`) |
| + | Data milik orang lain (riwayat, laporan atas riwayat orang lain) → **404**, keberadaannya tidak dibocorkan | ✅ `historyService.js` (`findVisible`) |
| + | Kunci Gemini hanya ada di `ai-service/.env` (masuk `.gitignore`) dan disamarkan di semua log maupun berkas prediksi evaluasi | ✅ `app/main.py` (`RedactSecrets`), `eval/run_eval.py` |
| + | Alat anotasi dataset hanya listen di `127.0.0.1`, menolak Host asing (DNS rebinding) dan POST lintas situs | ✅ `eval/annotate.py` |
| + | Halaman HTML (dashboard Admin, halaman bayar) memakai **CSP** dan `X-Frame-Options: DENY` | ✅ `http/routes.js` (`HTML_SECURITY_HEADERS`) |
| + | **Premium**: harga selalu dari database; webhook Midtrans diperiksa tanda tangan SHA-512 → `order_id` & nominal dicocokkan dengan database → dikonfirmasi ulang ke Status API; server key hanya di `backend/.env` dan tidak pernah ada di respons API | ✅ `paymentService.js`, `midtransClient.js` |
| + | **Admin**: setiap rute `/api/v1/admin/*` dicek peran di server, dan peran dibaca dari database pada setiap permintaan; Admin aktif terakhir tidak bisa dihapus/diturunkan/dinonaktifkan; hapus pengguna wajib mengetik email dan berjalan dalam satu transaksi database | ✅ `http/dispatch.js`, `adminService.js` |
| + | Pemindai rahasia untuk berkas & seluruh riwayat git (nilai kunci tidak pernah dicetak) | ✅ `scripts/pindai_rahasia.py` |

### Privasi

- **Baca berurutan** bawaannya **mati**. Sebelum mode ini aktif, persetujuan dibacakan: gambar dikirim ke server (dan ke
  Google bila memakai Gemini) dan memakai kuota. Mode ini tidak pernah jalan di `chrome://`, halaman extension, Incognito,
  halaman dengan kolom kata sandi, atau domain pengecualian (bank, dompet digital, email; daftarnya bisa diedit di Pengaturan).
- Deskripsi manual hanya dikirim untuk gambar yang **dipilih** pengguna. File gambar tidak disimpan di server; riwayat
  hanya menyimpan teks deskripsinya.
- **Gemini tingkat gratis**: data yang dikirim dapat dipakai Google untuk meningkatkan produknya. Pakai
  `CAPTION_PROVIDER=blip` bila gambar tidak boleh keluar dari server.
- **Dataset evaluasi**: gambar (`eval/data/images/`) dan keluaran model (`eval/data/predictions/`) tidak pernah di-commit
  (hak cipta & privasi). Dataset dipakai untuk few-shot & evaluasi (prompt tuning), **bukan** untuk melatih ulang bobot model.
- **Hapus data**: pengguna bisa menghapus riwayat (satu atau semua) dan akunnya sendiri. Admin bisa menghapus pengguna.
  Dalam kedua kasus riwayat, laporan, pengaturan, dan kuota ikut terhapus. Transaksi tetap disimpan tanpa identitas
  sebagai bukti pembayaran.
- **Pemandu suara** hanya menghitung gambar di halaman. Ia tidak mengirim apa pun ke server dan bisa dimatikan di Pengaturan.

Audit dependensi (2 November 2026): `npm audit` backend & e2e **0 kerentanan**. `pip-audit` ai-service: starlette, pillow, filelock, pyasn1, setuptools, certifi sudah di-upgrade (FastAPI 0.162 / starlette 1.10). Yang tersisa hanya `transformers` 4.57 (dibatasi `<5` sampai BLIP/MarianMT diuji ulang); temuannya hanya terpicu saat memuat repo model yang tidak dipercaya, padahal layanan hanya memuat dua model tetap. Pindai rahasia (`python -I scripts/pindai_rahasia.py`): **0 temuan** di berkas maupun riwayat git. Rincian: `docs/PENGUJIAN.md` bagian 3b.

## Menjalankan di laptop

Butuh: **Node.js 22.9+**, **Python 3.12**, **MySQL 8.4** (mis. lewat XAMPP/Laragon/MySQL Installer), **Google Chrome**, ±3 GB ruang kosong untuk model AI.

### 1. Layanan AI (terminal 1)

**a. Pasang dependensi**

```bash
cd ai-service
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
pip install -r requirements-dev.txt   # opsional: tes (pytest), grafik, notebook
cp .env.example .env        # Windows: copy .env.example .env
```

**b. Isi `ai-service/.env` untuk Gemini** (provider utama, ADR-22). Buat kunci gratis di
https://aistudio.google.com/apikey, lalu isi:

```ini
CAPTION_PROVIDER=gemini
GEMINI_API_KEY=<kunci Anda>          # HANYA di berkas .env ini — jangan di kode, extension, chat, atau git
GEMINI_MODEL=<model Flash/Flash-Lite gratis yang tersedia di AI Studio>
GEMINI_MAX_OUTPUT_TOKENS=4096        # jangan diturunkan ke 1024: jawaban model "berpikir" terpotong (C-12)
FALLBACK_PROVIDER=blip               # cadangan otomatis bila Gemini gagal/kuota habis/offline (blip | mock | none)
```

**c. Jalankan**

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Gemini menjawab dalam JSON terstruktur (jenis gambar, ringkasan, detail, teks di gambar, keyakinan) yang dirangkai menjadi kalimat siap baca, mis. *"Grafik: Penjualan naik tiap bulan. … Tulisan di gambar: …"*. Saat start, BLIP dimuat di latar sebagai cadangan (unduhan pertama ±1,3 GB); layanan sudah siap memakai Gemini sebelum BLIP selesai dimuat. Log **"Layanan AI siap"** menandai layanan bisa dipakai.
Tanpa internet/kunci: `CAPTION_PROVIDER=blip` (model lokal). Untuk mencoba alur tanpa model sama sekali: `CAPTION_PROVIDER=mock`.

**Memeriksa Gemini berjalan:** buka `http://127.0.0.1:8000/health`; harus muncul `"provider": "gemini"` dan `"model"` sesuai
`GEMINI_MODEL`. Di panel extension, pembuat deskripsi tertulis "Google Gemini" (atau BLIP bila cadangan yang dipakai).
Mutu dan latensinya bisa diukur pada dataset sendiri dengan `python -m eval.run_eval predict --provider gemini --run gemini-1 --limit 10`
lalu `python -m eval.run_eval score --runs gemini-1` (lihat `docs/DATASET.md`). Bila `eval/data/fewshot.json` ada, log start
menyebut *"(n contoh few-shot)"*.

> **Privasi.** Dengan `CAPTION_PROVIDER=gemini`, gambar yang dipilih pengguna diteruskan server ke Google. Pada tingkat gratis Google AI Studio, **data tersebut dapat dipakai Google untuk meningkatkan produknya**; Gemini juga butuh internet dan punya batas kuota. File gambar tidak disimpan di server NaraVisi. Pemberitahuan yang sama tampil di halaman Pengaturan extension. Pilih `CAPTION_PROVIDER=blip` bila gambar sama sekali tidak boleh keluar dari server.

### 2. Backend (terminal 2)

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`: isi `MYSQL_PASSWORD`, `JWT_SECRET` (teks acak panjang), dan `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Lalu:

```bash
npm run db:setup     # membuat database "naravisi", tabel, paket Premium, akun Admin
npm start
```

Log menampilkan alamat API, dashboard Admin, dan mode pembayaran.

> Belum sempat memasang MySQL? Set `DB_DRIVER=sqlite` di `.env` untuk demo cepat (data di `backend/data/naravisi.sqlite`, skema identik).

### 3. Extension

1. Buka `chrome://extensions`, aktifkan **Developer mode**.
2. **Load unpacked** → pilih folder `extension/`. Salin **ID** extension ke `backend/.env`: `ALLOWED_ORIGINS=chrome-extension://<ID>`, lalu restart backend.
   Paket ZIP rilis (untuk dibagikan / Chrome Web Store) dibuat dengan `python -I scripts/paket_extension.py` →
   `dist/naravisi-extension-1.1.0.zip` (manifest di akar ZIP; `dist/` tidak masuk git). Untuk memasangnya, ekstrak ZIP
   lalu **Load unpacked** folder hasil ekstrak.
3. Tab **Selamat datang** terbuka otomatis dan sambutan dibacakan. Tekan **Tab** untuk masuk atau daftar (bisa juga lewat ikon NaraVisi di toolbar).
4. Buka situs berita, tekan **Alt+Shift+K**.
   **Alt+Shift+V** membuka popup NaraVisi. Alt+Shift+N tidak dipakai karena bentrok dengan Split View bawaan Chrome. Bila pintasan tetap "belum diatur" (bentrok dengan extension lain), atur di `chrome://extensions/shortcuts` (popup menyediakan tautan **Atur pintasan di Chrome**).

> **"Tidak dapat terhubung ke server NaraVisi: localhost:3000 tidak menjawab"** (titik merah "Server tidak aktif" di kaki popup) berarti backend belum berjalan: nyalakan MySQL, jalankan `npm start` di `backend/`, cek `http://localhost:3000/api/v1/health`, lalu tekan **Coba lagi**. **"Server NaraVisi menjawab, tetapi sedang bermasalah (kode 500)"** berarti backend hidup tetapi gagal; lihat log terminal backend (sering: MySQL berhenti). Alamat API diubah di **Pengaturan → Koneksi server**.

Kontrol panel: **↑/↓** pilih · **Enter** deskripsikan · **Spasi** jeda/lanjut · **R** ulang · **S** berhenti · **L** laporkan · **Esc** tutup.

**Pemandu suara** (bisa dipakai tanpa melihat layar):
- Saat dipasang: tab sambutan + sambutan suara.
- Setelah masuk/daftar: "Berhasil masuk sebagai … Jatah gratis hari ini … gambar." Sesi tersimpan sampai token kedaluwarsa.
- **Alt+Shift+K** saat belum masuk: "Anda belum masuk. Halaman masuk dibuka." Begitu juga saat sesi berakhir.
- Saat halaman dibuka: "Ada *n* gambar. Tekan Alt Shift K …", sekali per halaman. Ini hanya menghitung, tidak mendeskripsikan, dan tidak mengirim apa pun ke server. Bisa dimatikan di Pengaturan.
- Saat Chrome dibuka: "NaraVisi aktif. Sisa kuota hari ini …". Bila sesi berakhir, halaman masuk dibuka; bila pintasan belum diatur, Pengaturan dibuka di tombol pintasan.

**Daftar gambar** mengikuti **urutan baca pembaca layar** (urutan DOM, seperti NVDA/JAWS membaca halaman). Bila CSS menyusun ulang tampilan (flex/grid `order`, arah terbalik), dipakai posisi visual: atas → bawah (per baris 24 px), lalu kiri → kanan. Gambar di `<main>`/`<article>` didahulukan, tetap berurutan. Hanya gambar konten: sisi terpendek ≥ 100 px, bukan dekoratif (`alt=""`, `aria-hidden`, `role="presentation"`), tidak tersembunyi, bukan ikon/logo/avatar/iklan, tanpa duplikat. Label: **"Gambar 2 dari 6 · <figcaption/keterangan terdekat>"** (tanpa keterangan: alt asli → title → nama file).

**Terhubung ke pembaca layar:** setiap gambar yang sudah dideskripsikan (manual maupun otomatis) mendapat deskripsinya di gambar aslinya: tanpa alt → `alt="<deskripsi>"`; alt pendek/generik (`image`, nama file) → `alt="<alt asli>. Deskripsi NaraVisi: <deskripsi>"`; alt yang bermakna **tidak ditimpa**. Ditandai `data-naravisi="1"`. Jadi saat menelusuri halaman dengan NVDA (panah bawah, **G** = gambar berikutnya), NVDA langsung membacakan deskripsi NaraVisi, berurutan sesuai posisi gambar.

**Baca berurutan** (Pengaturan → Otomatis, bawaan **mati**, wajib persetujuan yang dibacakan karena memakai kuota & mengirim gambar ke server/Google Gemini): gambar tanpa alt bermakna diproses **satu per satu dari atas ke bawah** (bukan paralel), maks. N per halaman (bawaan 3, bisa 1–10). Gambar yang terlihat/hampir terlihat didahulukan (IntersectionObserver), lalu lanjut saat pengguna menggulir atau membaca ke bawah. Progres diumumkan dengan sopan lewat `aria-live="polite"` (tidak menyela NVDA): *"Gambar 1 dari 3 sudah dideskripsikan."* Berhenti bila sisa kuota ≤ 2 dan mengumumkan alasannya; maks. 30 deskripsi otomatis per hari. Tidak pernah jalan di `chrome://`, halaman extension, Incognito, halaman dengan `<input type="password">`, atau situs dalam daftar pengecualian (bank, dompet digital, email, WhatsApp — bisa diedit). Semua syarat diperiksa ulang di service worker. Opsi terpisah: deskripsikan saat gambar mendapat fokus Tab.

**Izin extension (manifest):**

| Izin | Alasan |
|---|---|
| `activeTab`, `scripting` | menyuntik panel dan penghitung gambar ke halaman |
| `storage` | sesi login (`chrome.storage.local`, tidak bisa dibaca situs web) dan pengaturan |
| `tts` | pemandu suara dari service worker (`chrome.tts`): tetap berbicara walau popup tertutup atau belum ada halaman yang terbuka, misalnya sambutan saat dipasang dan pengumuman jumlah gambar |
| `offscreen` | mengubah gambar SVG menjadi JPEG di dokumen offscreen (service worker tidak punya DOM untuk menggambar SVG) |
| `<all_urls>` (host) | mengambil byte gambar dari halaman mana pun untuk dideskripsikan |

**Tampilan (v2):** warna & ukuran di `extension/shared/tokens.css`, komponen di `shared/components.css`. Huruf [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) (Braille Institute, SIL OFL 1.1) disimpan lokal di `extension/fonts/` beserta `OFL.txt`; panel di halaman web menerima font lewat service worker, jadi tidak ada `web_accessible_resources` yang bisa dipakai situs untuk mendeteksi NaraVisi. Ikon PNG dibuat ulang dari SVG dengan `cd e2e && npm run icons`.

### 4. Dashboard Admin

Buka `http://localhost:3000/admin/` dan masuk dengan akun Admin dari `.env`.

### 5. Pembayaran Premium

- **Mode simulasi** (bawaan, `MIDTRANS_SERVER_KEY` kosong): tombol beli membuka halaman simulasi lokal — cocok untuk demo, tanpa tagihan.
- **Midtrans Sandbox**: daftar di dashboard.sandbox.midtrans.com, salin *Server Key* ke `MIDTRANS_SERVER_KEY`. Status pembayaran diperbarui lewat webhook (`POST /api/v1/payments/notification`, butuh URL publik seperti ngrok) **atau** otomatis saat pengguna membuka halaman Premium (cek langsung ke Midtrans) — jadi tetap jalan di localhost.

## Aturan bisnis (ringkas)

| | Gratis | Premium (Rp15.000 / 30 hari) |
|---|---|---|
| Deskripsi gambar | 10 per hari, reset 00.00 WITA | Tanpa batas |
| Riwayat | 7 hari terakhir (lama disembunyikan, bukan dihapus) | Semua |
| Suara | Suara default, kecepatan bisa diatur | Semua suara di perangkat + nada |

Detail keputusan: `docs/KEPUTUSAN.md`.

## Pengujian

```bash
powershell -ExecutionPolicy Bypass -File scripts/run-all-tests.ps1   # ketiga bagian sekaligus + ringkasan
cd backend && npm test                         # 121 tes unit + integrasi API (SQLite di memori)
cd ai-service && python -m pytest              # (butuh requirements-dev.txt) 85 tes (Gemini dengan klien palsu, metrik & dataset evaluasi; tanpa internet)
cd e2e && npm install && npm test              # 113 skenario + audit axe-core, termasuk alur manual Alt+Shift+K
cd e2e && npm run demo                         # rekam video demo → e2e/demo/naravisi-demo.mp4
cd backend && node --no-warnings scripts/bench.js   # ukur p50/p95 waktu respons (RNF-05)
cd backend && npm audit && cd ../e2e && npm audit   # kerentanan dependensi Node
python -I scripts/pindai_rahasia.py            # pindai kunci di berkas & riwayat git (keluar 1 bila ada temuan)
python -I scripts/paket_extension.py           # buat dist/naravisi-extension-<versi>.zip
python -I plotting/buat_grafik.py              # grafik evaluasi → docs/gambar/evaluasi/ (venv ai-service)
```

Coba cepat tanpa situs nyata: `examples/README.md` (halaman uji + `scripts/start-demo.ps1 -Contoh`).

Matriks RF/RNF → tes dan rencana uji manual: `docs/PENGUJIAN.md`. `pip-audit` dijalankan dari venv terpisah, lihat
`docs/PENGUJIAN.md` bagian 3b.

## Status

- [x] Fase 0 — Audit SRS/SDD, keputusan desain (ADR-01..15)
- [x] Fase 1 — MVP inti: scan → AI → TTS (RF-06..12)
- [x] Fase 2 — MySQL, akun JWT, kuota harian, riwayat (RF-01..05, 13..16)
- [x] Fase 3 — Pengaturan aksesibilitas & TTS, laporan (RF-17..20)
- [x] Fase 4 — Premium + Midtrans (RF-23..26)
- [x] Fase 5 — Dashboard Admin (RF-21, 22, 27..30)
- [x] Fase 6 — Pengujian otomatis lengkap; uji manual M-01..M-06 menunggu dijalankan
- [x] Fase 7 — Evaluasi (`docs/EVALUASI.md`), perbaikan keamanan, video demo, naskah demo & checklist gladi (`docs/NASKAH_DEMO.md`), laporan akhir & slide
- [x] Tahap 70% — verifikasi RF-02..04, RF-18, RF-20, RF-23; uji privasi Baca berurutan; dataset evaluasi & few-shot (`docs/DATASET.md`)
- [x] Tahap 100% — Langkah 0: uji ulang & evaluasi Gemini vs BLIP · Langkah 1: Premium aman (RF-24..26) · Langkah 2: Admin aman (RF-21, 22, 27..30) · Langkah 3: bukti RNF (axe-core, p50/p95, audit dependensi, pindai rahasia) · Langkah 4: dokumentasi final, versi 1.1.0, paket ZIP
- [ ] Uji manual oleh manusia: M-02..M-06 di `docs/PENGUJIAN.md` bagian 4 (NVDA, Midtrans Sandbox, pengguna tunanetra, MySQL asli). Kolom hasilnya masih kosong.

## Batasan yang diketahui

- **RNF-04 (≤ 5 detik) belum tercapai dengan Gemini.** Pada dataset evaluasi, Gemini p50 10,2 dtk dan p95 20,3 dtk karena
  model "berpikir" dulu; infografis padat teks paling lama. BLIP memenuhi target (p50 2,8 dtk), tetapi kalimatnya pendek,
  sering salah konteks, dan tidak menyebut jenis gambar. Pilihan: model Flash-Lite, `GEMINI_THINKING_BUDGET=0` (model 2.5),
  atau `CAPTION_PROVIDER=blip` bila kecepatan lebih penting.
- **Gemini tingkat gratis**: data yang dikirim dapat dipakai Google untuk meningkatkan produknya. Gemini juga butuh internet
  dan punya batas kuota; saat kuota habis (429) deskripsi otomatis dibuat BLIP.
- BLIP menghasilkan kalimat pendek berbahasa Inggris lalu diterjemahkan; kualitas terjemahan kadang kaku.
- Akurasi deskripsi pada dataset evaluasi **belum dinilai manusia** (`docs/PENGUJIAN.md` M-01). BLEU/ROUGE/CIDEr hanya
  pelengkap.
- `transformers` dibatasi < 5 dan masih punya temuan `pip-audit`. Risikonya diterima karena hanya terpicu saat memuat
  model yang tidak dipercaya (`docs/PENGUJIAN.md` 3b).
- Gambar latar CSS hanya diambil dari `url(...)` pertama; gradien dan sprite ikon kecil (< 48 px) diabaikan. SVG inline dengan efek rumit (filter, font eksternal) bisa sedikit berbeda setelah diubah ke JPEG.
- Model AI lokal di CPU: rata-rata 7,3 detik per gambar saat model dan browser berbagi satu laptop (uji 16 Oktober). Di GPU atau server terpisah jauh lebih cepat.
- Halaman dengan sangat banyak gambar (beranda antaranews.com: ±500) menghasilkan daftar yang panjang.
- Pintasan keyboard Chrome hanya bisa diubah di `chrome://extensions/shortcuts`; halaman Pengaturan menyimpan pilihan pengguna dan menautkan ke sana.
- HTTPS (RNF-07) berlaku saat deploy ke server; demo berjalan di localhost.
- Webhook Midtrans tidak bisa menjangkau `localhost`. Di laptop, status pembayaran diperbarui lewat cek langsung ke Status
  API saat halaman Premium dibuka. Pembayaran Sandbox asli belum diuji manusia (M-04).
- Uji dengan NVDA sungguhan dan pengguna tunanetra (M-03, M-05) belum dijalankan. Audit otomatis 0 pelanggaran tidak
  menjamin pengalaman yang nyaman.
