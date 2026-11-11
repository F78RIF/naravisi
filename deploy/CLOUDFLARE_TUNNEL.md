# NaraVisi online dari laptop (Cloudflare Tunnel, gratis)

Cara paling murah (Rp0, tanpa akun Cloudflare, tanpa kartu) agar orang lain bisa memakai NaraVisi: laptop Anda menjadi
server, dan **Cloudflare Quick Tunnel** memberi alamat `https://<acak>.trycloudflare.com` yang meneruskan permintaan ke
backend di `http://localhost:3000`.

```
Pengguna (extension) ──https──▶ Cloudflare ──tunnel──▶ cloudflared (laptop) ──▶ backend :3000 ──▶ ai-service :8000
                                                                                             └──▶ MySQL :3306
```

Yang terbuka ke internet **hanya backend (port 3000)**. Layanan AI (8000) dan MySQL (3306) tetap hanya di laptop.

## 1. Pasang cloudflared (sekali saja)

Pilih salah satu:

- **winget** (sudah ada di Windows 10/11). Buka PowerShell, jalankan:

  ```
  winget install --id Cloudflare.cloudflared
  ```

- **Unduh manual:** buka <https://github.com/cloudflare/cloudflared/releases/latest>, unduh
  `cloudflared-windows-amd64.msi`, lalu jalankan pemasangnya.

Tutup PowerShell, buka yang **baru**, lalu periksa:

```
cloudflared --version
```

Bila muncul nomor versi, cloudflared siap. Tidak perlu login atau membuat akun Cloudflare untuk Quick Tunnel.

## 2. Siapkan mode production (sekali saja)

`scripts/start-online.ps1` menjalankan semuanya dengan `APP_ENV=production`. Di mode ini server **menolak start**
bila kunci belum lengkap (lihat README bagian "Mode production"):

| Berkas | Isi yang wajib |
|---|---|
| `backend/.env` | `JWT_SECRET` (teks acak ≥ 32 karakter), `ALLOWED_ORIGINS` (`chrome-extension://<ID extension>`), `MIDTRANS_SERVER_KEY` (Server Key **Sandbox**), `MIDTRANS_IS_PRODUCTION=false`, `ADMIN_PASSWORD` yang kuat |
| `ai-service/.env` | `CAPTION_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `FALLBACK_PROVIDER=blip` |

`PUBLIC_URL` **tidak perlu** diisi: skrip mengisinya otomatis dengan alamat tunnel. `APP_ENV` juga diatur oleh skrip.

Membuat `JWT_SECRET` acak:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Jalankan

Dari folder `naravisi`:

```
powershell -ExecutionPolicy Bypass -File scripts\start-online.ps1
```

Skrip ini:

1. memeriksa syarat (`.venv`, `.env`, `node_modules`, cloudflared, port 3000/8000 kosong);
2. menyalakan **MySQL** bila `DB_DRIVER=mysql` dan port 3306 belum aktif. Urutannya: service Windows, Laragon
   (versi aktif di `C:\laragon\usr\laragon.ini`), lalu XAMPP. Lokasi lain bisa diberikan dengan `-MysqldPath`;
3. menjalankan **layanan AI** dan menunggu `/health`;
4. membuka **Cloudflare Tunnel** dan membaca alamat `https://….trycloudflare.com` dari lognya
   (`%TEMP%\naravisi-online\cloudflared.log`);
5. menjalankan **backend** dengan `PUBLIC_URL` = alamat itu. Berkas `.env` tidak diubah; nilainya hanya diberikan ke
   proses backend. Backend sengaja dijalankan *setelah* tunnel karena `PUBLIC_URL` harus sudah diketahui saat start;
6. memeriksa `<alamat>/api/v1/health` dari internet, lalu mencetak:

```
================================================================
 NaraVisi online: https://contoh-acak.trycloudflare.com
================================================================
  Alamat API untuk extension : https://contoh-acak.trycloudflare.com/api/v1   (sudah disalin ke clipboard)
  Dashboard Admin            : https://contoh-acak.trycloudflare.com/admin/
  Webhook Midtrans Sandbox   : https://contoh-acak.trycloudflare.com/api/v1/payments/notification
```

Setiap layanan terbuka di jendela PowerShell sendiri. Untuk **berhenti**, tutup jendela backend, cloudflared, dan
layanan AI. MySQL dibiarkan menyala.

Hanya mencoba tunnel tanpa kunci lengkap (jangan bagikan alamatnya):
`scripts\start-online.ps1 -Mode development`.

## 4. Sambungkan extension

1. Klik ikon NaraVisi → **Pengaturan** → bagian **Koneksi server**.
2. Tempel alamat API (sudah ada di clipboard), mis. `https://contoh-acak.trycloudflare.com/api/v1`.
3. Tekan **Simpan alamat**. Status harus berubah menjadi aktif.

Orang lain melakukan hal yang sama di extension mereka. Langkah 4 rencana (paket ZIP dengan alamat bawaan) akan
mempermudah ini.

## 5. (Opsional) Webhook Midtrans

Di <https://dashboard.sandbox.midtrans.com> → Settings → Payment → **Notification URL**, isi alamat webhook yang
dicetak skrip. Tanpa webhook pun pembayaran tetap terdeteksi, karena backend memeriksa status ke Midtrans setiap kali
pengguna membuka halaman Premium.

## Batasan (penting)

| Batasan | Akibat | Cara mengatasi |
|---|---|---|
| **Alamat berganti setiap kali** skrip dijalankan | pengguna harus memasukkan alamat baru; Notification URL Midtrans juga harus diperbarui | bagikan alamat baru setiap sesi, atau pakai server tetap (Langkah 3: Oracle Cloud Always Free) |
| **Laptop harus menyala** dan terhubung internet | laptop tidur/mati = NaraVisi tidak bisa diakses | Pengaturan Windows → Power → "Sleep: Never" selama dipakai |
| Quick Tunnel ditujukan untuk **uji coba**, tanpa jaminan ketersediaan, dengan batas permintaan bersamaan | tidak cocok untuk banyak pengguna sekaligus | cukup untuk demo dan uji pengguna kecil |
| Kecepatan bergantung pada internet & CPU laptop | deskripsi bisa lebih lambat bila Gemini sibuk dan BLIP jalan di CPU | – |
| Kuota Gemini tingkat gratis terbatas per menit/hari | saat habis, deskripsi dibuat BLIP (diumumkan dengan sopan) | – |

## Keamanan

- Hanya port 3000 yang diteruskan; MySQL dan layanan AI tidak terjangkau dari internet.
- Dashboard Admin ikut terbuka di `/admin/`. Pakai `ADMIN_PASSWORD` yang kuat. Login gagal 10× dikunci 15 menit.
- Mode production menolak start tanpa `JWT_SECRET` yang kuat, jadi token tidak bisa dipalsukan dengan kunci contoh dari repo.
- Jangan pernah membagikan isi `.env`. Skrip ini tidak membaca atau menampilkannya (kecuali baris `DB_DRIVER`).
