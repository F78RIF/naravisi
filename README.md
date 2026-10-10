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
2. **Load unpacked** → pilih folder `extension/`.
3. Klik ikon NaraVisi → **Daftar** akun.
4. Buka situs berita, tekan **Alt+Shift+N**.

Kontrol panel: **↑/↓** pilih · **Enter** deskripsikan · **Spasi** jeda/lanjut · **R** ulang · **S** berhenti · **L** laporkan · **Esc** tutup.

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
cd backend && npm test                         # 80 tes unit + integrasi API (SQLite di memori)
cd ai-service && python -m pytest              # 14 tes
cd e2e && npm install && npm test              # 48 skenario: extension + backend + Admin di Chromium
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
- Gambar SVG dan gambar latar CSS (`background-image`) belum dideskripsikan.
- Pintasan keyboard Chrome hanya bisa diubah di `chrome://extensions/shortcuts`; halaman Pengaturan menyimpan pilihan pengguna dan menautkan ke sana.
- HTTPS (RNF-07) berlaku saat deploy ke server; demo berjalan di localhost.
