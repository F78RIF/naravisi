# NaraVisi di Oracle Cloud Always Free (server tetap, Rp0)

Berbeda dengan Cloudflare Tunnel (`deploy/CLOUDFLARE_TUNNEL.md`), cara ini memberi **alamat tetap**
(`https://<nama>.duckdns.org`) dan server yang **menyala 24 jam** tanpa laptop. Semua komponennya gratis:

| Komponen | Layanan gratis |
|---|---|
| Server | Oracle Cloud **Always Free**: VM Ampere A1 (ARM64), Ubuntu |
| Nama domain | **DuckDNS** (`<nama>.duckdns.org`) |
| Sertifikat HTTPS | **Let's Encrypt** (diperpanjang otomatis) |
| AI | Gemini tingkat gratis + BLIP di CPU VM |
| Pembayaran | Midtrans **Sandbox** |

```
Internet ──443──▶ nginx (HTTPS) ──▶ backend :3000 ──▶ ai-service :8000 ──▶ Gemini (internet)
   │                                     └──▶ mysql :3306
   └──80── (verifikasi Let's Encrypt, lalu dialihkan ke https)
```

Hanya **nginx** yang membuka port (80 & 443). backend, ai-service, dan MySQL tidak punya port ke luar.

> ⚠️ **Tetap di sumber daya "Always Free".** Oracle meminta kartu kredit/debit saat mendaftar (verifikasi, tidak
> ditagih). Biaya baru muncul bila Anda **meng-upgrade akun ke Pay As You Go** *dan* memakai sumber daya di luar batas
> gratis. Ikuti peringatan ⚠️ di setiap langkah. Angka batas di bawah sesuai halaman Always Free Oracle saat panduan
> ini ditulis. Periksa ulang di <https://www.oracle.com/cloud/free/> sebelum mulai.

---

## Daftar tugas Anda

| # | Tugas | Butuh |
|---|---|---|
| 1 | Daftar Oracle Cloud Free Tier | email, nomor HP, kartu (verifikasi) |
| 2 | Buat VM Ampere A1 | – |
| 3 | Buka port 80/443 di Security List | – |
| 4 | Pasang Docker & firewall di VM | SSH |
| 5 | Daftar DuckDNS & buat nama | akun GitHub/Google |
| 6 | Isi tiga berkas env | kunci Gemini, Server Key Midtrans Sandbox |
| 7–9 | Jalankan, buat sertifikat | – |
| 10 | Sambungkan extension & Midtrans | – |

---

## 1. Daftar akun

1. Buka <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Pilih **Home Region** yang dekat (mis. Singapore, atau Indonesia bila tersedia).
   ⚠️ Home Region **tidak bisa diganti**, dan VM Always Free hanya bisa dibuat di Home Region.
3. Selesaikan verifikasi kartu. Jangan pilih upgrade ke *Pay As You Go*.

## 2. Buat VM

Konsol Oracle → **Compute → Instances → Create instance**:

| Isian | Nilai |
|---|---|
| Name | `naravisi` |
| Image | **Canonical Ubuntu 24.04** (atau 22.04), versi **aarch64** |
| Shape | **Ampere → VM.Standard.A1.Flex**, 2 OCPU, 12 GB RAM (cukup; boleh sampai 4 OCPU / 24 GB) |
| Networking | buat VCN baru dengan subnet publik, **Assign a public IPv4 address: Yes** |
| SSH keys | *Generate a key pair* → **unduh kunci privat** (simpan baik-baik, jangan di-commit) |
| Boot volume | bawaan (± 47 GB) |

⚠️ Pastikan ada label **"Always Free-eligible"** di Shape dan Image. Total Always Free A1 = **4 OCPU & 24 GB RAM** untuk
semua VM A1 Anda, dan total block volume **200 GB**. Jangan membuat VM kedua yang melewati jumlah itu.

Pesan *"Out of capacity"* sering muncul untuk A1. Coba lagi beberapa jam kemudian atau pilih Availability Domain lain.

Catat **Public IP address** VM.

## 3. Buka port 80 & 443 (firewall lapis pertama)

Instance → subnet → **Security Lists → Default Security List → Add Ingress Rules**:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Port 22 (SSH) sudah ada secara bawaan. **Jangan** menambah port lain (3000, 8000, 3306).

## 4. Masuk ke VM, pasang Docker & firewall

Dari PowerShell di laptop (ganti jalur kunci dan IP):

```
ssh -i C:\jalur\ke\kunci-privat.key ubuntu@<IP-PUBLIK>
```

Di VM:

```bash
sudo apt-get update && sudo apt-get upgrade -y
curl -fsSL https://get.docker.com | sudo sh        # skrip resmi Docker: Docker Engine + plugin compose
sudo usermod -aG docker ubuntu && exit             # keluar lalu SSH lagi agar grup docker berlaku
```

SSH lagi, lalu ambil kode dan pasang firewall lapis kedua:

```bash
git clone https://github.com/<akun-anda>/<repo-naravisi>.git naravisi
cd naravisi
sudo bash deploy/oracle/firewall.sh                # hanya 22, 80, 443 yang diterima; disimpan permanen
docker compose version                             # harus menampilkan versi v2.x
```

(Repo privat? Pakai *Personal Access Token* GitHub sebagai kata sandi saat `git clone`.)

## 5. DuckDNS

1. Buka <https://www.duckdns.org>, masuk dengan GitHub/Google.
2. Isi nama (mis. `naravisi-saya`) → **add domain**.
3. Isi kolom **current ip** dengan Public IP VM → **update ip**.
4. Catat **token** di bagian atas halaman. ⚠️ Token ini rahasia, jangan dibagikan atau di-commit.

Periksa dari laptop: `nslookup naravisi-saya.duckdns.org` harus menjawab IP VM.

## 6. Isi berkas env (di VM)

```bash
cd ~/naravisi/deploy
cp .env.example .env
cp backend.prod.env.example backend.prod.env
cp ai.prod.env.example ai.prod.env
nano .env               # Ctrl+O simpan, Ctrl+X keluar
nano backend.prod.env
nano ai.prod.env
chmod 600 .env backend.prod.env ai.prod.env
```

| Berkas | Isi |
|---|---|
| `deploy/.env` | `DOMAIN=naravisi-saya.duckdns.org`, `LETSENCRYPT_EMAIL`, `DUCKDNS_SUBDOMAIN=naravisi-saya`, `DUCKDNS_TOKEN`, `MYSQL_ROOT_PASSWORD` & `MYSQL_PASSWORD` (`openssl rand -hex 24`) |
| `deploy/backend.prod.env` | `JWT_SECRET` (`openssl rand -hex 32`), `ALLOWED_ORIGINS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (kuat), `MIDTRANS_SERVER_KEY` (Sandbox) |
| `deploy/ai.prod.env` | `GEMINI_API_KEY`, `GEMINI_MODEL` (biarkan `CAPTION_PROVIDER=gemini`, `FALLBACK_PROVIDER=blip`) |

Ketiga berkas diabaikan git (`*.env`). Jangan menyalinnya ke tempat lain.

## 7. Bangun & jalankan

```bash
cd ~/naravisi
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml ps
```

Build pertama ±10–20 menit (torch untuk ARM64). Saat start pertama, ai-service mengunduh BLIP + MarianMT (± 1,3 GB)
ke volume `ai-models` di latar belakang. Gemini sudah bisa dipakai sebelum unduhan selesai.

Bila backend atau ai-service berhenti, lihat alasannya (mode production menyebut variabel yang kurang):

```bash
docker compose -f deploy/docker-compose.prod.yml logs backend ai-service --tail 50
```

## 8. Periksa HTTP

`http://naravisi-saya.duckdns.org/healthz` harus menjawab `ok`. Halaman lain menjawab "sertifikat HTTPS belum dibuat".
Itu normal sampai langkah 9 selesai.

## 9. Buat sertifikat HTTPS (sekali saja)

```bash
cd ~/naravisi
set -a; . deploy/.env; set +a
docker compose -f deploy/docker-compose.prod.yml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email
docker compose -f deploy/docker-compose.prod.yml restart nginx
```

Buka `https://naravisi-saya.duckdns.org/api/v1/health`. Jawabannya harus `{"status":"ok", ...}`.
Perpanjangan berjalan otomatis (layanan `certbot` tiap 12 jam, nginx memuat ulang tiap 12 jam).

## 10. Sambungkan extension & Midtrans

- Extension: **Pengaturan → Koneksi server** → `https://naravisi-saya.duckdns.org/api/v1` → **Simpan alamat**.
  Alamat ini **tetap**, tidak berganti seperti Quick Tunnel.
- Midtrans Sandbox: Settings → Payment → **Notification URL** →
  `https://naravisi-saya.duckdns.org/api/v1/payments/notification`.
- Dashboard Admin: `https://naravisi-saya.duckdns.org/admin/`.

## 11. Cadangan MySQL

Layanan `backup` membuat `deploy/backups/naravisi-YYYYMMDD-HHMM.sql.gz` **setiap 24 jam** (yang pertama saat start)
dan menghapus cadangan yang lebih tua dari 7 hari.

Salin ke laptop (dari PowerShell):

```
scp -i C:\jalur\ke\kunci-privat.key ubuntu@<IP-PUBLIK>:naravisi/deploy/backups/*.sql.gz .
```

Memulihkan (⚠️ menimpa data sekarang):

```bash
cd ~/naravisi
set -a; . deploy/.env; set +a
gunzip -c deploy/backups/naravisi-20261111-0200.sql.gz | \
  docker compose -f deploy/docker-compose.prod.yml exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql mysql -uroot
```

## 12. Memperbarui ke versi baru

```bash
cd ~/naravisi && git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Data MySQL, model AI, dan sertifikat ada di volume Docker, jadi tidak hilang saat rebuild.

## 13. Yang dijaga otomatis

| Hal | Cara |
|---|---|
| Restart otomatis | semua layanan `restart: unless-stopped`; Docker menyala saat VM reboot |
| Healthcheck | mysql (`mysqladmin ping`), backend & ai-service (`/health` di Dockerfile), nginx (`/healthz`) |
| Urutan start | backend menunggu mysql & ai-service *healthy*; nginx menunggu backend *healthy* |
| IP DuckDNS | layanan `duckdns` memperbarui tiap 5 menit |
| Sertifikat | layanan `certbot` |
| Cadangan | layanan `backup`, harian, simpan 7 hari |

## ⚠️ Peringatan agar tetap gratis

- **Jangan upgrade ke Pay As You Go** kecuali Anda paham biayanya. Akun Free Tier tidak bisa ditagih.
- Hanya pakai sumber daya berlabel **Always Free-eligible**. Total A1: 4 OCPU & 24 GB RAM. Total block volume: 200 GB.
- **Jangan** menambah Load Balancer berbayar, Block Volume ekstra di atas 200 GB, atau shape selain A1/Micro.
- Kebijakan Oracle: VM Always Free yang **menganggur** (CPU, jaringan, dan memori sangat rendah selama 7 hari) dapat
  diambil kembali. NaraVisi yang dipakai rutin biasanya aman. Bila jarang dipakai, cek email dari Oracle.
- Batas Gemini tingkat gratis per menit/hari tetap berlaku. Saat habis, BLIP mengambil alih (diumumkan sopan).
- Gemini tingkat gratis dapat memakai data untuk meningkatkan produk Google (lihat README bagian Privasi).

## Bila ada masalah

| Gejala | Periksa |
|---|---|
| `healthz` tidak terjangkau | Security List 80/443 (langkah 3), `sudo bash deploy/oracle/firewall.sh`, `docker compose ps` |
| certbot gagal | DuckDNS menunjuk ke IP VM (`nslookup`), port 80 terbuka, `DOMAIN` di `deploy/.env` benar |
| backend `Exited (1)` | `docker compose logs backend`: daftar variabel yang belum lengkap |
| ai-service lama *unhealthy* | unduhan model pertama; `docker compose logs ai-service` |
