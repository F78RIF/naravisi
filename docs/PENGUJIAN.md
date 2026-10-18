# Laporan & Rencana Pengujian NaraVisi (Fase 6)

Versi kode: 1.0.0 · Tanggal: 10 Oktober 2026 (diperbarui di Fase 7 dan 16 Oktober 2026)

## 1. Ringkasan hasil uji otomatis

| Suite | Lokasi | Jumlah | Hasil | Cara menjalankan |
|---|---|---|---|---|
| Unit + integrasi API (backend) | `backend/test/` | 85 tes | **85 lulus** | `cd backend && npm test` |
| Layanan AI (logika) | `ai-service/tests/test_service.py` | 11 tes | **11 lulus** | `cd ai-service && python -m pytest` |
| Layanan AI (endpoint FastAPI) | `ai-service/tests/test_api.py` | 4 tes | **4 lulus** | idem |
| End-to-end extension + backend + Admin | `e2e/run.mjs` | 63 skenario | **63 lulus** | `cd e2e && npm install && npm test` |

Lingkungan uji otomatis: Chromium 141 (headless, extension dimuat), Node.js 22, basis data SQLite di memori dengan skema yang sama seperti MySQL, model AI dipalsukan (teks tetap). Yang **belum** tercakup otomatis — model AI asli, MySQL sungguhan, pembaca layar, suara nyata — diuji manual di bagian 4.

Teknik yang dipakai:
- **Black-box** per use case: setiap UC diuji alur utama, alur alternatif, dan kondisi gagal.
- **Boundary value**: kuota ke-10/ke-11, pergantian hari 23.59→00.01 WITA, riwayat hari ke-7/ke-8, kecepatan suara 0.5/2.0/5, sandi 7/8 karakter.
- **Keamanan**: token palsu, token kedaluwarsa, akses lintas pengguna, akses Admin oleh pengguna biasa, tanda tangan webhook palsu, permintaan serentak (race condition kuota).
- **Audit aksesibilitas otomatis** (E2E): setiap kontrol berlabel, tombol bernama, gambar ber-alt, satu `h1`, atribut `lang`.

## 2. Matriks traceability kebutuhan fungsional

Legenda file: **A** = `backend/test/auth.test.js`, **D** = `describeQuotaHistory.test.js`, **S** = `settingsReports.test.js`, **P** = `premiumAdmin.test.js`, **I** = `image.test.js`/`aiClient.test.js`, **E** = `e2e/run.mjs`, **M** = uji manual (bagian 4).

| RF | Kebutuhan | UC | Tes | Status |
|---|---|---|---|---|
| RF-01 | Registrasi akun | UC-AKUN-01 | A: registrasi, email ganda, data tidak valid · E: registrasi dari popup | ✅ |
| RF-02 | Lihat profil | UC-AKUN-02 | A: melihat profil · E: profil Premium | ✅ |
| RF-03 | Ubah profil | UC-AKUN-03 | A: ubah nama & sandi · E: ubah nama, sandi pendek ditolak | ✅ |
| RF-04 | Hapus akun permanen | UC-AKUN-04 | A: hapus wajib konfirmasi sandi, lalu tak bisa login | ✅ |
| RF-05 | Login | UC-AKUN-05 | A: login benar/salah · E: login popup & Admin | ✅ |
| RF-06 | Memindai gambar | UC-GBR-01 | E: 5 gambar ditemukan, ikon/tersembunyi/duplikat diabaikan, halaman tanpa gambar, halaman chrome:// | ✅ |
| RF-07 | Menampilkan gambar terdeteksi | UC-GBR-02 | E: daftar menyebut teks alternatif, gambar ditandai | ✅ |
| RF-08 | Memilih gambar | UC-GBR-03 | E: panah atas/bawah, Home, klik | ✅ |
| RF-09 | Mengirim gambar ke AI | UC-GBR-04 | D: wajib login, kuota · I: validasi format/ukuran · E: AVIF→JPEG, SVG→JPEG (`<img>`, SVG inline, latar CSS), data: URL | ✅ |
| RF-10 | Menerima & menyimpan deskripsi | UC-GBR-05 | D: tersimpan ke riwayat · I: error AI dipetakan | ✅ |
| RF-11 | Menampilkan deskripsi teks | UC-GBR-06 | E: teks tampil di panel | ✅ |
| RF-12 | Membacakan + kontrol putar/jeda/ulang/berhenti | UC-GBR-07 | E: teks dikirim ke Web Speech API, tombol kontrol · M: suara nyata | ✅ otomatis · ⏳ manual |
| RF-13 | Menyimpan riwayat | UC-RWY-01 | D: riwayat tercipta; tidak tercipta bila AI gagal | ✅ |
| RF-14 | Daftar riwayat | UC-RWY-02 | D: batas 7 hari Gratis, data lama disembunyikan, paginasi, kosong · E | ✅ |
| RF-15 | Detail riwayat + putar ulang | UC-RWY-03 | D: tidak bisa lihat milik orang lain · E: putar ulang | ✅ |
| RF-16 | Hapus riwayat | UC-RWY-04 | D · E: hapus dengan konfirmasi | ✅ |
| RF-17 | Halaman pengaturan | UC-AKS-01 | S: nilai bawaan · E | ✅ |
| RF-18 | Ubah bahasa & pintasan | UC-AKS-02 | S: normalisasi, bentrok, format salah · E | ✅ |
| RF-19 | Ubah kecepatan, nada, jenis suara | UC-AKS-03 | S: Gratis kecepatan saja, Premium nada & suara · E: "Coba suara", terbuka setelah Premium | ✅ |
| RF-20 | Melaporkan deskripsi | UC-LAP-01 | S: alasan wajib, milik sendiri · E: dari panel (tombol L) | ✅ |
| RF-21 | Admin: daftar laporan | UC-LAP-02 | S · E: dashboard | ✅ |
| RF-22 | Admin: ubah status laporan | UC-LAP-03 | S: tindak lanjut wajib, peninjau tercatat · E | ✅ |
| RF-23 | Daftar paket Premium | UC-PRM-01 | P: Bulanan Rp15.000/30 hari · E | ✅ |
| RF-24 | Memilih paket | UC-PRM-02 | P: paket tidak ada → 404 · E | ✅ |
| RF-25 | Pembayaran & aktivasi Premium | UC-PRM-03 | P: simulasi, Midtrans (Snap, webhook, tanda tangan, cek status, idempoten, gagal, kedaluwarsa) · E: alur bayar lengkap · M: Sandbox asli | ✅ otomatis · ⏳ manual |
| RF-26 | Status & masa aktif langganan | UC-PRM-04 | P: perpanjangan disambung, kembali Gratis saat habis · E | ✅ |
| RF-27 | Admin: tambah pengguna | UC-ADM-01 | P · E | ✅ |
| RF-28 | Admin: daftar pengguna | UC-ADM-02 | P: daftar & cari · E | ✅ |
| RF-29 | Admin: ubah pengguna | UC-ADM-03 | P: nonaktifkan → login & token ditolak; tidak bisa nonaktifkan diri · E | ✅ |
| RF-30 | Admin: hapus pengguna | UC-ADM-04 | P: riwayat terhapus, transaksi dianonimkan · E | ✅ |

**Cakupan: 30/30 RF memiliki tes otomatis.** Dua RF (RF-12, RF-25) masih butuh konfirmasi manual karena bergantung pada perangkat suara dan akun Midtrans.

## 3. Matriks kebutuhan non-fungsional

| RNF | Kebutuhan | Bukti | Status |
|---|---|---|---|
| RNF-01 | Antarmuka sederhana | Uji pengguna (M-05) | ⏳ manual |
| RNF-02 | Kompatibel pembaca layar | Audit otomatis E2E (label, nama tombol, alt, live region) · M-03 NVDA | ✅ otomatis · ⏳ manual |
| RNF-03 | Navigasi keyboard penuh | E: panel penuh keyboard, fokus kembali setelah Esc, tab Admin pakai panah | ✅ |
| RNF-04 | Deskripsi ≤ 5 detik | M-01 dengan model BLIP asli: rata-rata 7,3 dtk, median 4,2 dtk (CPU) | ❌ belum tercapai di CPU |
| RNF-05 | Non-AI ≤ 2 detik | M-02: `GET /history`, `/me` maks. 23 ms | ✅ |
| RNF-06 | Pesan error jelas | I, D: semua kode error berpesan Indonesia · E: kuota habis, belum masuk, server mati | ✅ |
| RNF-07 | HTTPS/TLS | Konfigurasi deploy (di luar cakupan demo localhost) | 📄 didokumentasikan |
| RNF-08 | Sandi ter-hash | A: hash scrypt tidak memuat teks asli | ✅ |
| RNF-09 | Autentikasi token | A: token palsu/kedaluwarsa ditolak | ✅ |
| RNF-10 | Hak akses per peran | S, P: pengguna biasa ditolak di rute Admin; Premium-only di pengaturan | ✅ |
| RNF-11 | Manifest V3 | `extension/manifest.json` · E: extension dimuat di Chromium | ✅ |
| RNF-12 | Info jelas saat AI/internet mati | D: AI mati → 503 & kuota dikembalikan · E: server mati dibacakan | ✅ |
| RNF-13 (baru) | File gambar tidak disimpan | Kode: `descriptionService` hanya menyimpan URL & teks · E: data: URL tersimpan tanpa URL gambar | ✅ |

## 4. Uji manual (wajib dijalankan di laptop)

### M-01 — Kualitas & kecepatan model AI asli (RNF-04)
Jalankan stack lengkap (`README.md`), deskripsikan 10 gambar dari 3 situs berita. Catat waktu dari tekan Enter sampai suara mulai.

| # | Situs | Jenis gambar | Deskripsi NaraVisi | Waktu (dtk) | Akurat? (Y/Sebagian/T) |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| … | | | | | |

Lulus bila rata-rata ≤ 5 detik (setelah model termuat) dan ≥ 70% deskripsi dinilai Y/Sebagian.

**Hasil 16 Oktober 2026** (dijalankan agen; skrip Playwright memuat extension asli, backend + MySQL 8.0.30 Laragon, BLIP base + MarianMT di CPU, laptop RTX 3050 tetapi torch versi CPU). Waktu = tekan Enter → teks tampil & suara mulai diantrekan (headless, suara tidak terdengar). Gambar terbesar di halaman yang dipilih. Penilaian akurasi oleh agen setelah melihat gambarnya; **sebaiknya dikonfirmasi manusia**.

| # | Situs | Jenis gambar | Deskripsi NaraVisi | Waktu (dtk) | Akurat? |
|---|---|---|---|---|---|
| 1 | detik.com | ilustrasi OTT KPK: tangan diborgol, logo KPK | Seorang pria dalam setelan jas dan dasi berdiri di sisi jalan dengan bangunan di latar belakang. | 22,62 | Sebagian (borgol & KPK tidak disebut) |
| 2 | detik.com | dua petugas PLN di depan dinding bergrafiti | Dua orang dalam rompi oranye dan topi keras berdiri di depan gedung terbakar. | 12,22 | Y ("topi keras" = helm proyek) |
| 3 | detik.com | pria memikul tong biru sitaan KPK | Seorang pria dengan seragam polisi memegang ember biru besar. | 9,22 | Sebagian (bukan seragam polisi; tong) |
| 4 | kompas.com | ruang sidang penuh pengunjung | Sekelompok orang duduk di ruang sidang. | 7,11 | Y |
| 5 | kompas.com | dua pejabat berpeci memberi keterangan pers | Dua pria berjas dan topi berbicara ke mikrofon. | 4,14 | Y |
| 6 | kompas.com | dua pria berjas di Istana | Seorang pria dengan setelan berdiri di samping pria lain dalam setelan. | 4,28 | Y |
| 7 | antaranews.com | warga memikul kasur di dekat van biru | Sekelompok orang berjalan di sekitar van biru. | 3,66 | Sebagian (kasur tidak disebut) |
| 8 | antaranews.com | tangan memegang emas batangan | Seorang pria memegang beberapa emas batangan di tangannya. | 2,97 | Y |
| 9 | antaranews.com | pria bermasker diantar polisi | Seorang pria memakai topeng wajah dikawal oleh polisi. | 3,60 | Y ("topeng wajah" = masker) |
| 10 | antaranews.com (beranda) | konferensi pers barang bukti | Sekelompok orang berdiri di sekitar meja. | 3,15 | Sebagian |

- **Akurasi:** 6 Y, 4 Sebagian, 0 T → 100% Y/Sebagian ✅.
- **Kecepatan:** rata-rata **7,30 dtk** ❌ (median 4,21; tanpa permintaan pertama 5,59; kompas + antara saja 4,13). Model sendirian tanpa browser: 2,2–5,9 dtk (rata-rata 3,1), muat model 30,8 dtk.
- Penyebab lambat: model di CPU berbagi prosesor dengan Chromium yang sedang memuat halaman berita berat (detik paling berat; menunggu halaman tenang 15 dtk menurunkan permintaan pertama dari 19 ke 11,6 dtk); unduhan gambar CDN detik ±1,5 dtk.
- Temuan saat uji: permintaan pertama sempat **gagal** "Layanan AI terlalu lama merespons" (16–20 dtk > batas 15 dtk) → C-10.
- Rekomendasi: torch versi CUDA untuk RTX 3050, atau layanan AI di mesin terpisah.

### M-02 — Respons non-AI (RNF-05)
Buka DevTools → Network, muat halaman Riwayat dan Profil 5 kali. Lulus bila semua permintaan API < 2 detik.

**Hasil 16 Oktober 2026** (agen, timing jaringan Playwright pada stack MySQL): `GET /history` 8–23 ms, `GET /me` 7–16 ms dari 5 kali muat → **lulus** ✅.

### M-03 — Pembaca layar NVDA (RNF-02, RF-12)
Dengan NVDA aktif di Windows:
1. Tekan Alt+Shift+K → NVDA mengumumkan "NaraVisi, dialog" dan jumlah gambar.
2. Panah bawah → nama "Gambar 2 dari N" dan teks alternatif dibaca.
3. Enter → status "Mendeskripsikan…", lalu TTS NaraVisi membacakan deskripsi tanpa bertabrakan dengan NVDA.
4. Tombol Putar/Jeda/Ulang/Berhenti dapat dijangkau dengan Tab dan berfungsi.
5. Halaman Pengaturan & Riwayat: setiap kontrol diumumkan dengan labelnya.

Catat masalah: ____________________

### M-04 — Midtrans Sandbox (RF-25)
1. Isi `MIDTRANS_SERVER_KEY` dengan Server Key Sandbox, jalankan ulang backend (log: "Pembayaran: sandbox").
2. Beli Premium → halaman Snap terbuka → pilih QRIS → selesaikan dengan simulator Sandbox Midtrans.
3. Kembali ke halaman Premium → "Cek status pembayaran" → status Premium.
(Webhook ke localhost tidak sampai; status tetap diperbarui lewat pengecekan langsung ke Midtrans.)

### M-05 — Uji pengguna bersama teman difabel (RNF-01, evaluasi)
Durasi ±30 menit. Peserta memakai perangkat & pembaca layarnya sendiri. Pengamat hanya mencatat, tidak membantu kecuali peserta macet > 2 menit.

| Tugas | Berhasil tanpa bantuan? | Waktu | Catatan |
|---|---|---|---|
| T1. Daftar akun dari popup | | | |
| T2. Buka situs berita, pindai gambar dengan pintasan | | | |
| T3. Dengarkan deskripsi gambar ke-3 | | | |
| T4. Ulangi & hentikan suara | | | |
| T5. Laporkan deskripsi yang salah | | | |
| T6. Ubah kecepatan suara | | | |
| T7. Buka riwayat dan putar ulang satu deskripsi | | | |

Pertanyaan penutup (skala 1–5): kemudahan, kejelasan deskripsi, kenyamanan suara, apakah akan dipakai lagi. Masukan terbuka: ____________________

### M-06 — MySQL sungguhan
`npm run db:setup` lalu `npm start` dengan `DB_DRIVER=mysql`; ulangi T1–T7 cepat. Pastikan data tampil di DBeaver pada tabel `users`, `riwayat_deskripsi`, `kuota_harian`, `laporan_deskripsi`, `transaksi`, `langganan`.

**Hasil 16 Oktober 2026** (agen, MySQL 8.0.30 Laragon; diperiksa dengan kueri SQL, bukan DBeaver): registrasi & login, 10 deskripsi model asli (`riwayat_deskripsi`, `kuota_harian`), laporan (`laporan_deskripsi`), kecepatan suara 1.5 (`pengaturan_aksesibilitas`), lihat/hapus riwayat, beli Premium simulasi (`transaksi` berhasil → `langganan` sampai 2026-11-14), Admin meninjau laporan, Admin menghapus 5 akun uji (riwayat ikut terhapus, transaksi dianonimkan `user_id = NULL`). Permintaan yang gagal karena batas waktu tidak mengurangi kuota (9 riwayat = 9 kuota). → **lulus** ✅ (T1–T7 lewat API; versi lewat UI tercakup E2E).

## 5. Cacat yang ditemukan & diperbaiki selama Fase 6

| # | Temuan | Perbaikan |
|---|---|---|
| C-01 | Pintasan `shift+alt+y` ditolak karena urutan modifier | Normalisasi sebelum validasi format |
| C-02 | Kotak pesan menempel di atas formulir menutupi kolom pintasan saat digulir | Kotak pesan tidak lagi `sticky` |
| C-03 | Service worker belum siap saat extension pertama dimuat (uji) | Uji menunggu API `chrome.*` siap |
| C-04 | Deskripsi gagal tetap mengurangi kuota (risiko desain) | Kuota dipesan lalu dikembalikan bila AI gagal; diuji |
| C-05 | Permintaan serentak berpotensi melewati batas kuota | `UPDATE … WHERE jumlah < batas` atomik; diuji 15 permintaan serentak |
| C-06 | (Fase 7) Login tanpa batas percobaan gagal | Dikunci 15 menit setelah 10 gagal per (email, IP) — E-01 |
| C-07 | (Fase 7) Semua rute menerima body JSON hingga ±7 MB | Batas 32 KB kecuali `/descriptions` — E-02 |
| C-08 | (Fase 7) Halaman HTML tanpa CSP | CSP & X-Frame-Options — E-03 |
| C-09 | (Fase 7) Video demo: rekaman terpotong saat extension aktif | `viewport: null` + tinggi jendela 860 di `e2e/demo.mjs` |
| C-10 | (M-01) Permintaan pertama ke model asli gagal "Layanan AI terlalu lama merespons": 16–20 dtk > `AI_TIMEOUT_MS` 15 dtk saat model CPU berbagi prosesor dengan browser | `AI_TIMEOUT_MS` bawaan 25 dtk (masih di bawah batas extension 30 dtk) + pemanasan model saat layanan AI start. Pemanasan saja tidak cukup (diuji ulang) |
| C-11 | (M-01) Thumbnail berita detik.com berupa gambar latar CSS sehingga tidak terdeteksi (3 dari 15 gambar); SVG ditolak | Pemindai mengenali `background-image`, SVG inline, dan `<img>` SVG; SVG diubah ke JPEG di dokumen offscreen |

Evaluasi lengkap (cakupan, performa, keamanan, aksesibilitas): `docs/EVALUASI.md`.
