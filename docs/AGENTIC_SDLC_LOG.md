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
