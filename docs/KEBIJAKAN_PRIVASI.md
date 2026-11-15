# Kebijakan Privasi NaraVisi

Berlaku untuk extension Chrome NaraVisi versi 1.1.0 dan server NaraVisi. Pembaruan terakhir: 15 November 2026.

NaraVisi membantu pengguna tunanetra memahami gambar di halaman web. Dokumen ini menjelaskan data apa yang diproses,
di mana, dan untuk apa, dengan bahasa sederhana.

## 1. Yang diproses di perangkat Anda (tidak dikirim ke mana pun)

Fitur berikut berjalan **sepenuhnya di komputer Anda**, di dalam extension (dokumen offscreen). Gambar **tidak
dikirim** ke server NaraVisi, ke Google, atau ke pihak lain untuk keperluan ini. Semua pustaka, model, dan data bahasa
sudah ada di dalam extension, jadi tidak ada yang diunduh dari internet saat fitur berjalan.

| Fitur | Yang dihasilkan | Keterangan |
|---|---|---|
| Deteksi benda (PF-05) | jenis & jumlah benda, mis. "2 orang" | hanya jumlah orang yang disebut; tidak ada pengenalan wajah atau identitas |
| Warna dominan (PF-08) | maks. 2 nama warna | dihitung dari gambar yang diperkecil ke 64×64 piksel |
| Tulisan di gambar / OCR (PF-06) | teks yang terbaca, maks. 300 karakter | Tesseract.js dengan data bahasa Indonesia & Inggris di extension |
| Kode QR & barcode (PF-07) | nama domain tautan, atau teks pendek | tautan **tidak pernah dibuka otomatis**; tab baru hanya dibuka setelah Anda mengonfirmasi |

Hasil fitur lokal hanya dibacakan dan ditampilkan di panel. Hasil itu **tidak** disimpan di server dan **tidak** masuk
Riwayat. Hasilnya disimpan sementara di memori tab dan hilang saat halaman dimuat ulang atau ditutup. Setiap fitur bisa
dimatikan di **Pengaturan → Otomatis** ("Deskripsi kilat tanpa AI", "Sebutkan warna", "Baca tulisan di gambar
(offline)", "Baca kode QR").

## 2. Yang dikirim ke server NaraVisi

* **Gambar yang Anda pilih** (tekan Enter, atau Baca berurutan bila Anda menyalakannya) dikirim ke server NaraVisi
  untuk dideskripsikan oleh AI. Server **tidak menyimpan berkas gambar**. Yang disimpan di Riwayat hanya teks
  deskripsi, alamat halaman, dan alamat gambar.
* **Akun**: nama, email, dan kata sandi yang di-hash (tidak bisa dibaca kembali), pengaturan suara, kuota harian, dan
  laporan deskripsi yang Anda kirim.
* **Baca berurutan** bawaannya mati dan hanya aktif setelah persetujuan yang dibacakan. Mode ini tidak pernah berjalan di
  Incognito, halaman dengan kolom kata sandi, atau situs dalam daftar pengecualian (bank, dompet digital, email).

## 3. Pihak ketiga

* **Google Gemini** (bila server memakai `CAPTION_PROVIDER=gemini`): gambar yang Anda pilih diteruskan server ke Google
  untuk dideskripsikan. Pada tingkat gratis Google AI Studio, **data tersebut dapat dipakai Google untuk meningkatkan
  produknya**. Pengelola server bisa memilih model lokal BLIP agar gambar tidak keluar dari server.
* **Midtrans** (hanya untuk pembayaran Premium, mode Sandbox/simulasi).
* Fitur lokal pada bagian 1 **tidak** melibatkan pihak ketiga mana pun.

## 4. Hak Anda

* Menghapus satu atau semua Riwayat, dan menghapus akun beserta seluruh datanya, dari halaman Profil/Riwayat.
* Mematikan fitur lokal maupun Baca berurutan kapan saja di Pengaturan.

## 5. Izin extension

| Izin | Untuk apa |
|---|---|
| `activeTab`, `scripting` | memasang panel NaraVisi dan penghitung gambar di halaman |
| `storage` | sesi masuk dan pengaturan (tidak bisa dibaca situs web) |
| `tts` | pemandu suara |
| `offscreen` | dokumen tersembunyi untuk SVG → JPEG dan fitur lokal (benda, warna, tulisan, kode QR) |
| `<all_urls>` | mengambil gambar dari halaman yang sedang Anda baca |

Pertanyaan tentang privasi dapat disampaikan kepada pengelola NaraVisi melalui kontak di halaman proyek.
