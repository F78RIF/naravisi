# Log Agentic SDLC — NaraVisi

Setiap fase mengikuti siklus yang sama. Log ini adalah bukti proses untuk laporan IPPL.

```
Human (pemilik produk) → Requirement/Design agent → Coding agent → Testing agent → Review agent → Human approval → Release
```

---

## Fase 0 — Audit SRS & SDD (2026-10-08)

| Langkah | Pelaku | Keluaran |
|---|---|---|
| Requirement/Design | Agent | Audit SRS v1.0 + SDD v1.0: 7 temuan blocker (X1–X7), 10 perbaikan konsistensi (W1–W10), daftar kesalahan penulisan. Draf spesifikasi API. |
| Human approval | Rifat | Keputusan: freemium, model AI gratis, deadline 30 hari (ADR-01..03). |

## Fase 1 — MVP inti (2026-10-08)

**Lingkup:** RF-06..RF-12 · UC-GBR-01..07.

| Langkah | Pelaku | Keluaran |
|---|---|---|
| Design | Agent | Arsitektur sesuai SDD (Extension → Express → FastAPI). Keputusan tambahan ADR-04..06. |
| Coding | Agent | `extension/` (MV3: background, content script panel, popup), `backend/` (Express 5: validasi gambar, klien AI, error Indonesia), `ai-service/` (FastAPI: BLIP + MarianMT, provider mock). |
| Testing | Agent | Backend 21 unit test lulus · AI service 10 test logika lulus (4 uji endpoint butuh `pip install`) · E2E Chromium 17/17 skenario lulus. |
| Review | Agent | Ditemukan & diperbaiki saat uji: (1) penanda gambar & cache saat panel dibuka ulang, (2) service worker belum siap saat pertama dimuat (uji menunggu API siap). Catatan risiko: model BLIP belum diuji di lingkungan pengembang (unduhan Hugging Face tidak tersedia di sandbox agent) → **wajib diuji manual oleh human**. |
| Human approval | Rifat | ☐ Jalankan model asli di laptop, coba di 3 situs berita, isi tabel di bawah. |

### Uji manual model asli (diisi human)

| Situs | Gambar | Deskripsi NaraVisi | Waktu (dtk) | Akurat? (Y/T) |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

## Fase 0b — Finalisasi keputusan audit (2026-10-08)

| Langkah | Pelaku | Keluaran |
|---|---|---|
| Requirement | Agent | 8 pertanyaan keputusan tersisa (kuota, fitur Admin, status Premium, TTS Premium, paket, riwayat, hapus akun, revisi dokumen). |
| Human approval | Rifat | Semua dijawab → ADR-07..ADR-15. |

## Fase 2–5 — Akun, kuota, riwayat, pengaturan, laporan, Premium, Admin (2026-10-08 s.d. 09)

**Lingkup:** RF-01..05, RF-13..30.

| Langkah | Pelaku | Keluaran |
|---|---|---|
| Design | Agent | Skema MySQL v1.1 (+ padanan SQLite untuk uji), tabel rute tunggal untuk Express & node:http, keputusan ADR-16..20. |
| Coding | Agent | Backend: 9 service, 29 rute, JWT HS256 & scrypt (modul bawaan Node), klien Midtrans Snap + webhook + mode simulasi, dashboard Admin. Extension: popup akun, halaman Riwayat/Pengaturan/Premium/Profil, tombol Laporkan, pengaturan suara diterapkan ke TTS. |
| Testing | Agent | Backend 76/76 · E2E 48/48 (lihat `docs/PENGUJIAN.md`). |
| Review | Agent | Diperbaiki: normalisasi pintasan (C-01), kotak pesan menutupi formulir (C-02), kuota tidak dikembalikan saat AI gagal (C-04), balapan kuota (C-05). Penyesuaian ADR-10 (kecepatan suara untuk Gratis) diajukan ke human. |
| Human approval | Rifat | ☐ Setujui penyesuaian ADR-10 & ADR-16 · ☐ jalankan uji manual M-01..M-06. |

## Fase 6 — Pengujian (2026-10-09)

| Langkah | Pelaku | Keluaran |
|---|---|---|
| Testing | Agent | Matriks traceability 30 RF + 13 RNF, audit aksesibilitas otomatis di 6 halaman, 6 skenario uji manual dengan formulir isian. |
| Human approval | Rifat | ☐ Isi hasil M-01..M-06 di `docs/PENGUJIAN.md`. |

## Fase 7 — Evaluasi & Final (2026-10-10)

| Langkah | Pelaku | Keluaran |
|---|---|---|
| Requirement | Human | "Lanjutkan sampai Fase 7." |
| Testing / Evaluasi | Agent | Cakupan tes backend 94,9% baris; benchmark RNF-05 (p95 ≤ 3,5 ms non-login); audit aksesibilitas 0 temuan; review keamanan 5 temuan (E-01..E-05). |
| Coding | Agent | Perbaikan E-01..E-05, versi 1.0.0; skrip `bench.js` dan `demo.mjs`. |
| Testing | Agent | Backend 80/80 · E2E 48/48 setelah perbaikan. |
| Review | Agent | Video demo diperiksa per frame: diperbaiki rekaman terpotong (C-09) dan urutan deskripsi tiruan yang tidak cocok dengan gambar; kartu pembuka menyatakan bahwa model AI disimulasikan. |
| Dokumentasi | Agent | `EVALUASI.md`, `NASKAH_DEMO.md`, laporan akhir, slide presentasi. |
| Human approval | Rifat | ☐ Jalankan M-01..M-06 dan isi `EVALUASI.md` bagian 7 · ☐ gladi dengan `NASKAH_DEMO.md`. |
