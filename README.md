# NaraVisi

Browser extension berbasis AI yang mendeskripsikan gambar di halaman web dan membacakannya dengan suara, untuk pengguna tunanetra. Tugas mata kuliah IPPL — Rifat Arifaldo (11241078).

```
Halaman web ──Alt+Shift+N──▶ Extension (scan, pilih, panel, TTS)
                                   │ gambar (base64) + token JWT
                                   ▼
                    Backend Express 5 ── MySQL 8.4
                    /api/v1  (akun, kuota, riwayat, pengaturan, laporan, Premium, Admin)
                       │                      │
                       ▼                      ▼
          Layanan AI FastAPI            Midtrans Snap (Sandbox)
          BLIP + terjemahan ID          atau mode simulasi
```

| Folder | Isi | Stack (SRS 2.4) |
|---|---|---|
| `extension/` | Chrome Extension: panel deskripsi, popup akun, halaman Riwayat/Pengaturan/Premium/Profil | Manifest V3, JavaScript ES2022, Web Speech API |
| `backend/` | REST API + dashboard Admin (`/admin/`) | Node.js 22, Express 5, MySQL 8.4 (`mysql2`) |
| `ai-service/` | Image captioning | Python 3.12, FastAPI 0.115, BLIP + MarianMT (gratis, lokal) |
| `e2e/` | Uji end-to-end di Chromium | Playwright |
| `docs/` | API, keputusan desain, pengujian, log Agentic SDLC | – |

## Progres Prototype (tahap 30%)

Fokus presentasi tahap ini: **10 dari 30 RF esensial** + kuota Gratis 10 gambar/hari. RF lain (profil, riwayat lengkap, pengaturan, laporan, Premium, Admin) juga sudah ada di kode dan ikut diuji otomatis, tetapi **tidak** menjadi fokus presentasi tahap ini.

| RF | Fitur | Status | File & fungsi utama | Cara uji |
|---|---|---|---|---|
| RF-01 | Registrasi | ✅ | `extension/shared/auth-forms.js` (`mountAuthForms`) → `backend/src/services/accountService.js` (`register`) | popup/tab sambutan → "Daftar" · e2e "registrasi dari popup" |
| RF-05 | Login | ✅ | `auth-forms.js` → `accountService.js` (`login`, batas gagal di `lib/rateLimit.js`) | popup → Masuk · `test/auth.test.js`, `security.test.js` |
| RF-06 | Pindai gambar | ✅ | `extension/content/content.js` (`scanImages`), `background.js` (`handleScanCommand`, `togglePanel`) | Alt+Shift+N di halaman berita · e2e "5 gambar ditemukan" |
| RF-07 | Daftar gambar | ✅ | `content.js` (`renderList`, `markImages`) | panel menyebut "Gambar 1 dari 5", teks alternatif |
| RF-08 | Pilih gambar | ✅ | `content.js` (`select`, `onKeyDown`) | panah ↑/↓, Home/End, klik |
| RF-09 | Kirim ke AI | ✅ | `background.js` (`requestDescription`, `imageToBase64`) → `descriptionService.js` (`describe`) → `aiClient.js` → `ai-service/app/main.py` (`/caption`) | Enter pada gambar · `descriptionService.test.js` |
| RF-10 | Terima & simpan deskripsi | ✅ | `descriptionService.js` (`describe`) + `historyService.js` | `describeQuotaHistory.test.js` |
| RF-11 | Tampilkan teks | ✅ | `content.js` (`showResult`, area `aria-live`) | teks muncul di panel |
| RF-12 | Bacakan + kontrol | ✅ otomatis · ⏳ dengar manual | `content.js` (`speak`, `togglePause`, `play`, `stopSpeech`) | tombol Putar/Jeda/Ulang/Berhenti, tombol Spasi/R/S |
| RF-13 | Simpan riwayat | ✅ | `historyService.js` (dipanggil dari `describe`) | halaman Riwayat · `describeQuotaHistory.test.js` |
| Kuota | Gratis 10/hari, reset 00.00 WITA | ✅ | `quotaService.js` (`increment`: `UPDATE … WHERE jumlah_permintaan < batas`) | gambar ke-11 ditolak · e2e "setelah 10 deskripsi" |

Rencana uji manual lengkap: `docs/PENGUJIAN.md`.

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

Audit dependensi (15 Oktober 2026): `npm audit` backend **0 kerentanan**. `pip-audit` ai-service: **23 temuan** di `starlette` 0.46 (lewat `fastapi==0.115.*`) dan `transformers` 4.57 (dibatasi `<5`). Risiko diperkecil karena ai-service hanya listen di `127.0.0.1` dan hanya menerima gambar dari backend. Upgrade ke FastAPI/transformers versi baru dijadwalkan di tahap berikutnya karena perlu uji ulang model BLIP.

## Menjalankan di laptop

Butuh: **Node.js 22.9+**, **Python 3.12**, **MySQL 8.4** (mis. lewat XAMPP/Laragon/MySQL Installer), **Google Chrome**, ±3 GB ruang kosong untuk model AI.

### 1. Layanan AI (terminal 1)

```bash
cd ai-service
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Start pertama mengunduh model BLIP (±1 GB) dan model terjemahan (±300 MB). Tunggu log **"Layanan AI siap"**. Untuk mencoba alur tanpa model, set `CAPTION_PROVIDER=mock`.

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
3. Tab **Selamat datang** terbuka otomatis dan sambutan dibacakan. Tekan **Tab** untuk masuk atau daftar (bisa juga lewat ikon NaraVisi di toolbar).
4. Buka situs berita, tekan **Alt+Shift+N**.

> **"Tidak dapat terhubung ke server NaraVisi: localhost:3000 tidak menjawab"** (titik merah "Server tidak aktif" di kaki popup) berarti backend belum berjalan: nyalakan MySQL, jalankan `npm start` di `backend/`, cek `http://localhost:3000/api/v1/health`, lalu tekan **Coba lagi**. **"Server NaraVisi menjawab, tetapi sedang bermasalah (kode 500)"** berarti backend hidup tetapi gagal; lihat log terminal backend (sering: MySQL berhenti). Alamat API diubah di **Pengaturan → Koneksi server**.

Kontrol panel: **↑/↓** pilih · **Enter** deskripsikan · **Spasi** jeda/lanjut · **R** ulang · **S** berhenti · **L** laporkan · **Esc** tutup.

**Pemandu suara** (bisa dipakai tanpa melihat layar):
- Saat dipasang: tab sambutan + sambutan suara.
- Setelah masuk/daftar: "Berhasil masuk sebagai … Jatah gratis hari ini … gambar." Sesi tersimpan sampai token kedaluwarsa.
- **Alt+Shift+N** saat belum masuk: "Anda belum masuk. Halaman masuk dibuka." Begitu juga saat sesi berakhir.
- Saat halaman dibuka: "Ada *n* gambar. Tekan Alt Shift N …", sekali per halaman. Ini hanya menghitung, tidak mendeskripsikan, dan tidak mengirim apa pun ke server. Bisa dimatikan di Pengaturan.

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
cd backend && npm test                         # 85 tes unit + integrasi API (SQLite di memori)
cd ai-service && python -m pytest              # 15 tes
cd e2e && npm install && npm test              # 63 skenario: extension + backend + Admin di Chromium
cd e2e && npm run demo                         # rekam video demo → e2e/demo/naravisi-demo.mp4
cd backend && node --no-warnings scripts/bench.js   # ukur waktu respons (RNF-05)
```

Matriks RF/RNF → tes dan rencana uji manual: `docs/PENGUJIAN.md`.

## Status

- [x] Fase 0 — Audit SRS/SDD, keputusan desain (ADR-01..15)
- [x] Fase 1 — MVP inti: scan → AI → TTS (RF-06..12)
- [x] Fase 2 — MySQL, akun JWT, kuota harian, riwayat (RF-01..05, 13..16)
- [x] Fase 3 — Pengaturan aksesibilitas & TTS, laporan (RF-17..20)
- [x] Fase 4 — Premium + Midtrans (RF-23..26)
- [x] Fase 5 — Dashboard Admin (RF-21, 22, 27..30)
- [x] Fase 6 — Pengujian otomatis lengkap; uji manual M-01..M-06 menunggu dijalankan
- [x] Fase 7 — Evaluasi (`docs/EVALUASI.md`), perbaikan keamanan, video demo, naskah demo & checklist gladi (`docs/NASKAH_DEMO.md`), laporan akhir & slide

## Batasan yang diketahui

- BLIP menghasilkan kalimat pendek berbahasa Inggris lalu diterjemahkan; kualitas terjemahan kadang kaku. Model bisa diganti lewat `CAPTION_PROVIDER` tanpa mengubah API.
- Gambar latar CSS hanya diambil dari `url(...)` pertama; gradien dan sprite ikon kecil (< 48 px) diabaikan. SVG inline dengan efek rumit (filter, font eksternal) bisa sedikit berbeda setelah diubah ke JPEG.
- Model AI di CPU: rata-rata 7,3 detik per gambar saat model dan browser berbagi satu laptop (uji M-01; target RNF-04 ≤ 5 detik). Di GPU atau server terpisah jauh lebih cepat.
- Halaman dengan sangat banyak gambar (beranda antaranews.com: ±500) menghasilkan daftar yang panjang.
- Pintasan keyboard Chrome hanya bisa diubah di `chrome://extensions/shortcuts`; halaman Pengaturan menyimpan pilihan pengguna dan menautkan ke sana.
- HTTPS (RNF-07) berlaku saat deploy ke server; demo berjalan di localhost.
