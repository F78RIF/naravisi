# Peta Kode NaraVisi

Panduan cepat untuk menemukan kode setiap fitur, misalnya saat ditanya dosen. Nomor baris adalah **perkiraan**
(per commit `815ac43`) dan bisa bergeser bila kode berubah. Pegangan yang paling tahan lama adalah **penanda di kode**:
cari `[RF-09]` dan seluruh alurnya muncul dari extension → backend → ai-service.

Format penanda (satu baris, tepat di atas fungsi, rute, atau bagian HTML):

```
JS     // [RF-09] Mengirim gambar ke AI — kuota dicek & dipesan sebelum AI dipanggil
Python # [RF-10] Menerima & menyimpan deskripsi — memanggil Gemini dan memvalidasi JSON terstruktur
HTML   <!-- [RF-07] Menampilkan gambar terdeteksi — ... -->
```

Setiap file utama juga punya **komentar kepala** (baris paling atas): fungsi file, kebutuhan yang ditangani, dan file terkait.

Isi:
1. [Struktur folder](#1-struktur-folder)
2. [Tabel kebutuhan → kode](#2-tabel-kebutuhan--kode)
3. [Alur penting langkah demi langkah](#3-alur-penting-langkah-demi-langkah)
4. [Tabel endpoint API](#4-tabel-endpoint-api)
5. [Pertanyaan dosen yang mungkin muncul](#5-pertanyaan-dosen-yang-mungkin-muncul)
6. [Cara mencari cepat di VS Code](#6-cara-mencari-cepat-di-vs-code)
7. [Pemeriksa otomatis](#7-pemeriksa-otomatis)

---

## 1. Struktur folder

```
naravisi/
├── extension/            Extension Chrome (Manifest V3) yang dipakai pengguna tunanetra
│   ├── background.js       service worker: pintasan, ambil gambar, panggil API, pemandu suara
│   ├── content/            panel di halaman web: pindai gambar, daftar, bacakan deskripsi
│   ├── offscreen/          dokumen tersembunyi untuk mengubah SVG → JPEG
│   ├── popup/              popup di toolbar: masuk/daftar, kuota, tombol Pindai
│   ├── pages/              halaman extension: Selamat datang, Profil, Riwayat, Pengaturan, Premium
│   ├── shared/             kode bersama: konfigurasi & sesi, formulir masuk, kalimat pemandu, ikon, warna
│   ├── fonts/, icons/      font Atkinson Hyperlegible & ikon
│   └── manifest.json       izin, pintasan Alt+Shift+K / Alt+Shift+V
├── backend/              REST API (Node.js + Express) dan Dashboard Admin
│   ├── src/http/           tabel rute, autentikasi per rute, CORS, halaman bayar
│   ├── src/services/       logika bisnis: akun, deskripsi, kuota, riwayat, pengaturan, laporan, pembayaran, admin
│   ├── src/lib/            alat bantu: hash sandi, JWT, validasi gambar & masukan, galat, waktu
│   ├── src/db/             koneksi MySQL/SQLite, skema tabel, migrasi, data awal
│   ├── public/admin/       Dashboard Admin (HTML + JS)
│   ├── scripts/            setup-db.js (siapkan database), bench.js (ukur kecepatan)
│   └── test/               tes otomatis backend (node --test)
├── ai-service/           Layanan AI (Python FastAPI): Gemini utama, BLIP cadangan
│   ├── app/                endpoint /caption, Gemini, BLIP, prompt, router cadangan
│   ├── eval/               alat evaluasi kualitas deskripsi (dataset, metrik)
│   └── tests/              tes otomatis ai-service (pytest)
├── e2e/                  uji ujung ke ujung dengan Chromium sungguhan (Playwright): run.mjs
├── docs/                 dokumentasi: ALUR, API, PENGUJIAN, KEPUTUSAN, SRS/SDD, peta kode ini
├── deploy/               online: CLOUDFLARE_TUNNEL.md (laptop), ORACLE_FREE.md + docker-compose.prod.yml (server), nginx/, docker/, oracle/
├── scripts/              run-all-tests.ps1, start-demo.ps1, start-online.ps1, cek-penanda.js, paket_extension.py, pindai_rahasia.py
├── examples/, notebooks/, plotting/   contoh pemakaian, eksplorasi & grafik hasil evaluasi
└── dist/                 ZIP extension hasil paket (tidak masuk git)
```

---

## 2. Tabel kebutuhan → kode

Singkatan: **bg** = `extension/background.js`, **ct** = `extension/content/content.js`, **rt** = `backend/src/http/routes.js`,
**svc/** = `backend/src/services/`. Kolom Tes: **A** auth.test.js · **D** describeQuotaHistory.test.js ·
**S** settingsReports.test.js · **P** premiumAdmin.test.js · **I** image.test.js / descriptionService.test.js ·
**G** ai-service test_gemini.py · **E** e2e/run.mjs (judul skenario disebut).

### Akun (RF-01..RF-05)

| Kode | Fitur | Extension | Backend | ai-service | Tabel DB | Tes |
|---|---|---|---|---|---|---|
| RF-01 | Registrasi akun | `shared/auth-forms.js:79` `mountAuthForms`, `:188` submit Daftar | rt `:37` → `svc/accountService.js:68` `register`, `:50` `createUser` | – | `users`, `pengaturan_aksesibilitas` | A "UC-AKUN-01", E formulir Daftar |
| RF-02 | Lihat profil | `pages/profil.js:11` `infoCard`, `:134` `load`; `shared/config.js:158` `refreshProfile` | rt `:41` → `accountService.js:28` `profile` | – | `users`, `langganan`, `kuota_harian` | A, E profil Premium |
| RF-03 | Ubah profil | `pages/profil.js:32` `editCard` | rt `:43` → `accountService.js:126` `updateProfile` | – | `users` | A "RF-03", E |
| RF-04 | Hapus akun | `pages/profil.js:91` `dangerCard` | rt `:45` → `accountService.js:158` `deleteAccount` | – | semua milik pengguna | A "RF-04", E |
| RF-05 | Login | `shared/auth-forms.js:171` submit Masuk; `shared/config.js:151` `startSession`, `:176` `logout`; `pages/common.js:93` `requireSession` | rt `:39` → `accountService.js:80` `login` | – | `users` | A, E login popup & Admin |

### Gambar & deskripsi (RF-06..RF-12)

| Kode | Fitur | Extension | Backend | ai-service | Tabel DB | Tes |
|---|---|---|---|---|---|---|
| RF-06 | Memindai gambar | bg `:91` `onCommand`, `:81` `handleScanCommand`, `:59` `togglePanel`; ct `:261` `scanImages`, `:185` `inspect`, `:74` `isVisible`, `:141` `isNoise`; `popup/popup.js:134` tombol Pindai | – | – | – | E "4 gambar ditemukan dalam urutan DOM", "filter: ikon 50×50…" |
| RF-07 | Menampilkan gambar terdeteksi | ct `:472` `buildPanel`, `:568` `renderList`, `:620` `openPanel`, `:252` `readingOrder`, `:312` `markImages`, `:127` `isMeaningfulAlt` | – | – | – | E "urutan baca = urutan DOM", "label Gambar n dari N" |
| RF-08 | Memilih gambar | ct `:601` `select`, `:1151` `onKeyDown` (panah, Home, End) | – | – | – | E "ALUR MANUAL: Alt+Shift+K → panel → panah → Enter → dibacakan → Esc" |
| RF-09 | Mengirim gambar ke AI | ct `:745` `describeCurrent`, `:718` `fetchDescription`, `:282` `inlineSvgToDataUrl`; bg `:419` `requestDescription`, `:394` `imageToBase64`, `:318` `fetchImageBlob`, `:369` `normalizeBlob`; `offscreen/offscreen.js:11` `rasterize` | rt `:56` → `svc/descriptionService.js:38` `describe`; `lib/image.js:41` `decodeImagePayload`; `svc/quotaService.js:64` `reserve`; `svc/aiClient.js:17` `caption` | `main.py:191` `caption`, `:118` `CaptionRequest`; `image_utils.py:31` `decode_base64_image` | `kuota_harian` | D "UC-GBR-04", I, G, E "UC-GBR-04..07", "SVG (<img>) diubah ke JPEG" |
| RF-10 | Menerima & menyimpan deskripsi | bg `:419` `requestDescription` | `descriptionService.js:38` `describe` | `service.py:211` `CaptionRouter.describe`, `gemini.py:200` `describe_structured`, `service.py:69` `compose_text`, `prompts.py:107` `build_system_instruction` | `riwayat_deskripsi` | D "AI gagal → kuota dikembalikan & riwayat tidak dibuat", G |
| RF-11 | Menampilkan deskripsi teks | ct `:709` `showResult`, `:745` `describeCurrent` | rt `:56` (teks dikembalikan) | – | – | E "Enter → deskripsi tampil" |
| RF-12 | Membacakan + putar/jeda/ulang/berhenti | ct `:1011` `speak`, `:1047` `togglePause`, `:1040` `stopSpeech`, `:1064` `play`; `pages/common.js:163` `speak` | – | – | – | E "dibacakan", "tombol Coba suara"; manual M-03 (NVDA) |

### Riwayat (RF-13..RF-16)

| Kode | Fitur | Extension | Backend | ai-service | Tabel DB | Tes |
|---|---|---|---|---|---|---|
| RF-13 | Menyimpan riwayat | – (otomatis setelah RF-09) | `descriptionService.js:71` → `svc/historyService.js:33` `save` | – | `riwayat_deskripsi` | D "UC-RWY-01" |
| RF-14 | Daftar riwayat | `pages/riwayat.js:141` `load`, `:80` `renderItem` | rt `:61` → `historyService.js:44` `list`, `:17` `cutoff` (Gratis 7 hari) | – | `riwayat_deskripsi` | D "UC-RWY-02", E "4 riwayat tampil + info batas 7 hari" |
| RF-15 | Detail riwayat + putar ulang | `pages/riwayat.js:202` `loadDetail`, `:66` `actions` | rt `:68` → `historyService.js:86` `get`, `:72` `findVisible` | – | `riwayat_deskripsi` | D "UC-RWY-03", E "RF-15: detail riwayat" |
| RF-16 | Hapus riwayat | `pages/riwayat.js:105` `remove`, `:125` `removeAll` | rt `:65`, `:73` → `historyService.js:92` `remove`, `:101` `removeAll` | – | `riwayat_deskripsi`, `laporan_deskripsi` | D "UC-RWY-04", E |

### Pengaturan & laporan (RF-17..RF-22)

| Kode | Fitur | Extension | Backend | ai-service | Tabel DB | Tes |
|---|---|---|---|---|---|---|
| RF-17 | Halaman pengaturan | `pages/pengaturan.js:236` `render`, `:32` `renderServer` | rt `:79` → `svc/settingsService.js:64` `get`, `:49` `ensureRow` | – | `pengaturan_aksesibilitas` | S "UC-AKS-01", E |
| RF-18 | Ubah bahasa & pintasan | `pages/pengaturan.js:340` submit; `shared/guide.js:10` `currentShortcut`, `:23` `openShortcutsPage`; `popup/popup.js:74` `showShortcut` | rt `:83` → `settingsService.js:71` `update`, `:29` `normalizeShortcut`, `:17` `RESERVED_SHORTCUTS` | – | `pengaturan_aksesibilitas` | S "UC-AKS-02", E "RF-18" (3 skenario) |
| RF-19 | Ubah kecepatan, nada, suara | `pages/pengaturan.js:236` `render`, `:340` submit; ct `:1000` `pickVoice`; `shared/config.js:62` `getTts` | `settingsService.js:71` `update` (nada & suara hanya Premium) | – | `pengaturan_aksesibilitas` | S "UC-AKS-03", E "Coba suara" |
| RF-20 | Melaporkan deskripsi | ct `:1074` `openReport`, `:1092` `onReportSubmit`; bg `:460` `sendReport`; `pages/riwayat.js:14` `reportForm` | rt `:90` → `svc/reportService.js:43` `create`, `:28` `reason`, `:12` `KATEGORI_LAPORAN` | – | `laporan_deskripsi` | S "RF-20", E "RF-20: kirim laporan dari panel" |
| RF-21 | Admin: daftar laporan | `backend/public/admin/admin.js:329` `loadReports`, `:341` `renderReports` | rt `:124` → `reportService.js:80` `list` | – | `laporan_deskripsi`, `users` | P, S, E dashboard |
| RF-22 | Admin: ubah status laporan | `admin.js:395` `openReview`, `:406` submit | rt `:127` → `reportService.js:96` `updateStatus` | – | `laporan_deskripsi` | P "RF-22", S |

### Premium & pembayaran (RF-23..RF-26)

| Kode | Fitur | Extension | Backend | ai-service | Tabel DB | Tes |
|---|---|---|---|---|---|---|
| RF-23 | Daftar paket Premium | `pages/premium.js:123` `load`, `:39` `planCard` | rt `:96` → `svc/paymentService.js:31` `listPlans`; `db/seed.js:11` `DEFAULT_PLANS` | – | `paket_premium` | P "UC-PRM-01", E |
| RF-24 | Memilih paket | `pages/premium.js:62` `buy` | rt `:98` → `paymentService.js:38` `create` (harga dari DB) | – | `transaksi` | P "UC-PRM-02", E label SIMULASI |
| RF-25 | Pembayaran & aktivasi | `pages/premium.js:76` `showPending`, `:99` `checkPayment` | rt `:100` → `paymentService.js:133` `handleNotification`, `:87` `applyStatus`; `svc/midtransClient.js:59` `verifySignature`, `:50` `getStatus`, `:35` `createTransaction`; `svc/subscriptionService.js:56` `activate`; simulasi `http/pages.js:38` | – | `transaksi`, `langganan` | P "UC-PRM-03" (8 tes); manual M-04 Sandbox |
| RF-26 | Status & masa aktif | `pages/premium.js:14` `statusCard`; `popup/popup.js:37` `renderQuota` | rt `:104` → `paymentService.js:209` `subscription`; `subscriptionService.js:16` `status`, `:37` `isPremium`; `quotaService.js:25` `summary` | – | `langganan`, `kuota_harian` | P "UC-PRM-04", E |

### Admin pengguna (RF-27..RF-30)

| Kode | Fitur | Extension / Dashboard | Backend | ai-service | Tabel DB | Tes |
|---|---|---|---|---|---|---|
| RF-27 | Tambah pengguna | `admin.js:242` `openUserDialog`, `:261` submit | rt `:110` → `svc/adminService.js:55` `createUser` | – | `users` | P "UC-ADM-01", E |
| RF-28 | Daftar pengguna | `admin.js:164` `loadUsers`, `:176` `renderUsers` | rt `:108`, `:112` → `adminService.js:29` `listUsers`, `:44` `getUser` | – | `users`, `langganan` | P "UC-ADM-02", E |
| RF-29 | Ubah pengguna | `admin.js:242` `openUserDialog`, `:261` submit | rt `:115` → `adminService.js:66` `updateUser`, `:109` `assertNotLastAdmin` | – | `users` | P "RF-29" (admin terakhir 409), E |
| RF-30 | Hapus pengguna | `admin.js:285` `confirmDelete`, `:301` submit | rt `:120` → `adminService.js:121` `deleteUser` (satu transaksi DB) | – | `users`, `riwayat_deskripsi`, `laporan_deskripsi`, `transaksi` | P "RF-30" (8 tes), E email salah ditolak |

### Fitur tambahan (PF-01..PF-04)

Tidak tercantum di SRS v1.1; dicatat di `docs/PERUBAHAN_SRS_SDD.md` bagian 1.

| Kode | Fitur | Extension | Backend | ai-service | Tabel DB | Tes |
|---|---|---|---|---|---|---|
| PF-01 | Pemandu suara (chrome.tts) | bg `:31` `speakGuide`, `:48` onInstalled, `:116` `announceImageCount`, `:282` `startupGreeting`; `shared/guide.js:35` `welcomeText`, `:51` `imageCountText`; `pages/selamat-datang.js` | – | – | – | E "tab sambutan … sambutan dibacakan", "Chrome dibuka: sapaan sisa kuota" |
| PF-02 | Baca berurutan (mode otomatis) | bg `:234` `autoDescribePage`, `:203` `autoGate`, `:153` `isExcluded`, `:265` `enableFocusDescribe`; ct `:931` `autoDescribe`, `:888` `pump`, `:962` `onFocusIn`; `pages/pengaturan.js:105` `askConsent`, `:144` `autoSection` | sama dengan RF-09 | – | `kuota_harian` | E "Pengaturan Baca berurutan", "baca berurutan: maks. N gambar…", "kuota tersisa 2 → tidak jalan" |
| PF-03 | Deskripsi ke `alt` gambar asli | ct `:814` `applyAlt` | – | – | – | E "setelah dideskripsikan: alt asli bermakna tidak ditimpa…" |
| PF-04 | Cadangan AI Gemini → BLIP | – | – | `main.py:69` `build_service`; `service.py:195` `CaptionRouter`, `:211` `describe`; `gemini.py:167` `_call`; `providers.py:92` `BlipCaptioner`, `:126` `MarianTranslator` | – | G "429 model busy otomatis ke cadangan…", "json rusak memakai cadangan" |

### Kebutuhan non-fungsional yang diberi penanda

| Kode | Arti | Lokasi utama |
|---|---|---|
| RNF-02 | Pembaca layar | ct `:472` `buildPanel`, `:853` `announce` (live region) |
| RNF-03 | Navigasi keyboard | ct `:1151` `onKeyDown`, `:665` `closePanel` |
| RNF-06 | Pesan error jelas | `backend/src/lib/errors.js:21` `Errors`; `http/dispatch.js:25` `errorResult`; ct `:694` `friendlyError` |
| RNF-07 | HTTPS/TLS (mode production) | `backend/src/config.js` `productionProblems` (PUBLIC_URL wajib https, kunci wajib); `server.js` pesan gagal start; `routes.js` `simulationRoutes` hanya development; `ai-service/app/config.py` `production_problems` |
| RNF-08 | Sandi ter-hash | `backend/src/lib/password.js:15` `hashPassword`, `:22` `verifyPassword` |
| RNF-09 | Autentikasi token | `lib/jwt.js:13` `signJwt`, `:25` `verifyJwt`; `accountService.js:103` `authenticate`; `http/dispatch.js:12` `dispatch`; `extension/shared/config.js:97` `apiFetch` |
| RNF-10 | Hak akses per peran | `http/dispatch.js:12` `dispatch` (rute `auth: 'admin'`); `accountService.js:103` (peran dibaca dari DB) |
| RNF-12 | Info saat AI/server mati | `svc/aiClient.js:17` `caption`, `:72` `health`; bg `:470` `backendHealth`; `ai-service/app/main.py:177` `health` |
| RNF-13 | File gambar tidak disimpan | `descriptionService.js:38` `describe` (hanya URL & teks) |

---

## 3. Alur penting langkah demi langkah

### 3.1 Login

1. Pengguna mengisi Email & Kata sandi di popup / tab sambutan → `extension/shared/auth-forms.js:171` (submit Masuk).
2. `apiFetch('/auth/login')` → `extension/shared/config.js:97` mengirim `POST /api/v1/auth/login`.
3. Backend: `backend/src/http/routes.js:39` → `backend/src/services/accountService.js:80` `login`
   - cek batas 10 gagal / 15 menit (`lib/rateLimit.js`),
   - `verifyPassword` (`lib/password.js:22`) membandingkan dengan hash di tabel `users`,
   - `issueToken` (`accountService.js:20`) → JWT (`lib/jwt.js:13`).
4. Extension menyimpan token: `shared/config.js:151` `startSession` → `chrome.storage.local`.
5. Setiap permintaan berikutnya membawa `Authorization: Bearer <token>`; backend memeriksa di
   `http/dispatch.js:12` → `accountService.js:103` `authenticate`.

### 3.2 Alt+Shift+K sampai deskripsi dibacakan (alur manual, tidak boleh berubah)

1. Tombol Alt+Shift+K didaftarkan di `extension/manifest.json` (`commands.scan-page`).
2. Chrome memanggil `extension/background.js:91` `onCommand` → `:81` `handleScanCommand` → `:59` `togglePanel`
   (menyuntik `content/content.js` bila belum ada, lalu pesan `NV_TOGGLE`).
3. `content.js:45` menerima `NV_TOGGLE` → `:620` `openPanel` → `:261` `scanImages` (filter `isVisible`, `isNoise`,
   `inspect`) → `:252` `readingOrder` → `:568` `renderList`; jumlah gambar diumumkan.
4. Panah atas/bawah: `content.js:1151` `onKeyDown` → `:601` `select`.
5. Enter (`content.js:1171`) → `:745` `describeCurrent` → `:718` `fetchDescription` → pesan `NV_DESCRIBE`.
6. Service worker: `background.js:550` → `:419` `requestDescription` → `:394` `imageToBase64`
   (`fetchImageBlob`, `normalizeBlob`, SVG lewat `offscreen/offscreen.js:11`) → `POST /api/v1/descriptions`.
7. Backend: `routes.js:56` → `descriptionService.js:38` `describe`: validasi gambar → pesan kuota → `aiClient.caption`
   → simpan riwayat (lihat 3.3).
8. ai-service: `main.py:191` `caption` → `service.py:211` `CaptionRouter.describe` → Gemini
   (`gemini.py:200`) atau BLIP bila Gemini gagal.
9. Kembali ke panel: `content.js:709` `showResult` (teks tampil, `aria-live`) → `:1011` `speak`
   (`SpeechSynthesisUtterance`, kecepatan/nada dari pengaturan) → `:814` `applyAlt` mengisi `alt` gambar.
10. Esc (`content.js:1182`) → `:665` `closePanel`, fokus kembali ke elemen semula.

### 3.3 Kuota harian

1. Batas Gratis: `FREE_DAILY_QUOTA` (`backend/src/config.js`), reset 00.00 WITA (`lib/time.js` `dateInTz`).
2. Premium/Admin tanpa batas: `routes.js:28` `unlimited`, `subscriptionService.js:37` `isPremium`.
3. Saat deskripsi diminta: `descriptionService.js:56` → `quotaService.js:64` `reserve` → `:37` `increment`
   (`UPDATE kuota_harian … WHERE jumlah_permintaan < batas`, atomik). Habis → galat `QUOTA_EXCEEDED` (429).
4. AI gagal → `reservation.release()` mengembalikan kuota (`descriptionService.js`, blok `try/catch` di sekitar `aiClient.caption`).
5. Sisa kuota ditampilkan: `GET /me/quota` → `quotaService.js:25` `summary`; popup `popup.js:37` `renderQuota`.
6. Mode Baca berurutan menyisakan 2 kuota untuk pilihan manual: `background.js:203` `autoGate`.

### 3.4 Riwayat

1. Tersimpan otomatis: `descriptionService.js:71` → `historyService.js:33` `save` (tabel `riwayat_deskripsi`,
   hanya URL & teks).
2. Daftar: `pages/riwayat.js:141` `load` → `GET /history` → `historyService.js:44` `list`; Gratis dibatasi
   7 hari oleh `:17` `cutoff` (data lama disembunyikan, tidak dihapus).
3. Detail & putar ulang: `riwayat.js:202` `loadDetail` → `GET /history/:id` → `historyService.js:86` `get`
   (`:72` `findVisible` memastikan milik sendiri); putar ulang `riwayat.js:66` `actions` → `pages/common.js:163` `speak`.
4. Hapus: `riwayat.js:105` / `:125` → `DELETE /history/:id` atau `DELETE /history` → `historyService.js:92` / `:101`.

### 3.5 Pembayaran Premium

1. `pages/premium.js:123` `load` → `GET /plans` (`paymentService.js:31`) & `GET /me/subscription`.
2. Pilih paket: `premium.js:62` `buy` → `POST /payments` → `paymentService.js:38` `create`
   - harga diambil dari tabel `paket_premium` (jumlah dari klien diabaikan),
   - ada `MIDTRANS_SERVER_KEY` → `midtransClient.js:35` `createTransaction` (Snap); tanpa kunci → halaman SIMULASI.
3. Tab bayar dibuka (`premium.js:66`, `redirect_url`); pengguna membayar.
4. Midtrans memanggil webhook `POST /payments/notification` → `paymentService.js:133` `handleNotification`:
   1. tanda tangan `midtransClient.js:59` `verifySignature` (SHA-512),
   2. order & nominal dicocokkan dengan tabel `transaksi`,
   3. konfirmasi ulang ke Status API `midtransClient.js:50` `getStatus`.
5. `paymentService.js:87` `applyStatus` → `subscriptionService.js:56` `activate` (masa aktif disambung bila masih Premium).
6. Extension mengecek: `premium.js:99` `checkPayment` → `GET /payments/:orderId` (`paymentService.js:161`).

### 3.6 Admin

1. Masuk Dashboard `http://…/admin/` → `backend/public/admin/admin.js:103` `enter` (hanya peran `admin`).
2. Setiap rute `/api/v1/admin/*` diberi `auth: 'admin'` di `routes.js`; `http/dispatch.js:12` menolak 403 bila bukan Admin;
   peran dibaca ulang dari database (`accountService.js:103`).
3. Pengguna: `admin.js:164` `loadUsers` → `adminService.js:29` `listUsers`; tambah/ubah `admin.js:261` →
   `adminService.js:55` `createUser` / `:66` `updateUser`; Admin aktif terakhir dilindungi `:109` `assertNotLastAdmin`.
4. Hapus: `admin.js:285` `confirmDelete` (ketik email) → `adminService.js:121` `deleteUser`: riwayat dihapus &
   transaksi dianonimkan dalam **satu** transaksi database.
5. Laporan: `admin.js:329` `loadReports` → `reportService.js:80` `list`; tinjau `admin.js:406` → `reportService.js:96`
   `updateStatus` (status `baru` / `ditinjau`).

---

## 4. Tabel endpoint API

Semua rute ada di `backend/src/http/routes.js`. Kolom **Akses**: publik, user (wajib login), admin (wajib peran Admin).

| Metode & path | Akses | Baris rt | Service → fungsi | Tabel DB |
|---|---|---|---|---|
| GET `/api/v1/health` | publik | ~33 | `aiClient.health` | – |
| POST `/api/v1/auth/register` | publik | ~37 | `accountService.register` | users, pengaturan_aksesibilitas |
| POST `/api/v1/auth/login` | publik | ~39 | `accountService.login` | users |
| GET `/api/v1/me` | user | ~41 | `accountService.profile` | users, langganan, kuota_harian |
| PATCH `/api/v1/me` | user | ~43 | `accountService.updateProfile` | users |
| DELETE `/api/v1/me` | user | ~45 | `accountService.deleteAccount` | users (+ data terkait) |
| GET `/api/v1/me/quota` | user | ~48 | `quotaService.summary` | kuota_harian |
| POST `/api/v1/descriptions` | user | ~56 | `descriptionService.describe` → `quotaService.reserve`, `aiClient.caption`, `historyService.save` | kuota_harian, riwayat_deskripsi |
| GET `/api/v1/history` | user | ~61 | `historyService.list` | riwayat_deskripsi |
| DELETE `/api/v1/history` | user | ~65 | `historyService.removeAll` | riwayat_deskripsi |
| GET `/api/v1/history/:id` | user | ~68 | `historyService.get` | riwayat_deskripsi |
| DELETE `/api/v1/history/:id` | user | ~73 | `historyService.remove` | riwayat_deskripsi |
| GET `/api/v1/settings` | user | ~79 | `settingsService.get` | pengaturan_aksesibilitas |
| PUT `/api/v1/settings` | user | ~83 | `settingsService.update` | pengaturan_aksesibilitas |
| POST `/api/v1/reports` | user | ~90 | `reportService.create` | laporan_deskripsi |
| GET `/api/v1/plans` | publik | ~96 | `paymentService.listPlans` | paket_premium |
| POST `/api/v1/payments` | user | ~98 | `paymentService.create` → `midtransClient.createTransaction` | transaksi |
| POST `/api/v1/payments/notification` | publik (tanda tangan Midtrans) | ~100 | `paymentService.handleNotification` → `applyStatus` → `subscriptionService.activate` | transaksi, langganan |
| GET `/api/v1/payments/:orderId` | user | ~102 | `paymentService.get` | transaksi |
| GET `/api/v1/me/subscription` | user | ~104 | `paymentService.subscription` | langganan |
| GET `/api/v1/admin/users` | admin | ~108 | `adminService.listUsers` | users, langganan |
| POST `/api/v1/admin/users` | admin | ~110 | `adminService.createUser` | users |
| GET `/api/v1/admin/users/:id` | admin | ~112 | `adminService.getUser` | users |
| PATCH `/api/v1/admin/users/:id` | admin | ~115 | `adminService.updateUser` | users |
| DELETE `/api/v1/admin/users/:id` | admin | ~120 | `adminService.deleteUser` | users, riwayat_deskripsi, laporan_deskripsi, transaksi |
| GET `/api/v1/admin/reports` | admin | ~124 | `reportService.list` | laporan_deskripsi, users |
| PATCH `/api/v1/admin/reports/:id` | admin | ~127 | `reportService.updateStatus` | laporan_deskripsi |
| GET `/pay/finish` | publik | ~133 | `http/pages.js` `finishPage` | – |
| GET `/pay/simulate/:orderId` | publik (mode simulasi) | ~136 | `paymentService.simulationInfo` → `pages.js` `simulatePage` | transaksi |
| POST `/pay/simulate/:orderId` | publik (mode simulasi) | ~141 | `paymentService.simulate` | transaksi, langganan |

Layanan AI (dipanggil backend saja, tidak dari extension):

| Metode & path | File → fungsi |
|---|---|
| GET `/health` | `ai-service/app/main.py:177` `health` |
| POST `/caption` | `ai-service/app/main.py:191` `caption` → `service.py:211` `CaptionRouter.describe` |

Skema tabel: `backend/src/db/schema.mysql.sql` (MySQL) dan `schema.sqlite.sql` (tes). Delapan tabel: `users`,
`pengaturan_aksesibilitas`, `kuota_harian`, `riwayat_deskripsi`, `laporan_deskripsi`, `paket_premium`, `transaksi`, `langganan`.

---

## 5. Pertanyaan dosen yang mungkin muncul

| Pertanyaan | Jawaban singkat | Lokasi |
|---|---|---|
| Di mana kata sandi di-hash? | scrypt + salt acak 16 byte, disimpan `scrypt$N$salt$hash` | `backend/src/lib/password.js:15` `hashPassword`; dipanggil `accountService.js:51` (daftar), `:150` (ubah sandi), `adminService.js:79` |
| Bagaimana sandi dicek saat login? | dibandingkan waktu-konstan (`timingSafeEqual`); email tak dikenal tetap dihitung dengan hash palsu agar waktu sama | `lib/password.js:22` `verifyPassword`; `accountService.js:90` |
| Di mana token dibuat & dicek? | JWT HS256 dengan `JWT_SECRET` | `lib/jwt.js:13` `signJwt`, `:25` `verifyJwt`; `accountService.js:20` `issueToken`, `:103` `authenticate` |
| Bagaimana rute Admin dilindungi? | rute bertanda `auth: 'admin'`, dicek di satu tempat; peran dibaca dari database | `http/dispatch.js:12` `dispatch`; `routes.js:108–127` |
| Di mana kuota dicek? | sebelum AI dipanggil, penambahan atomik; dikembalikan bila AI gagal | `descriptionService.js:56` → `quotaService.js:64` `reserve`, `:37` `increment` |
| Di mana Gemini dipanggil? | SDK `google-genai`, keluaran JSON terstruktur, batas waktu & 1× ulang | `ai-service/app/gemini.py:174` (`generate_content` di `_call`), `:200` `describe_structured` |
| Kalau kuota Gemini habis? | galat 429 → `MODEL_BUSY` → router memakai BLIP | `gemini.py:167` `_call`; `service.py:40` `FALLBACK_CODES`, `:211` `CaptionRouter.describe` |
| Di mana alt gambar diisi? | deskripsi disuntikkan ke `alt` (alt bermakna tidak ditimpa, ditandai `data-naravisi`) | `extension/content/content.js:814` `applyAlt` |
| Di mana validasi gambar? | 3 lapis: extension mengubah ke JPEG ≤1280 px; backend cek magic bytes & ukuran; ai-service mendekode ulang | `background.js:369` `normalizeBlob`; `backend/src/lib/image.js:30` `sniffImageMime`, `:41` `decodeImagePayload`; `ai-service/app/image_utils.py:31` |
| Kenapa server tidak mengunduh gambar dari URL? | extension yang mengunduh (mencegah SSRF, ADR-04) | `background.js:318` `fetchImageBlob`; `docs/KEPUTUSAN.md` ADR-04 |
| Di mana signature Midtrans dicek? | SHA-512(order_id + status_code + gross_amount + server_key), dibandingkan waktu-konstan | `backend/src/services/midtransClient.js:59` `verifySignature`; dipanggil `paymentService.js:137` |
| Bagaimana mencegah nominal pembayaran dimanipulasi? | harga dari DB saat pesanan dibuat; webhook dicocokkan dengan DB lalu dikonfirmasi ke Status API | `paymentService.js:38` `create`, `:133` `handleNotification`, `midtransClient.js:50` `getStatus` |
| Di mana Premium diaktifkan? | dalam transaksi DB, idempoten, masa aktif disambung | `paymentService.js:87` `applyStatus` → `subscriptionService.js:56` `activate` |
| Di mana batas riwayat 7 hari? | filter tanggal, data lama tidak dihapus | `historyService.js:17` `cutoff` |
| Di mana deskripsi dibacakan? | Web Speech API di panel; `chrome.tts` untuk pemandu suara | `content.js:1011` `speak`; `background.js:31` `speakGuide` |
| Di mana pintasan Alt+Shift+K diatur? | `manifest.json` `commands.scan-page`; ditangani `onCommand` | `extension/manifest.json`; `background.js:91` |
| Apakah gambar disimpan di server? | tidak; hanya URL halaman/gambar & teks deskripsi | `descriptionService.js:38`; `historyService.js:33` `save` |
| Di mana pesan error dibuat? | satu daftar kode + pesan Indonesia | `backend/src/lib/errors.js:21` `Errors`; extension `content.js:694` `friendlyError` |
| Di mana login gagal berulang dibatasi? | 10 gagal per email+IP → dikunci 15 menit | `lib/rateLimit.js`; `accountService.js:80` `login` |
| Di mana Admin terakhir dilindungi? | cek di dalam transaksi DB, 409 `LAST_ADMIN` | `adminService.js:109` `assertNotLastAdmin` |

---

## 6. Cara mencari cepat di VS Code

| Tombol | Fungsi | Contoh |
|---|---|---|
| **Ctrl+P** | buka file dengan mengetik sebagian namanya | `descriptionS` → `descriptionService.js`; tambah `:56` untuk langsung ke baris 56 |
| **Ctrl+Shift+F** | cari di seluruh folder | ketik `[RF-09]` → semua bagian alur kirim gambar, dari extension sampai ai-service |
| **Ctrl+Shift+O** | daftar fungsi di file yang sedang terbuka | di `content.js` ketik `speak` |
| **F12** | Go to Definition — loncat ke definisi fungsi | kursor di `quota.reserve(` → F12 → `quotaService.js` |
| **Shift+F12** | Find All References — semua tempat fungsi dipakai | kursor di `hashPassword` → Shift+F12 |
| **Alt+←** | kembali ke posisi sebelumnya setelah F12 | |

Tips:
- Pencarian `[RF-` (dengan kurung siku) hanya menemukan penanda, bukan teks biasa. Contoh lain: `[PF-04]`, `[RNF-08]`.
- Di kotak "files to include" pada Ctrl+Shift+F, isi `backend/src` untuk membatasi ke backend saja.
- Tes juga diberi penanda di atas skenario yang mengujinya, mis. `// [RF-08] Memilih gambar — diuji: panah memilih gambar`
  di `e2e/run.mjs`. Jadi pencarian `[RF-08]` menunjukkan kode **dan** tesnya.

## 7. Pemeriksa otomatis

```
cd backend
npm run cek:penanda          # = node ../scripts/cek-penanda.js
```

`scripts/cek-penanda.js` memindai `extension/`, `backend/src/`, `backend/public/`, `ai-service/app/` (kode) dan
`backend/test/`, `ai-service/tests/`, `e2e/run.mjs` (tes), lalu mencetak tabel per kebutuhan: jumlah penanda, ada/tidak tes,
dan nama file tesnya. Tes dihitung bila file tes menyebut kode RF, kode use case-nya (mis. `UC-GBR-04`, bukan rentang
`UC-GBR-01..07`), atau memuat penanda `[RF-xx]`. Keluar dengan kode 1 (gagal) bila:
- ada RF-01..RF-30 tanpa penanda di kode atau tanpa tes,
- ada penanda dengan kode tak dikenal atau format bukan `[KODE] <nama resmi> — <penjelasan>`.

Nama resmi setiap kode ada di tabel `KEBUTUHAN` di awal skrip. Menambah kebutuhan baru = tambah satu baris di sana.
