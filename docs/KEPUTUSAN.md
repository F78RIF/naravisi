# Catatan Keputusan Desain (Architecture Decision Record)

Setiap keputusan yang mengubah atau melengkapi SRS/SDD v1.0 dicatat di sini, lalu dimasukkan ke SRS/SDD v1.1.

| ID | Tanggal | Keputusan | Status | Dampak dokumen |
|---|---|---|---|---|
| ADR-01 | 2026-10-08 | **Model bisnis: freemium** (Gratis + Premium), sesuai SRS/SDD v1.0. | Final (pemilik produk) | Tidak ada perubahan. |
| ADR-02 | 2026-10-08 | **Model AI gratis & lokal**: BLIP `Salesforce/blip-image-captioning-base` untuk caption bahasa Inggris, diterjemahkan dengan MarianMT `Helsinki-NLP/opus-mt-en-id`. Provider dapat diganti lewat `CAPTION_PROVIDER` (mis. ke API vision di masa depan). | Final (pemilik produk) | SRS 2.4 "Model AI: ditentukan saat implementasi" → isi nama model. |
| ADR-03 | 2026-10-08 | **Deadline demo: 30 hari** (± 7 November 2026). | Final | Jadwal di Implementation Plan. |
| ADR-04 | 2026-10-08 | **Gambar diambil oleh extension**, bukan oleh server: service worker mengunduh byte gambar (ikut cookie situs), mengonversi AVIF/format lain ke JPEG, memperkecil ke sisi maks 1280 px, lalu mengirim base64. Server tidak pernah mengakses URL dari klien (mencegah SSRF). | Diterapkan | SDD Sequence UC-GBR-04: tambahkan langkah "ambil & normalisasi gambar". |
| ADR-05 | 2026-10-08 | **Hasil ditampilkan di panel dalam halaman** (Shadow DOM, `role="dialog"`), bukan di popup, karena popup Chrome tertutup saat kehilangan fokus sehingga suara TTS ikut terputus. Popup tetap dipakai untuk tombol pindai & status server. | Diterapkan | SRS 3.1 komponen antarmuka no. 1, 4, 5: sebut "panel NaraVisi pada halaman". |
| ADR-06 | 2026-10-08 | **Teks deskripsi tidak diletakkan di live region** agar pembaca layar tidak membacanya bersamaan dengan TTS. Live region hanya untuk status singkat. | Diterapkan | RNF-02: catat sebagai strategi kompatibilitas pembaca layar. |
| ADR-07 | 2026-10-08 | **Kuota Gratis: 10 deskripsi/hari**, reset pukul 00.00 WITA. | Final | SRS 1.3 no. 6, 2.5 no. 7. |
| ADR-08 | 2026-10-08 | **Fitur Admin "kelola paket" & "pantau penggunaan" dihapus dari SRS/SDD** (tidak ada RF/UC-nya). Paket diisi lewat seed database. | Final | SRS 1.1 no. 5, 2.1, 2.2 no. 5; SDD 2.1. |
| ADR-09 | 2026-10-08 | **Status Premium diturunkan dari tabel `langganan`** (aktif bila `tanggal_berakhir ≥ hari ini`), `users.peran` menjadi `ENUM('pengguna','admin')`. | Final | ERD SDD 4.1. |
| ADR-10 | 2026-10-08 | **TTS Premium = semua suara di perangkat + pengaturan nada & kecepatan** (Web Speech API). Pengguna Gratis memakai 1 suara default. | Final | SRS 2.3, UC-AKS-03. |
| ADR-11 | 2026-10-08 | **Paket Premium: satu paket Bulanan, Rp15.000 / 30 hari.** Premium boleh membeli lagi; masa aktif ditambah 30 hari dari `tanggal_berakhir`. | Final | UC-PRM-01..03, seed `paket_premium`. |
| ADR-12 | 2026-10-08 | **Riwayat Gratis > 7 hari disembunyikan**, tidak dihapus; terlihat lagi setelah upgrade. | Final | UC-RWY-02. |
| ADR-13 | 2026-10-08 | **Hapus akun**: profil, pengaturan, kuota, riwayat, dan laporan ikut terhapus; transaksi disimpan dengan `user_id` = NULL. Hapus riwayat → laporannya ikut terhapus. | Final | UC-AKUN-04, UC-ADM-04, ERD (`ON DELETE`). |
| ADR-14 | 2026-10-08 | **Privasi (RNF-13 baru)**: file gambar tidak disimpan di server; yang disimpan hanya URL gambar, URL halaman, dan teks deskripsi. | Final | SRS bab 5. |
| ADR-15 | 2026-10-08 | **Admin memakai dashboard web** yang disajikan backend, bukan popup extension. | Final | UC-AKUN-05. |
