# Spesifikasi API NaraVisi (v1)

Base URL: `http://localhost:3000/api/v1` (produksi: HTTPS, RNF-07).
Format: JSON. Error selalu berbentuk:

```json
{ "error": { "code": "IMAGE_INVALID", "message": "Pesan berbahasa Indonesia yang aman dibacakan." } }
```

## Sudah diimplementasikan (Fase 1)

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

Response `201`:
```json
{
  "text": "Seekor kucing duduk di atas sofa.",
  "text_en": "A cat sitting on a couch.",
  "lang": "id",
  "model": "Salesforce/blip-image-captioning-base + Helsinki-NLP/opus-mt-en-id",
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
| 502 | `AI_FAILED` | Model gagal memproses gambar |
| 503 | `AI_UNAVAILABLE` | Layanan AI mati / model masih dimuat |
| 504 | `AI_TIMEOUT` | Layanan AI melebihi batas waktu |

## Layanan AI internal (FastAPI, hanya dipanggil backend)

`POST /caption` `{ "image_base64": "...", "lang": "id" }` → `{ "text", "text_en", "lang", "model", "latency_ms" }`
`GET /health` → `{ "status": "ok" | "loading", "provider", "model" }`

## Rencana (Fase 2–5)

| Modul | Method & Path | Auth | RF |
|---|---|---|---|
| Auth | `POST /auth/register` · `POST /auth/login` | – | RF-01, RF-05 |
| Profil | `GET /me` · `PATCH /me` · `DELETE /me` | user | RF-02..04 |
| Kuota | `GET /me/quota` | user | RF-09 |
| Riwayat | `GET /history` · `GET /history/:id` · `DELETE /history/:id` | user | RF-14..16 |
| Pengaturan | `GET /settings` · `PUT /settings` | user | RF-17..19 |
| Laporan | `POST /reports` | user | RF-20 |
| Paket | `GET /plans` | user | RF-23 |
| Pembayaran | `POST /payments` · `POST /payments/notification` (webhook Midtrans) | user / – | RF-24, RF-25 |
| Langganan | `GET /me/subscription` | user | RF-26 |
| Admin | `GET/POST /admin/users` · `PATCH/DELETE /admin/users/:id` | admin | RF-27..30 |
| Admin | `GET /admin/reports` · `PATCH /admin/reports/:id` | admin | RF-21, RF-22 |

Mulai Fase 2, `POST /descriptions` wajib `Authorization: Bearer <JWT>` dan mencatat kuota + riwayat.
