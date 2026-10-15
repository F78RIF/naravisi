# Naskah Video Progres Prototype 30% — NaraVisi

Durasi target **±5 menit**. Fokus: 10 RF esensial + kuota Gratis, dengan **model BLIP asli** (bukan simulasi).
Naskah demo lengkap 30 RF (untuk presentasi akhir) tetap di `NASKAH_DEMO.md`.

## A. Persiapan rekaman (30 menit sebelum)

- [ ] Laragon → MySQL **Start**.
- [ ] Terminal 1: `cd ai-service` → `.venv\Scripts\activate` → `uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env`. Tunggu log **"Layanan AI siap"**.
- [ ] Terminal 2: `cd backend` → `npm start`. `backend/.env` harus berisi `ALLOWED_ORIGINS=chrome-extension://<ID>`.
- [ ] **Pemanasan:** deskripsikan 1 gambar apa saja, karena permintaan pertama lebih lambat (±5 detik di CPU).
- [ ] Tutup aplikasi berat (RAM laptop terbatas; model memakai ±2 GB).
- [ ] Hapus extension, lalu **Load unpacked** lagi. Dengan begitu tab sambutan dan suara sambutan muncul **di rekaman**. ID extension tidak berubah selama folder sama.
- [ ] Siapkan 1 artikel berita dengan 3–5 foto jelas (orang/hewan/pemandangan), misalnya `https://id.wikipedia.org/wiki/Kucing`.
- [ ] Email demo belum terdaftar, misalnya `demo1@naravisi.id`.
- [ ] Volume speaker cukup keras; perekam layar ikut merekam **audio sistem**.
- [ ] Siapkan terminal ketiga (kosong) untuk `npm test` di akhir video.

## B. Alur & kalimat

| # | Menit | Di layar | Yang diucapkan |
|---|---|---|---|
| 1 | 0:00–0:35 | Slide judul → slide masalah | "Banyak gambar di web tidak punya teks alternatif. Pengguna tunanetra hanya mendengar 'gambar' tanpa tahu isinya. NaraVisi adalah extension Chrome yang mendeskripsikan gambar dengan AI lalu membacakannya, dan bisa dipakai sepenuhnya dengan keyboard." |
| 2 | 0:35–1:10 | `docs/srs-sdd/diagram/arsitektur.png` | "Ada tiga bagian. Extension memindai dan membacakan. Backend Node.js menangani akun, kuota, dan riwayat di MySQL. Layanan AI Python menjalankan model BLIP secara lokal lalu menerjemahkannya ke bahasa Indonesia. Gambar tidak pernah disimpan, hanya teks deskripsinya." |
| 3 | 1:10–1:35 | Load unpacked → tab **Selamat datang** terbuka, suara sambutan terdengar | "Begitu dipasang, NaraVisi langsung menyapa dengan suara, jadi pengguna tunanetra tidak perlu mencari ikon di toolbar." |
| 4 | 1:35–2:00 | Tekan **Tab** → "Belum punya akun? Daftar" → isi Nama, Email, Kata sandi → Daftar. **RF-01** | "Registrasi. Kalau ada kolom yang salah, kursor pindah ke kolom itu dan kesalahannya dibacakan. Setelah daftar, langsung masuk tanpa login ulang. Suara mengumumkan jatah gratis: 10 gambar per hari." |
| 5 | 2:00–2:15 | Popup → Keluar → Masuk lagi. **RF-05** | "Login. Sesi disimpan aman di extension, jadi tidak perlu login setiap membuka Chrome." |
| 6 | 2:15–2:40 | Buka artikel → tunggu suara **"Ada n gambar"** → tekan **Alt+Shift+N**. **RF-06, RF-07** | "Saat halaman dibuka, NaraVisi hanya memberi tahu jumlah gambar, tanpa mendeskripsikan otomatis, supaya kuota tidak terpakai tanpa izin. Alt+Shift+N membuka daftar gambar. Ikon kecil dan gambar tersembunyi diabaikan." |
| 7 | 2:40–3:20 | **↓** ke gambar 2 → **Enter** → biarkan suara selesai. **RF-08 s.d. RF-11** | "Saya pilih dengan panah, lalu Enter. Gambar dikirim ke model BLIP. Deskripsinya diterima, disimpan, tampil sebagai teks, dan…" (biarkan suara membacakan) |
| 8 | 3:20–3:40 | **Spasi** (jeda) → **Spasi** (lanjut) → **R** (ulang) → **S** (berhenti). **RF-12** | "Pembacaan bisa dijeda, dilanjutkan, diulang, dan dihentikan, semuanya dari keyboard." |
| 9 | 3:40–3:55 | Popup → **Riwayat**. **RF-13** | "Setiap deskripsi tersimpan di riwayat dan bisa diputar ulang." |
| 10 | 3:55–4:25 | (lihat bagian C) deskripsikan gambar ke-10 ✅, lalu gambar ke-11 → ditolak | "Uji kuota. Supaya video singkat, penghitung kuota akun demo sudah saya majukan ke 9. Gambar ke-10 masih berhasil. Gambar ke-11 ditolak dengan pesan jelas: kuota direset pukul 00.00 WITA." |
| 11 | 4:25–4:35 | (opsional) matikan terminal ai-service → Enter pada gambar baru | "Kalau layanan AI mati, pesannya jelas dan kuota tidak berkurang." |
| 12 | 4:35–4:50 | Terminal: `cd backend && npm test` → **85 pass**; tunjukkan `57/57 skenario lulus` dari `e2e` (rekaman/screenshot) | "Ada 85 tes backend dan 57 skenario end-to-end di Chromium. Semuanya lulus." |
| 13 | 4:50–5:05 | Slide keamanan | "Empat poin keamanan utama. Pertama, kata sandi di-hash scrypt dan login dikunci setelah 10 kali gagal. Kedua, kuota dihitung atomik di database, jadi tidak bisa diakali. Ketiga, gambar dicek dari isi file, SVG ditolak, dan server tidak pernah mengunduh URL dari klien. Keempat, API hanya menerima origin extension, dan token tidak pernah keluar ke halaman web." |
| 14 | 5:05–5:20 | Slide rencana | "Tahap berikutnya: upgrade FastAPI dan transformers untuk menutup temuan pip-audit, uji dengan NVDA bersama pengguna tunanetra, lalu fitur Premium dan Admin yang kodenya sudah ada." |

## C. Uji kuota cepat (langkah 10)

Setelah langkah 7–8 (sudah ada 1 deskripsi), majukan penghitung ke 9 lewat HeidiSQL/terminal MySQL Laragon:

```sql
UPDATE kuota_harian
SET jumlah_permintaan = 9
WHERE user_id = (SELECT user_id FROM users WHERE email = 'demo1@naravisi.id')
ORDER BY tanggal DESC
LIMIT 1;   -- baris kuota hari ini (sudah ada setelah deskripsi pertama)
```

Lalu pilih gambar **yang belum pernah dideskripsikan** (panel menyimpan cache, sehingga gambar yang sama tidak memakai kuota):
1. Gambar baru → berhasil, sisa kuota **0**.
2. Gambar baru lain → **"Kuota harian Anda (10 deskripsi) sudah habis…"**.

> Sebutkan di video bahwa penghitung dimajukan. Ini jujur dan menghemat waktu.

## D. Cadangan bila gagal saat merekam

| Masalah | Tindakan |
|---|---|
| Suara sambutan tidak terdengar | Cek volume; teks yang sama tetap tampil di tab. Lanjutkan saja. |
| Deskripsi lama (>15 detik) | RAM penuh: tutup aplikasi lain, restart ai-service, lakukan pemanasan lagi. |
| "Tidak dapat terhubung ke server" | Backend mati atau MySQL belum Start. |
| Alt+Shift+N tidak bereaksi | `chrome://extensions/shortcuts` → pastikan pintasan NaraVisi terisi. |
