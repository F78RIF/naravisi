# Perubahan sejak SRS & SDD v1.1

SRS dan SDD v1.1 (`docs/srs-sdd/`, disetujui 9 Oktober 2026) adalah acuan terakhir. Dokumen ini mencatat semua
yang **berbeda atau bertambah** di prototype versi **1.1.0** (2 November 2026), supaya SRS/SDD bisa direvisi ke v1.2 tanpa
harus membaca ulang kode. Setiap baris menyebut bagian dokumen yang terdampak, alasannya, keputusan (ADR di
`docs/KEPUTUSAN.md`), dan buktinya.

Ringkasnya: **30 RF dan 13 RNF tidak berubah nomor maupun maknanya.** Perubahan di bawah memperjelas cara memenuhi
kebutuhan itu, mengganti teknologi yang ternyata kurang cocok (model AI), dan menutup celah keamanan yang ditemukan saat
pengujian.

## 1. Ringkasan

| # | Perubahan | Dampak ke dokumen | ADR | Tanggal |
|---|---|---|---|---|
| 1 | Gemini menjadi model AI utama, BLIP + MarianMT menjadi cadangan | SRS 1.2, 2.4, 2.5, 3.3; SDD 2.4, 3.x, ERD | ADR-21, ADR-22 | 23–27 Okt |
| 2 | Deskripsi berisi **jenis gambar** dan **teks di dalam gambar**; provider yang dipakai dicatat | SRS UC-GBR-05/06, UC-RWY-03; ERD `riwayat_deskripsi` | ADR-22 | 27 Okt |
| 3 | SVG dan gambar latar CSS **kini bisa** dideskripsikan | SRS 2.5 (batasan), UC-GBR-01/04; izin `offscreen` | – | 16 Okt |
| 4 | Pintasan pindai **Alt+Shift+K**, popup **Alt+Shift+V** | SDD ERD default `pintasan_keyboard`; SRS RF-18 | ADR-23 | 18 Okt |
| 5 | Urutan baca atas → bawah + deskripsi disuntikkan ke `alt` gambar asli | SRS RF-07, RNF-02; SDD panel | – | 27 Okt |
| 6 | Mode **Baca berurutan** (opsional, bawaan mati, wajib persetujuan) | SRS 3.1, RNF-13 (privasi) | – | 27 Okt |
| 7 | **Pemandu suara** dari service worker (sambutan, jumlah gambar, status sesi); izin `tts` | SRS 3.1, RNF-01/02 | – | 15 Okt |
| 8 | Laporan memakai **alasan pilihan** + catatan ≤ 500 karakter | SRS UC-LAP-01; ERD `laporan_deskripsi.kategori` | ADR-24 | 27 Okt |
| 9 | Hapus akun: ketik **"HAPUS"** + kata sandi | SRS UC-AKUN-04 | ADR-19 (diperketat) | 27 Okt |
| 10 | Aktivasi Premium **tiga lapis** (tanda tangan → database → Status API); label **SIMULASI** | SRS RF-24/25, UC-PRM-02/03; SDD sequence pembayaran | ADR-25 | 1 Nov |
| 11 | **Admin aktif terakhir** dilindungi; hapus pengguna **ketik email**; **satu transaksi** database | SRS RF-29/30, UC-ADM-03/04; SDD sequence Admin | ADR-26 | 2 Nov |
| 12 | Dataset evaluasi sendiri + few-shot Gemini | SRS 2.7 (keterlibatan pengguna), SDD lampiran evaluasi | – | 27 Okt |
| 13 | Upgrade FastAPI 0.115 → 0.162, pillow 13; batas waktu AI 25 dtk; token Gemini 4096 | SDD 2.4 teknologi | ADR-27 | 16 Okt, 1–2 Nov |
| 14 | Kode galat API baru | SDD antarmuka API | ADR-25, ADR-26 | 1–2 Nov |
| 15 | **PF-05 Deteksi objek lokal** (MediaPipe di extension): deskripsi kilat, cadangan tanpa AI, penyaring gambar polos; pengaturan "Deskripsi kilat tanpa AI"; CSP `wasm-unsafe-eval` | SRS 2.5, 3.1, RF-09/RF-11/RF-12, RNF-04/RNF-12/RNF-13, fitur tambahan; SDD 2.4, 3.x arsitektur & sequence UC-GBR-04 | – | 12 Nov |

## 2. Rincian per bagian SRS

| Bagian SRS v1.1 | Tertulis di v1.1 | Prototype 1.1.0 | Alasan | Bukti |
|---|---|---|---|---|
| 1.2 Ruang lingkup, 2.4 Tabel 2 (Model AI) | "model AI Image Captioning sumber terbuka (BLIP) … dengan terjemahan otomatis" | **Google Gemini** (model Flash/Flash-Lite AI Studio, dipilih lewat `GEMINI_MODEL`) sebagai utama, dengan jawaban JSON terstruktur; **BLIP + MarianMT** sebagai cadangan otomatis dan pilihan luring (`CAPTION_PROVIDER=blip`) | BLIP hanya satu kalimat pendek berbahasa Inggris yang diterjemahkan, tidak bisa membaca teks di gambar, dan lambat di CPU | `ai-service/tests/test_gemini.py`; `docs/ALUR.md` Tahap 1 |
| 2.5 Batasan | "Gambar vektor (SVG) dan gambar latar CSS belum dapat dideskripsikan pada versi awal." | SVG (`<img>` maupun inline) dan `background-image` dikenali; SVG diubah ke JPEG di dokumen offscreen | Thumbnail berita (detik.com) berupa latar CSS tidak terdeteksi (C-11) | e2e bagian "SVG inline & gambar latar CSS" |
| 2.5 Asumsi & ketergantungan | layanan AI di server NaraVisi | Dengan Gemini, gambar yang **dipilih pengguna** diteruskan server ke Google; tingkat gratis AI Studio dapat memakai data itu untuk peningkatan produk. Pengguna diberi tahu di Pengaturan, dialog persetujuan Baca berurutan, dan README | Transparansi privasi | `extension/pages/pengaturan.js` (kartu "Privasi", teks persetujuan); README "Privasi" |
| 3.1 Antarmuka pengguna | Panel, popup, halaman extension, dashboard Admin | Ditambah: tab **Selamat datang** dengan sambutan suara; **pemandu suara** (`chrome.tts`) untuk jumlah gambar, status sesi, dan sisa kuota; mode **Baca berurutan** di Pengaturan → Otomatis | Pengguna tunanetra perlu tahu extension aktif tanpa melihat layar | e2e bagian "Pemandu suara saat pertama dipasang", "Pengumuman jumlah gambar saat halaman dibuka", "Daftar gambar & mode otomatis" |
| RF-07 / UC-GBR-02 | menampilkan gambar yang terdeteksi | Daftar mengikuti **urutan baca** pembaca layar (urutan DOM; posisi visual bila CSS menyusun ulang); label "Gambar 2 dari 6 · keterangan" | Sama dengan urutan yang didengar di NVDA | e2e "urutan baca" |
| RF-11 / RNF-02 | deskripsi tampil di panel | Deskripsi juga **disuntikkan ke `alt`** gambar asli (alt bermakna tidak ditimpa, ditandai `data-naravisi`) sehingga NVDA membacanya saat menelusuri halaman | Deskripsi tetap berguna setelah panel ditutup | e2e "alt asli …" |
| RF-10, UC-GBR-05/06, UC-RWY-03 | teks deskripsi | Ditambah **jenis gambar** (foto, grafik, infografis, …) dan **teks di dalam gambar**; provider yang menghasilkan deskripsi dicatat | Grafik/infografis butuh konteks jenis & isi tulisan | `describeQuotaHistory.test.js`; e2e "RF-15" |
| RF-18 / UC-AKS-02 | pintasan disimpan & diarahkan ke `chrome://extensions/shortcuts` | Halaman Pengaturan menampilkan pintasan **yang benar-benar aktif** (`chrome.commands.getAll()`); kosong → "Pintasan belum diatur" + tautan | Pintasan bisa gagal terpasang karena bentrok | e2e "RF-18" (3 skenario) |
| RF-20 / UC-LAP-01 | pengguna menuliskan alasan | Alasan **wajib dipilih** dari 6 kategori; catatan opsional ≤ 500 karakter; "Lainnya" wajib catatan; hanya riwayat milik sendiri | Laporan lebih mudah diisi dengan keyboard & lebih mudah ditindaklanjuti | `settingsReports.test.js` "RF-20"; e2e "UC-LAP-01 alt" |
| RF-21 / RF-22 | status `baru` / `sudah ditinjau` | **Tidak berubah** (tidak ada status baru). Ditambah: peninjau yang dihapus → laporan tetap ada, kolom peninjau dikosongkan | – | `premiumAdmin.test.js` "RF-22" |
| UC-AKUN-04 (RF-04) | konfirmasi kata sandi | Konfirmasi kata sandi **dan** mengetik "HAPUS" | Mencegah hapus tak sengaja lewat Enter | `auth.test.js` "RF-04"; e2e "RF-04" |
| RF-24 / UC-PRM-02 | memilih paket | Harga **selalu dari database server** (nilai kiriman klien diabaikan); halaman bayar simulasi berlabel **SIMULASI** di judul tab, `h1`, setiap tombol, dan pesan hasil | Klien tidak boleh menentukan harga; demo tidak boleh terdengar seperti pembayaran sungguhan | `premiumAdmin.test.js` "harga selalu dari database"; e2e "RF-24" |
| RF-25 / UC-PRM-03 | notifikasi diverifikasi tanda tangan SHA-512; status dicek langsung saat halaman Premium dibuka | Tiga lapis: tanda tangan → `order_id` **dan nominal** dicocokkan dengan tabel `transaksi` → **dikonfirmasi ulang ke Status API** Midtrans. Nominal berbeda, order tak dikenal, atau Status API masih pending/tidak kenal → tidak diaktifkan | Tanda tangan saja tidak membuktikan nominal yang dibayar sesuai harga | `premiumAdmin.test.js` "RF-25: nominal dimanipulasi ditolak" dkk. |
| RF-29 / UC-ADM-03 | Admin mengubah data pengguna; tidak bisa menonaktifkan diri | Ditambah: **Admin aktif terakhir** tidak bisa diturunkan/dinonaktifkan (409 `LAST_ADMIN`), diperiksa di dalam transaksi | Sistem tidak boleh kehilangan semua Admin | `premiumAdmin.test.js` "RF-30: Admin aktif terakhir …", uji balapan |
| RF-30 / UC-ADM-04 | konfirmasi lalu hapus; Admin tidak bisa menghapus diri | Konfirmasi dengan **mengetik email pengguna** (diperiksa ulang di server); Admin aktif terakhir tidak bisa dihapus; riwayat dihapus, transaksi dianonimkan, laporan yang ditinjau dikosongkan peninjaunya, akun dihapus — **semua dalam satu transaksi** | Penghapusan tidak bisa dibatalkan, jadi harus disengaja dan utuh | `premiumAdmin.test.js` "RF-30: hapus dalam SATU transaksi"; e2e "RF-30" |
| RNF-02 | WCAG 2.1, kontrol berlabel, live region | Diuji otomatis dengan **axe-core** (WCAG 2.0/2.1/2.2 A & AA) di 9 tampilan; satu pelanggaran WCAG 2.5.3 ditemukan & diperbaiki (C-13) | Bukti yang bisa diulang | `docs/PENGUJIAN.md` 3c |
| RNF-04 | ≤ 5 detik | **Tidak berubah.** Hasil ukur: BLIP memenuhi (p50 2,8 dtk), Gemini belum (p50 10,2 dtk) karena model "berpikir" | Dicatat apa adanya | `docs/PENGUJIAN.md` M-01 |
| RF-09, RF-11, RF-12 (PF-05) | gambar dikirim ke AI; deskripsi tampil & dibacakan | Saat Enter, extension juga menjalankan **deteksi objek lokal** (EfficientDet-Lite0, 80 kelas COCO, skor ≥ 0,5, maks. 5 jenis, label bahasa Indonesia). Bila AI belum menjawab setelah 1 dtk dibacakan "Kemungkinan berisi: 2 orang, 1 sepeda.", lalu deskripsi lengkap menyusul tanpa memotong. **Gambar tetap dikirim ke AI**; RF tidak berubah makna | Pengguna tunanetra mendapat gambaran awal tanpa menunggu 5–10 dtk | e2e "PF-05: AI lambat …", "AI menjawab < 1 detik …"; `e2e/unit/deteksi.test.mjs` |
| RNF-12 / RNF-06 (PF-05) | pesan jelas saat AI/server mati | Pesan galat tetap dibacakan, **didahului** "Deskripsi sederhana (tanpa AI): …" dari detektor lokal (server/AI gagal, kuota habis, offline). Tidak memotong kuota, tidak masuk riwayat, tidak disuntik ke `alt`. Tidak dipakai untuk belum masuk & `AI_BLOCKED` | Pengguna tetap mendapat informasi saat layanan mati | e2e "PF-05: AI gagal …", "server mati …" |
| Fitur tambahan PF-02 + PF-05 | – | Baca berurutan **melewati** gambar tanpa objek dan hampir polos (simpangan baku warna < 12 pada 64×64 px) sebelum mengirim ke server; pemilihan manual tetap ke AI | Hemat kuota untuk gambar latar/pemisah | e2e "PF-05: Baca berurutan melewati …" |
| RNF-13 (PF-05) | gambar tidak disimpan di server | Deteksi lokal berjalan di dokumen offscreen extension; gambar **tidak dikirim ke mana pun** untuk deteksi, model & wasm disimpan di extension (tidak diunduh saat berjalan). Hanya jumlah "orang" yang disebut, tanpa menebak identitas | Privasi | `docs/ALUR.md` Tahap 13 |
| RNF-10 | hak akses per peran | Ditambah tes yang memanggil **setiap** rute Admin sebagai pengguna (403) dan tanpa login (401); peran dibaca dari database pada setiap permintaan | Mencegah rute Admin baru lupa dilindungi | `premiumAdmin.test.js` "RNF-10: SETIAP rute …" |

## 3. Rincian per bagian SDD

| Bagian SDD v1.1 | Tertulis di v1.1 | Prototype 1.1.0 | ADR |
|---|---|---|---|
| 2.4 Teknologi — layanan AI | Python 3.12 + **FastAPI 0.115.x**, PyTorch, Transformers; BLIP + MarianMT | Python 3.12 + **FastAPI ≥ 0.162** (starlette ≥ 1.3.1), pillow ≥ 13, SDK **`google-genai`** (Gemini); PyTorch ≥ 2.6 + Transformers 4.x (< 5) untuk cadangan BLIP + MarianMT | ADR-22, ADR-27 |
| 2.4 Kebutuhan perangkat keras | 4 core, 8 GB RAM untuk backend + DB + BLIP | Tetap; dengan Gemini sebagai utama, beban CPU lokal turun (BLIP hanya dimuat sebagai cadangan, di latar). Butuh koneksi internet untuk Gemini | ADR-22 |
| 3.x Arsitektur extension | content script, service worker | Ditambah **dokumen offscreen** (`offscreen/`) untuk mengubah SVG ke JPEG; izin `tts` dan `offscreen` di manifest | – |
| 3.x Sequence UC-GBR-04 | extension → backend → layanan AI (BLIP) | Layanan AI: `CaptionRouter` → Gemini (batas waktu 15 dtk, 1× ulang untuk galat jaringan/5xx) → bila gagal (kuota 429, kunci salah, offline, JSON rusak) → BLIP. Filter keamanan Gemini **tidak** dialihkan (422 `AI_BLOCKED`, kuota dikembalikan). Backend menunggu AI maks. **25 dtk** (`AI_TIMEOUT_MS`) | ADR-22 |
| 3.x Sequence pembayaran | Snap → webhook bertanda tangan → aktivasi | Snap → webhook: tanda tangan → cocokkan `order_id` & nominal dengan database → Status API → `applyStatus` (idempoten) | ADR-25 |
| 3.x Sequence Admin hapus pengguna | konfirmasi → hapus | dialog ketik email → `DELETE /admin/users/:id {konfirmasi_email}` → `BEGIN` → cek email → cek Admin terakhir (`FOR UPDATE` di MySQL) → hapus riwayat → anonimkan transaksi → kosongkan peninjau laporan → hapus akun → `COMMIT` | ADR-26 |
| 4.1 ERD `riwayat_deskripsi` | `riwayat_id, user_id, url_halaman, url_gambar, teks_deskripsi, waktu_dibuat` | Ditambah **`jenis_gambar` VARCHAR(30) NULL** dan **`provider` VARCHAR(30) NULL** | ADR-22 |
| 4.1 ERD `laporan_deskripsi` | `… alasan, status_laporan ENUM('baru','ditinjau') …` | Ditambah **`kategori` VARCHAR(30) NULL**; `alasan` menyimpan label kategori + catatan. Enum status **tidak berubah** | ADR-24 |
| 4.1 ERD `pengaturan_aksesibilitas` | `pintasan_keyboard` default `'Alt+Shift+N'` | Default **`'Alt+Shift+K'`** | ADR-23 |
| Migrasi | – | Basis data lama ditingkatkan otomatis saat backend start: hanya **menambah** kolom yang boleh NULL (`backend/src/db/migrate.js`), data lama tetap | – |
| Antarmuka API | daftar endpoint v1.1 | Endpoint sama. Kontrak baru: `DELETE /admin/users/:id` wajib body `{konfirmasi_email}` dan mengembalikan `{dihapus, riwayat_dihapus, transaksi_dianonimkan}`; kode galat baru `LAST_ADMIN` (409), `PAYMENT_MISMATCH` (400), `PAYMENT_UNCONFIRMED` (409), `AI_BLOCKED` (422). Lihat `docs/API.md` | ADR-25, ADR-26 |
| 2.4 Teknologi — extension (PF-05) | JavaScript MV3 | Ditambah **MediaPipe Tasks Vision 0.10.21** (WebAssembly SIMD) + model **EfficientDet-Lite0 int8** (Apache-2.0) disimpan di `extension/vendor/` (+13,9 MB terurai, +6,1 MB ZIP); CSP extension `script-src 'self' 'wasm-unsafe-eval'` | – |
| 3.x Arsitektur & sequence UC-GBR-04 (PF-05) | content script → service worker → backend | Service worker menormalisasi gambar sekali, lalu **paralel**: (a) dokumen offscreen menjalankan `ObjectDetector` (model dimuat sekali), hasil dikirim ke panel sebagai `NV_QUICK`; (b) `POST /descriptions`. Panel membacakan kilat bila AI > 1 dtk dan mengantrekan deskripsi lengkap. Galat API tertentu → jawaban galat membawa `sederhana`. Mode `auto: 'page'` → galat `AUTO_SKIPPED_PLAIN` bila gambar polos tanpa objek. Backend & API **tidak berubah** | – |
| Keamanan | HTTPS/TLS, JWT HS256, scrypt | Ditambah: batas body 32 KB (kecuali `/descriptions`), CSP & `X-Frame-Options` di halaman HTML, CORS dibatasi ke origin extension, service worker menolak pengirim asing, kunci Gemini disamarkan di log, pemindai rahasia `scripts/pindai_rahasia.py` | – |

## 4. Yang sengaja tidak berubah

- Nomor dan makna **RF-01..RF-30** serta **RNF-01..RNF-13**.
- Status laporan hanya **`baru`** dan **`ditinjau`** (RF-21/22).
- Model bisnis freemium: Gratis 10 deskripsi/hari (reset 00.00 WITA), Premium Rp15.000/30 hari (ADR-07, ADR-11).
- Alur manual utama: **Alt+Shift+K → panel → panah → Enter → dibacakan → Esc** (dijaga oleh tes e2e "ALUR MANUAL").
- File gambar tidak pernah disimpan di server (RNF-13).

## 5. Saran revisi SRS/SDD v1.2

1. SRS 2.4 & SDD 2.4: ganti "Model AI: BLIP" menjadi "Gemini (utama) + BLIP/MarianMT (cadangan)", tambahkan pernyataan privasi tingkat gratis Google AI Studio.
2. SRS 2.5: hapus batasan "SVG dan gambar latar CSS belum dapat dideskripsikan".
3. SRS UC-LAP-01, UC-AKUN-04, UC-PRM-02/03, UC-ADM-03/04: perbarui alur utama/alternatif sesuai tabel bagian 2.
4. SDD ERD: tambah kolom `jenis_gambar`, `provider`, `kategori`; ubah default `pintasan_keyboard`.
5. SDD sequence: perbarui UC-GBR-04 (router Gemini → BLIP), pembayaran (tiga lapis), dan hapus pengguna Admin (satu transaksi).
6. Lampiran perubahan v1.1 → v1.2: rujuk dokumen ini dan ADR-21..ADR-27.
7. SRS 3.1 & fitur tambahan: tambahkan **PF-05 Deteksi objek lokal** (kilat, cadangan tanpa AI, penyaring Baca berurutan, pengaturan "Deskripsi kilat tanpa AI" bawaan aktif); SDD 2.4 & 3.x: komponen MediaPipe di dokumen offscreen dan sequence paralel di atas; THIRD_PARTY_NOTICES: MediaPipe & EfficientDet-Lite0 (Apache-2.0).
