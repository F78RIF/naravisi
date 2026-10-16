# Evaluasi NaraVisi v1.0 (Fase 7)

Tanggal: 10 Oktober 2026 (bagian 1, 5, 7, 8 diperbarui 16 Oktober 2026) · Versi kode: 1.0.0 · Penyusun: Rifat Arifaldo (dibantu agen AI, lihat `AGENTIC_SDLC_LOG.md`)

Dokumen ini menilai hasil implementasi terhadap SRS v1.1. Angka di bawah diukur langsung dari kode; bagian yang memerlukan perangkat nyata atau peserta manusia ditandai **⏳ menunggu uji manual** dan **tidak boleh diisi dengan perkiraan**.

## 1. Ringkasan

| Aspek | Hasil | Status |
|---|---|---|
| Kebutuhan fungsional | 30/30 RF terimplementasi dan memiliki tes otomatis | ✅ |
| Kebutuhan non-fungsional | 10/13 RNF terbukti otomatis; RNF-05 juga terbukti di laptop (M-02); RNF-04 **belum tercapai** di CPU; RNF-01 menunggu uji pengguna; RNF-07 berlaku saat deploy HTTPS | ⏳ sebagian |
| Tes otomatis | Backend 85/85 · AI service 15/15 · E2E 63/63 | ✅ |
| Cakupan kode backend | 94,9% baris · 88,5% cabang · 95,7% fungsi (termasuk berkas uji); adaptor MySQL tidak tercakup karena butuh server MySQL | ✅ |
| Waktu respons non-AI (RNF-05) | p95 ≤ 3,5 ms untuk enam endpoint baca/tulis biasa; login p95 61 ms | ✅ |
| Kecepatan & mutu model AI (RNF-04) | Mutu: 10/10 deskripsi Y/Sebagian. Kecepatan: rata-rata 7,3 dtk (median 4,2) di CPU, target ≤ 5 dtk | ⚠️ M-01: mutu ✅, kecepatan ❌ |
| Uji pengguna difabel | Belum dilaksanakan | ⏳ M-05 |

## 2. Pemenuhan kebutuhan

Matriks lengkap RF/RNF → tes ada di `PENGUJIAN.md` bagian 2–3. Ringkasnya:

| Modul | RF | Terimplementasi | Diuji otomatis |
|---|---|---|---|
| Akun & Profil | RF-01..05 | 5/5 | 5/5 |
| Pemrosesan Gambar & AI | RF-06..12 | 7/7 | 7/7 (suara nyata: manual) |
| Riwayat | RF-13..16 | 4/4 | 4/4 |
| Aksesibilitas | RF-17..19 | 3/3 | 3/3 |
| Laporan | RF-20..22 | 3/3 | 3/3 |
| Premium & Transaksi | RF-23..26 | 4/4 | 4/4 (Midtrans asli: manual) |
| Admin | RF-27..30 | 4/4 | 4/4 |

## 3. Kualitas perangkat lunak

### 3.1 Ukuran kode (baris non-kosong)

| Komponen | Berkas | Baris |
|---|---|---|
| Extension (JS/HTML/CSS) | 16 | 1.828 |
| Backend `src` (JS/SQL) | 29 | 1.996 + rate limiter |
| Dashboard Admin (`public`) | 3 | 594 |
| Layanan AI (Python) | 6 | 286 |
| Tes backend | 10 | ±990 |
| Tes AI service | 3 | 99 |
| Tes E2E + skrip demo | 2 | ±800 |

Rasio kode uji terhadap kode produksi ±0,4 : 1.

### 3.2 Cakupan tes backend (`node --test --experimental-test-coverage`)

| Bagian | Baris | Cabang | Catatan |
|---|---|---|---|
| services/* | 89–100% | 69–100% | Semua service ≥ 89% baris |
| http/* | 87–100% | 80–100% | |
| lib/* | 91–100% | 78–96% | |
| db/index.js | 56% | 71% | Adaptor MySQL hanya teruji dengan server MySQL (M-06) |
| **Keseluruhan** | **94,9%** | **88,5%** | |

### 3.3 Waktu respons backend (RNF-05)

Diukur dengan `node backend/scripts/bench.js 200` — server di proses yang sama, SQLite di memori, 200 baris riwayat, CPU 2 inti. Dengan MySQL melalui jaringan lokal, tambahkan ±1–5 ms per kueri.

| Endpoint | n | p50 (ms) | p95 (ms) | maks (ms) |
|---|---|---|---|---|
| GET /me | 200 | 1,3 | 3,5 | 5,8 |
| GET /me/quota | 200 | 1,1 | 1,7 | 8,3 |
| GET /history | 200 | 1,0 | 1,5 | 6,4 |
| GET /settings | 200 | 0,8 | 1,1 | 6,1 |
| PUT /settings | 200 | 1,1 | 1,8 | 9,8 |
| GET /plans | 200 | 0,5 | 1,0 | 7,2 |
| POST /auth/login | 50 | 48,2 | 61,4 | 68,0 |
| POST /descriptions (AI dipalsukan) | 200 | 1,4 | 2,3 | 12,6 |

Login sengaja lebih lambat karena hash scrypt (perlindungan terhadap penebakan sandi). Seluruh endpoint jauh di bawah batas 2 detik. Waktu total deskripsi (RNF-04) = overhead backend di atas + waktu model AI + unduh gambar oleh extension → diukur di M-01.

### 3.4 Aksesibilitas (RNF-02, RNF-03)

Audit otomatis di E2E memeriksa 7 tampilan (popup, panel, Riwayat, Pengaturan, Premium, Profil, Dashboard Admin): setiap kontrol berlabel, setiap tombol/tautan bernama, setiap gambar ber-`alt`, satu `h1`, atribut `lang`. Hasil: **0 temuan**.

Tinjauan manual terhadap kriteria WCAG 2.1 yang relevan:

| Kriteria | Penerapan | Status |
|---|---|---|
| 2.1.1 Keyboard | Semua fungsi panel lewat keyboard; tab Admin pakai panah | ✅ |
| 2.1.2 No Keyboard Trap | Esc menutup panel & mengembalikan fokus ke halaman | ✅ (diuji E2E) |
| 2.4.3 Focus Order | Fokus otomatis ke daftar gambar / kolom pertama | ✅ |
| 2.4.7 Focus Visible | Garis fokus 3 px kontras tinggi di semua kontrol | ✅ |
| 4.1.2 Name, Role, Value | `role=dialog`, `listbox`/`option`, `aria-selected`, `aria-activedescendant` | ✅ |
| 4.1.3 Status Messages | Status di live region; deskripsi dibacakan TTS (tanpa pembacaan ganda) | ✅ · ⏳ M-03 dengan NVDA |
| 1.4.3 Kontras | Teks gelap di latar terang, tombol biru #0b57d0 dengan teks putih | ✅ (perlu verifikasi alat kontras) |

## 4. Review keamanan & perbaikan

| # | Temuan | Risiko | Perbaikan | Bukti |
|---|---|---|---|---|
| E-01 | Login tidak membatasi percobaan gagal → kata sandi bisa ditebak beruntun | Sedang | Maks 10 gagal per (email, IP) dalam 15 menit → `429 TOO_MANY_ATTEMPTS`; berhasil login mengatur ulang hitungan | `security.test.js` |
| E-02 | Semua rute menerima JSON hingga ±7 MB → mudah dibebani | Rendah–sedang | Hanya `/descriptions` menerima body besar; rute lain 32 KB → `413 PAYLOAD_TOO_LARGE` | `security.test.js` |
| E-03 | Halaman Admin & pembayaran tanpa Content-Security-Policy | Rendah | CSP `script-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY` | `security.test.js` |
| E-04 | Server berjalan diam-diam dengan kunci JWT pengembangan | Sedang | Peringatan di log saat `JWT_SECRET` kosong; ditolak bila `NODE_ENV=production` | `server.js`, `config.js` |
| E-05 | Popup menyusun HTML dengan `innerHTML` dari data server | Rendah | Diganti penyusunan DOM | `popup.js` |

Sudah aman sejak awal (diverifikasi): hash scrypt + perbandingan waktu-konstan, token ditolak setelah akun dinonaktifkan, isolasi data antar pengguna (riwayat, laporan, transaksi), verifikasi tanda tangan webhook Midtrans, aktivasi Premium idempoten, server tidak mengunduh URL kiriman klien (tanpa SSRF), file gambar tidak disimpan (RNF-13).

Risiko yang diterima: penguncian login disimpan di memori (hilang saat server restart; cukup untuk satu server); gambar dalam laporan dimuat browser Admin langsung dari situs asal.

## 5. Keterbatasan yang diketahui

1. **Mutu deskripsi**: BLIP base menghasilkan kalimat pendek berbahasa Inggris lalu diterjemahkan; untuk gambar kompleks (infografis, teks dalam gambar) deskripsi kurang informatif. Peningkatan: model lebih besar (BLIP large / Florence-2) atau API vision — cukup ganti `CAPTION_PROVIDER`.
2. **Kecepatan model di CPU** (M-01): rata-rata 7,3 dtk bila model dan browser berbagi satu laptop. Perbaikan: torch versi CUDA (laptop punya RTX 3050) atau layanan AI di mesin terpisah. Gambar SVG dan latar CSS kini didukung (16 Okt); latar hanya dari `url(...)` pertama, gradien dan sprite kecil diabaikan.
3. **Pintasan keyboard** hanya bisa diterapkan dari `chrome://extensions/shortcuts` (batasan Chrome).
4. **Webhook Midtrans** butuh URL publik; di localhost status diperbarui lewat pengecekan langsung.
5. **Suara** bergantung pada suara TTS yang terpasang di perangkat; Windows tanpa paket bahasa Indonesia tidak punya suara Indonesia.

## 6. Retrospektif Agentic SDLC

| Yang berjalan baik | Yang perlu diperbaiki |
|---|---|
| Audit dokumen di awal menemukan 7 blocker sebelum menulis kode | Model AI asli tidak pernah dijalankan oleh agen (keterbatasan lingkungan) → risiko terbesar proyek baru tervalidasi di M-01 |
| Setiap keputusan tercatat (ADR-01..20) dan disetujui manusia | File .docx asli tidak tersedia → SRS/SDD v1.1 disusun ulang tanpa tracked changes |
| Tes ditulis bersamaan dengan kode; 5 cacat (C-01..C-05) dan 5 temuan keamanan (E-01..E-05) tertangkap sebelum demo | Uji pengguna difabel baru bisa dilakukan setelah semua fitur selesai; idealnya prototipe panel diuji lebih awal |
| Satu tabel rute untuk Express & node:http membuat seluruh API teruji tanpa paket eksternal | Beberapa penyesuaian (ADR-10, ADR-16) diputuskan agen lalu diajukan, bukan ditanyakan lebih dulu |

## 7. Hasil uji manual (diisi setelah M-01..M-06)

| Uji | Target | Hasil | Lulus? |
|---|---|---|---|
| M-01 Model AI asli | rata-rata ≤ 5 dtk, ≥ 70% deskripsi Y/Sebagian | 10 gambar dari detik, kompas, antara: 6 Y, 4 Sebagian, 0 T; rata-rata 7,30 dtk, median 4,21 dtk | Mutu ✅ · kecepatan ❌ |
| M-02 Respons non-AI di laptop | < 2 dtk | `GET /history` maks. 23 ms, `GET /me` maks. 16 ms | ✅ |
| M-03 NVDA | 5 langkah tanpa hambatan | ⏳ | ⏳ |
| M-04 Midtrans Sandbox | bayar QRIS → Premium | ⏳ | ⏳ |
| M-05 Uji pengguna difabel | T1–T7 tanpa bantuan, skor ≥ 4/5 | ⏳ | ⏳ |
| M-06 MySQL | alur T1–T7 & data tampil di DBeaver | MySQL 8.0.30: semua tabel terisi & terhapus sesuai aturan (diperiksa dengan SQL, bukan DBeaver) | ✅ |

## 8. Kesimpulan

NaraVisi v1.0 memenuhi seluruh 30 kebutuhan fungsional dan sebagian besar kebutuhan non-fungsional yang dapat diverifikasi secara otomatis, dengan cakupan tes backend ±95% dan waktu respons non-AI jauh di bawah target. Kelayakan rilis bergantung pada dua hal yang belum terukur: **kecepatan dan mutu model AI di perangkat nyata (M-01)** serta **kemudahan penggunaan oleh pengguna tunanetra (M-03, M-05)**. Keduanya wajib diselesaikan sebelum demo.

**Pembaruan 16 Oktober 2026.** M-01, M-02, dan M-06 sudah dijalankan oleh agen (rincian di `PENGUJIAN.md` bagian 4). Mutu deskripsi cukup (tidak ada deskripsi yang salah total), tetapi kecepatan rata-rata 7,3 dtk belum memenuhi RNF-04 selama model berjalan di CPU yang sama dengan browser. Batas waktu AI dinaikkan ke 25 dtk agar permintaan lambat tidak gagal (C-10). M-03 (NVDA), M-04 (Midtrans Sandbox), dan M-05 (uji pengguna) tetap memerlukan manusia.
