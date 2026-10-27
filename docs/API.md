# Spesifikasi API NaraVisi (v1)

Base URL: `http://localhost:3000/api/v1` (produksi: HTTPS, RNF-07).
Format: JSON. Error selalu berbentuk:

```json
{ "error": { "code": "IMAGE_INVALID", "message": "Pesan berbahasa Indonesia yang aman dibacakan." } }
```

## Deskripsi gambar (Fase 1)

### `GET /health`
```json
{ "status": "ok", "ai": { "ok": true, "status": "ok", "provider": "blip", "model": "Salesforce/blip-image-captioning-base + Helsinki-NLP/opus-mt-en-id" } }
```

### `POST /descriptions` — RF-09, RF-10, RF-11 (UC-GBR-04, UC-GBR-05)

Request:

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `image_base64` | string | ya | Base64 murni atau data URL. JPG, PNG, GIF, WebP, BMP. Maks 5 MB. |
| `image_url` | string | tidak | URL asli gambar (untuk riwayat). |
| `page_url` | string | tidak | URL halaman asal (untuk riwayat). |
| `lang` | `"id"` \| `"en"` | tidak | Default `"id"`. |
| `context` | object | tidak | Petunjuk dari halaman untuk AI: `{alt, caption, page_title}`, masing-masing teks ≤ 300 karakter; kunci lain dibuang. |

Response `201` (field `jenis` … `fallback` baru di Tahap 1; field lama tetap):
```json
{
  "riwayat_id": 42,
  "text": "Grafik: Penjualan toko naik setiap bulan. Batang biru tertinggi di bulan Juni. Tulisan di gambar: Penjualan 2026, Jan, Feb, Mar.",
  "text_en": "",
  "lang": "id",
  "model": "<GEMINI_MODEL>",
  "jenis": "grafik",
  "ringkasan": "Penjualan toko naik setiap bulan.",
  "detail": "Batang biru tertinggi di bulan Juni.",
  "teks_dalam_gambar": "Penjualan 2026\nJan\nFeb\nMar",
  "keyakinan": "tinggi",
  "provider": "gemini",
  "fallback": false,
  "image_mime": "image/jpeg",
  "image_bytes": 48211,
  "page_url": "https://contoh.id/berita",
  "image_url": "https://contoh.id/foto.jpg",
  "latency_ms": 1840
}
```

Kode error:

| HTTP | `code` | Arti |
|---|---|---|
| 400 | `INVALID_REQUEST` | JSON rusak / bahasa tidak didukung |
| 400 | `IMAGE_MISSING`, `IMAGE_INVALID` | Gambar kosong / base64 rusak |
| 413 | `IMAGE_TOO_LARGE` | Melebihi 5 MB |
| 415 | `IMAGE_UNSUPPORTED` | Bukan format gambar yang didukung |
| 422 | `AI_BLOCKED` | Gambar ditahan filter keamanan AI (kuota dikembalikan) |
| 502 | `AI_FAILED` | Model gagal memproses gambar |
| 503 | `AI_BUSY` | Gemini sibuk/kuota habis dan cadangan belum siap |
| 503 | `AI_UNAVAILABLE` | Layanan AI mati / model masih dimuat |
| 504 | `AI_TIMEOUT` | Layanan AI melebihi batas waktu |

## Layanan AI internal (FastAPI, hanya dipanggil backend)

`POST /caption` `{ "image_base64": "...", "lang": "id", "context"?: {alt, caption, page_title} }`
→ `{ "text", "text_en", "lang", "model", "latency_ms", "jenis", "ringkasan", "detail", "teks_dalam_gambar", "keyakinan", "provider", "fallback" }`
(kontrak lama tetap; field baru berisi `null`/kosong untuk BLIP). `text` = kalimat siap baca `"<Jenis>: <ringkasan>. <detail> Tulisan di gambar: <teks>."`.

Galat: `415` gambar tak terbaca · `422 MODEL_SAFETY` ditahan filter · `429 MODEL_BUSY` · `502 MODEL_AUTH | MODEL_BAD_OUTPUT | MODEL_ERROR` · `503 MODEL_UNAVAILABLE | MODEL_LOADING` · `504 MODEL_TIMEOUT`. Selain `MODEL_SAFETY`, galat Gemini otomatis dialihkan ke `FALLBACK_PROVIDER` bila sudah siap.

`GET /health` → `{ "status": "ok" | "loading", "provider", "model", "fallback", "fallback_ready" }`

## Endpoint lain (Fase 2–5, sudah diimplementasikan)

Semua endpoint bertanda **user** wajib `Authorization: Bearer <JWT>` (didapat dari register/login, berlaku 7 hari). **admin** = peran Admin.

| Modul | Method & Path | Auth | RF | Catatan |
|---|---|---|---|---|
| Auth | `POST /auth/register` `{nama, email, kata_sandi}` | – | RF-01 | → `201 {token, user}` |
| Auth | `POST /auth/login` `{email, kata_sandi}` | – | RF-05 | `401 INVALID_CREDENTIALS`, `403 ACCOUNT_DISABLED` |
| Profil | `GET /me` | user | RF-02 | termasuk `jenis_pengguna`, `langganan`, `kuota` |
| Profil | `PATCH /me` `{nama?, email?, kata_sandi_lama?, kata_sandi_baru?}` | user | RF-03 | ganti email/sandi wajib `kata_sandi_lama`; `409 EMAIL_TAKEN` |
| Profil | `DELETE /me` `{konfirmasi: "HAPUS", kata_sandi}` | user | RF-04 | riwayat, pengaturan, kuota, laporan terhapus; transaksi dianonimkan; token langsung ditolak (401) |
| Kuota | `GET /me/quota` | user | RF-09 | `{tanggal, terpakai, batas, sisa}` (`batas` null = tanpa batas) |
| Deskripsi | `POST /descriptions` | user | RF-09..11, 13 | + `riwayat_id`, `kuota`; `429 QUOTA_EXCEEDED` |
| Riwayat | `GET /history?page&limit` | user | RF-14 | `{items, total, batas_hari, tersembunyi}` |
| Riwayat | `GET /history/:id` · `DELETE /history/:id` | user | RF-15, RF-16 | hanya milik sendiri (selain itu `404`); item memuat `jenis_gambar`, `provider` |
| Riwayat | `DELETE /history` `{semua: true}` | user | RF-16 | hapus seluruh riwayat sendiri (termasuk yang disembunyikan untuk Gratis) → `{dihapus}` |
| Pengaturan | `GET /settings` · `PUT /settings` | user | RF-17..19 | `403 PREMIUM_REQUIRED`, `409 SHORTCUT_CONFLICT` |
| Laporan | `POST /reports` `{riwayat_id, kategori, catatan?}` | user | RF-20 | `kategori`: `objek_salah`, `teks_salah`, `kurang_lengkap`, `jenis_salah`, `tidak_pantas`, `lainnya` (wajib `catatan`). Klien lama `{riwayat_id, alasan}` tetap diterima. Hanya riwayat milik sendiri. |
| Paket | `GET /plans` | – | RF-23 | `{items, mode_pembayaran}` |
| Pembayaran | `POST /payments` `{paket_id}` | user | RF-24, RF-25 | → `{order_id, redirect_url, snap_token, mode_pembayaran}` |
| Pembayaran | `GET /payments/:orderId` | user | RF-25 | bila masih menunggu, status dicek langsung ke Midtrans |
| Pembayaran | `POST /payments/notification` | tanda tangan SHA-512 | RF-25 | webhook Midtrans |
| Langganan | `GET /me/subscription` | user | RF-26 | `{premium, berlaku_hingga, riwayat[]}` |
| Admin | `GET /admin/users?q&page` · `POST /admin/users` | admin | RF-27, RF-28 | |
| Admin | `GET/PATCH/DELETE /admin/users/:id` | admin | RF-29, RF-30 | tidak bisa menonaktifkan/menghapus diri sendiri |
| Admin | `GET /admin/reports?status` · `PATCH /admin/reports/:id` | admin | RF-21, RF-22 | `ditinjau` wajib `tindak_lanjut` |

Halaman HTML: `GET /admin/` (dashboard), `GET /pay/finish`, `GET|POST /pay/simulate/:orderId` (hanya mode simulasi).

Kode error tambahan: `UNAUTHORIZED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`, `WRONG_PASSWORD`, `ACCOUNT_DISABLED`, `FORBIDDEN`, `EMAIL_TAKEN`, `VALIDATION_ERROR` (+`details.field`), `NOT_FOUND`, `QUOTA_EXCEEDED`, `PREMIUM_REQUIRED`, `SHORTCUT_CONFLICT`, `PAYMENT_GATEWAY_ERROR`, `INVALID_SIGNATURE`.
