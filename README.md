# NaraVisi — MVP (Fase 1)

Browser extension berbasis AI yang mendeskripsikan gambar di halaman web dan membacakannya dengan suara, untuk pengguna tunanetra.

Alur inti yang sudah berjalan:

```
Halaman web ──Alt+Shift+N──▶ Extension (scan & pilih gambar)
                                   │ gambar (base64)
                                   ▼
                          Backend Express 5  ──▶  Layanan AI FastAPI
                          POST /api/v1/descriptions   POST /caption (BLIP + terjemahan ID)
                                   │ teks deskripsi
                                   ▼
                    Panel teks + Web Speech API (Putar / Jeda / Ulang / Berhenti)
```

| Folder | Isi | Stack (sesuai SRS 2.4) |
|---|---|---|
| `extension/` | Chrome Extension | Manifest V3, JavaScript ES2022, Web Speech API |
| `backend/` | REST API | Node.js 22, Express 5 |
| `ai-service/` | Image captioning | Python 3.12, FastAPI 0.115, BLIP + MarianMT (gratis, lokal) |
| `e2e/` | Uji end-to-end extension | Playwright + Chromium |
| `docs/` | API, keputusan, log Agentic SDLC | – |

## Menjalankan di laptop

Butuh: **Node.js 22**, **Python 3.12**, **Google Chrome**, ±3 GB ruang kosong (model AI).

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

Start pertama mengunduh model BLIP (±1 GB) dan model terjemahan (±300 MB) dari Hugging Face — tunggu sampai log menulis **"Layanan AI siap"**. Start berikutnya memakai cache.

Ingin mencoba tanpa mengunduh model? Set `CAPTION_PROVIDER=mock` di `.env` (deskripsi berupa warna dominan, hanya untuk uji alur).

### 2. Backend (terminal 2)

```bash
cd backend
npm install
cp .env.example .env
npm start            # http://localhost:3000/api/v1
```

Cek: buka `http://localhost:3000/api/v1/health` → `"ai": { "ok": true, ... }`.

### 3. Extension

1. Buka `chrome://extensions`, aktifkan **Developer mode**.
2. **Load unpacked** → pilih folder `extension/`.
3. Buka situs berita mana pun, tekan **Alt+Shift+N** (atau klik ikon NaraVisi → *Pindai gambar*).

Kontrol di panel: **↑/↓** pilih gambar · **Enter** deskripsikan · **Spasi** jeda/lanjut · **R** ulang · **S** berhenti · **Esc** tutup.

Bila shortcut bentrok, ubah di `chrome://extensions/shortcuts`. Alamat API dan bahasa deskripsi bisa diubah di popup → *Status server*.

## Pengujian

```bash
cd backend && npm test                                  # 21 unit test + 5 uji HTTP
cd ai-service && python -m pytest                       # 14 test (logika + endpoint)
cd e2e && npm install && npm test                       # 17 skenario E2E di Chromium
```

## Status fase

- [x] **Fase 1 — MVP inti**: RF-06 s.d. RF-12 (scan, daftar, pilih, kirim ke AI, terima, tampilkan, bacakan)
- [ ] Fase 2 — Database MySQL, login/register (JWT), riwayat, kuota harian
- [ ] Fase 3 — Pengaturan aksesibilitas & TTS, laporan deskripsi tidak akurat
- [ ] Fase 4 — Premium + Midtrans Sandbox
- [ ] Fase 5 — Dashboard Admin
- [ ] Fase 6 — Pengujian lengkap & uji pengguna
- [ ] Fase 7 — Evaluasi & laporan akhir

Lihat `docs/` untuk spesifikasi API, keputusan desain, dan log proses.

## Batasan MVP yang diketahui

- Belum ada login: endpoint `/descriptions` masih terbuka (ditutup di Fase 2).
- BLIP menghasilkan kalimat pendek dalam bahasa Inggris, lalu diterjemahkan; kualitas terjemahan kadang kaku.
- Gambar SVG belum didukung; gambar latar CSS (`background-image`) belum dipindai.
- Pada mode headless/tanpa suara terpasang, Web Speech API tidak mengeluarkan suara — di Chrome desktop normal suara bahasa Indonesia tersedia (Windows: pasang paket bahasa Indonesia jika belum ada).
