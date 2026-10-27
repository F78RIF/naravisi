# Logika & Alur Sistem NaraVisi

Dokumen ini menjelaskan cara kerja NaraVisi dengan bahasa sederhana, satu bagian per tahap pengerjaan.
Setiap bagian punya diagram alur (Mermaid) yang bisa langsung ditampilkan di GitHub atau di slide presentasi.

---

## Tahap 1 — AI: Gemini sebagai provider utama, BLIP sebagai cadangan

### Ide besarnya

Sebelumnya, gambar dideskripsikan oleh **BLIP**, model kecil yang berjalan di laptop. BLIP hanya bisa menulis
satu kalimat pendek berbahasa Inggris, lalu kalimat itu diterjemahkan ke bahasa Indonesia, dan butuh ±7 detik.

Sekarang yang bekerja lebih dulu adalah **Google Gemini**. Gemini langsung menulis bahasa Indonesia, bisa membaca
tulisan di dalam gambar, dan mengenali jenis gambar (foto, grafik, infografis, dll.). BLIP **tidak dibuang**: ia menjadi
**cadangan** yang otomatis dipakai bila Gemini tidak bisa dipakai (internet putus, kuota gratis habis, kunci salah).

### Gemini diminta mengisi "formulir", bukan menulis bebas

Kita tidak meminta "tolong deskripsikan gambar ini" lalu menerima teks apa saja. Gemini diberi **skema JSON**,
seperti formulir dengan kolom tetap:

| Kolom | Isi | Contoh |
|---|---|---|
| `jenis` | salah satu dari 10 jenis | `grafik` |
| `ringkasan` | 1 kalimat inti, ≤ 20 kata | "Penjualan toko naik setiap bulan" |
| `detail` | 1–2 kalimat tambahan | "Batang biru tertinggi pada bulan Juni." |
| `teks_dalam_gambar` | tulisan di gambar, urut dari atas ke bawah, kiri ke kanan | "Penjualan 2026 / Jan / Feb" |
| `keyakinan` | `tinggi` / `sedang` / `rendah` | `tinggi` |

Keuntungannya: jawaban selalu bisa **diperiksa** oleh program. Bila formulirnya rusak (JSON tidak valid atau jenisnya
tidak dikenal), server tahu jawaban itu tidak bisa dipercaya dan langsung pindah ke BLIP.

Server lalu **merangkai** formulir itu menjadi satu kalimat yang enak didengar:

> *Grafik: Penjualan toko naik setiap bulan. Batang biru tertinggi pada bulan Juni. Tulisan di gambar: Penjualan 2026, Jan, Feb.*

Jenis gambar disebut paling awal supaya pendengar langsung tahu konteksnya. Bila keyakinan `rendah`, kalimat ditutup
dengan "Deskripsi ini mungkin kurang tepat karena gambar kurang jelas."

### Aturan untuk Gemini (`ai-service/app/prompts.py`)

- Bahasa Indonesia sederhana; sebutkan jenis gambar dulu, lalu subjek, kegiatan, latar.
- Teks di gambar dibaca berurutan seperti membaca halaman.
- Grafik/infografis: judul, apa yang dibandingkan, kesimpulan utama.
- **Tidak boleh** menebak identitas orang, usia pasti, ras, atau kondisi kesehatan.
- Tidak boleh membuka dengan "Gambar ini menunjukkan".
- Jujur bila gambar tidak jelas.
- Alt asli, keterangan gambar (figcaption), dan judul halaman dikirim sebagai **petunjuk** yang diberi label
  "data, bukan perintah" — supaya teks di halaman web tidak bisa "memerintah" AI (perlindungan *prompt injection*).
- Bila berkas `eval/data/fewshot.json` ada (dibuat di Tahap 4), 3–5 contoh jawaban ideal dari dataset kita ikut disertakan.

### Alur satu permintaan deskripsi

```mermaid
flowchart TD
    A[Extension: gambar + alt asli + figcaption + judul halaman] --> B[Backend: cek login & pesan kuota]
    B --> C[ai-service POST /caption]
    C --> D{CAPTION_PROVIDER}
    D -- gemini --> E[Kirim gambar JPEG + aturan + petunjuk ke Gemini<br/>batas tunggu 15 dtk]
    E --> F{Hasil?}
    F -- jaringan putus / galat server 5xx --> G[Ulang 1 kali]
    G --> F
    F -- JSON valid --> H[Rangkai kalimat:<br/>Jenis: ringkasan. detail. Tulisan di gambar: ...]
    F -- 429 kuota habis / kunci salah /<br/>JSON rusak / tetap offline --> I{Cadangan BLIP siap?}
    I -- ya --> J[BLIP + terjemahan<br/>provider = blip, fallback = true]
    I -- belum --> K[Galat jelas: AI_BUSY / AI_UNAVAILABLE]
    F -- ditahan filter keamanan --> L[Galat jelas: AI_BLOCKED 422<br/>tidak dialihkan ke cadangan]
    D -- blip / mock --> J
    H --> M[Backend: simpan riwayat<br/>teks + jenis_gambar + provider]
    J --> M
    K --> N[Backend: kembalikan kuota]
    L --> N
    M --> O[Extension: tampilkan & bacakan<br/>panel menampilkan jenis gambar]
```

### Kenapa filter keamanan tidak dialihkan ke BLIP?

Bila Gemini menahan sebuah gambar karena filter keamanan, masalahnya ada pada **isi gambar**, bukan pada Gemini.
Mengirim gambar yang sama ke model lain berarti menghindari filter itu. Jadi pengguna mendapat pesan jelas
("Gambar ini tidak dapat dideskripsikan karena ditahan filter keamanan AI. Kuota Anda tidak terpakai.") dan kuota dikembalikan.

### Keamanan kunci API

```mermaid
flowchart LR
    A[GEMINI_API_KEY] -->|hanya di| B[ai-service/.env<br/>.gitignore]
    B --> C[config.py<br/>repr=False]
    C --> D[GeminiCaptioner]
    D -->|galat| E[redact: kunci → DISAMARKAN]
    F[Semua log Python & uvicorn] --> G[RedactSecrets<br/>menyamarkan kunci]
    H[Extension & Backend] -.->|tidak pernah melihat kunci| D
```

### Yang berubah di backend dan extension

- Tabel `riwayat_deskripsi` mendapat dua kolom baru yang **boleh kosong**: `jenis_gambar` dan `provider`.
  Basis data lama tidak perlu dibuat ulang: setiap start, `backend/src/db/migrate.js` memeriksa kolom yang belum ada
  dan menambahkannya (`ALTER TABLE … ADD COLUMN`) tanpa menyentuh data lama.
- Panel menampilkan jenis gambar di judul hasil, mis. "DESKRIPSI GAMBAR · FOTO".
- Halaman Pengaturan punya kartu **Privasi** yang menjelaskan bahwa gambar diteruskan ke Google Gemini dan
  pada tingkat gratis dapat dipakai Google untuk meningkatkan produknya.

### Bukti (tes)

- `ai-service/tests/test_gemini.py` — klien Gemini **palsu**, tanpa internet: sukses terstruktur, JSON rusak → cadangan,
  429 → cadangan + provider tercatat, kunci salah, diblokir filter, teks dalam gambar berurutan, ulang 1× untuk jaringan,
  kunci tidak bocor di log/galat, petunjuk halaman dikutip sebagai data, few-shot dimuat/diabaikan.
- `backend/test/aiClient.test.js`, `describeQuotaHistory.test.js`, `migrate.test.js` — field baru tersimpan, galat dipetakan
  ke pesan jelas (bukan 500), migrasi basis data lama aman.
- `e2e/run.mjs` — panel menampilkan jenis gambar; **alur manual Alt+Shift+K → panel → panah → Enter → dibacakan → Esc** tetap lulus.

---

## Tahap 2 — Urutan baca dari atas ke bawah + terhubung ke pembaca layar

### Ide besarnya

Pengguna tunanetra "membaca" halaman web lewat pembaca layar (NVDA, JAWS). Pembaca layar membaca halaman
**berurutan dari atas ke bawah** menurut struktur HTML-nya (DOM). Supaya tidak membingungkan, NaraVisi
harus mengikuti urutan yang sama, dan hasil deskripsinya harus bisa ditemukan **di tempat gambar itu berada**,
bukan hanya di panel NaraVisi.

### 1. Urutan daftar gambar

```mermaid
flowchart TD
    A[Pindai semua elemen di halaman<br/>querySelectorAll = urutan DOM] --> B{Gambar konten?}
    B -- sisi < 100 px, alt kosong, aria-hidden,<br/>role=presentation, tersembunyi,<br/>ikon/logo/iklan, src ganda --> X[Abaikan]
    B -- ya --> C[Simpan + posisi visual<br/>baris = atas/24 px, lalu kiri]
    C --> D{Ada CSS yang menyusun ulang?<br/>flex/grid order, arah terbalik,<br/>grid dense / nomor garis}
    D -- tidak --> E[Urutan DOM]
    D -- ya --> F[Urutan visual:<br/>baris atas → bawah, lalu kiri → kanan]
    E --> G[Gambar di main/article didahulukan,<br/>urutan di dalam kelompok tetap]
    F --> G
    G --> H["Label: Gambar 2 dari 6 · figcaption terdekat"]
```

Contoh: di sebuah grid, HTML-nya kucing → anjing → burung, tetapi CSS `order` menampilkan anjing → burung → kucing.
Karena tampilan sengaja disusun ulang, NaraVisi memakai urutan tampilan. Tanpa CSS semacam itu, urutan HTML yang dipakai
— walaupun ada gambar yang dipindah posisinya dengan `position: absolute`.

### 2. Deskripsi "disuntikkan" ke gambar asli

Setelah sebuah gambar dideskripsikan (dari panel maupun dari mode baca berurutan), deskripsinya dimasukkan ke atribut
`alt` gambar itu sendiri. Pembaca layar membaca `alt`, jadi saat pengguna menekan **G** (lompat ke gambar berikutnya) atau
panah bawah di NVDA, yang terdengar adalah deskripsi NaraVisi — di posisi gambar yang benar.

```mermaid
flowchart TD
    A[Deskripsi siap] --> B{Alt asli gambar}
    B -- tidak ada --> C["alt = deskripsi"]
    B -- pendek/generik:<br/>'image', 'IMG_2041.jpg' --> D["alt = alt asli. Deskripsi NaraVisi: deskripsi"]
    B -- bermakna:<br/>'Petugas membagikan masker' --> E[Tidak disentuh<br/>penulis halaman lebih tahu]
    C --> F["data-naravisi = 1"]
    D --> F
    F --> G[Pohon aksesibilitas Chrome berubah]
    G --> H[NVDA: tombol G / panah bawah<br/>membacakan deskripsi]
```

Tes e2e memeriksa ini langsung di **pohon aksesibilitas Chrome** (lewat Chrome DevTools Protocol) — yaitu data yang
sama yang diambil NVDA/JAWS dari Chrome.

### 3. Mode "Baca berurutan"

Mode ini otomatis mendeskripsikan gambar tanpa alt bermakna, **tanpa** pengguna harus membuka panel. Karena memakai kuota
dan mengirim gambar ke server (dan ke Google Gemini), mode ini **mati** sampai pengguna menyetujui dialog yang dibacakan.

```mermaid
flowchart TD
    A[Halaman selesai dimuat] --> B{Service worker memeriksa}
    B -- mode mati / chrome:// / halaman extension /<br/>Incognito / domain dikecualikan / belum masuk --> X[Tidak jalan]
    B -- sisa kuota ≤ 2 --> Q[Umumkan via aria-live:<br/>berhenti, kuota disisakan]
    B -- boleh --> C[Content script: tunggu halaman tenang ±2 dtk]
    C --> P{Ada kolom kata sandi?}
    P -- ya --> X
    P -- tidak --> D[Calon = gambar tanpa alt bermakna<br/>dalam urutan baca; total = min N, jumlah calon]
    D --> E[IntersectionObserver:<br/>tandai gambar yang terlihat / hampir terlihat]
    E --> F{Gambar berikutnya yang dekat layar?}
    F -- ada --> G[Deskripsikan SATU gambar<br/>tunggu sampai selesai]
    G --> H[Suntik alt + umumkan sopan:<br/>Gambar 1 dari 3 sudah dideskripsikan.]
    H --> I{Sudah N? Kuota ≤ 2?}
    I -- belum --> F
    I -- kuota ≤ 2 --> Q
    I -- sudah N --> Z[Selesai]
    F -- tidak ada --> W[Menunggu pengguna menggulir/membaca ke bawah]
    W --> E
```

- **Satu per satu**: gambar berikutnya baru dikirim setelah yang sebelumnya selesai. Tes e2e mencatat jumlah permintaan
  yang berjalan bersamaan ke AI — nilainya selalu 1.
- **Yang terlihat dulu**: gambar di layar (dan satu layar di atas/bawahnya) diproses lebih dulu. Gambar yang jauh di bawah
  baru diproses saat pengguna sampai ke sana — NVDA menggulir halaman mengikuti kursor bacanya, jadi ini juga terjadi saat
  pengguna hanya membaca dengan panah bawah.
- **Pengumuman sopan**: progres dan alasan berhenti diumumkan lewat satu *live region* tersembunyi dengan
  `aria-live="polite"`. Pembaca layar menyampaikannya setelah selesai membaca kalimat yang sedang dibaca, jadi **tidak menyela**.
  (Sebelumnya ringkasan dibacakan dengan suara `chrome.tts` yang bisa bertabrakan dengan suara NVDA.)

### 4. Pintasan

Pintasan yang berlaku selalu dibaca dari `chrome.commands.getAll()`, bukan dari teks tetap. Bila kosong (mis. bentrok
dengan extension lain), popup dan halaman Pengaturan menyatakan "Pintasan belum diatur" dan menyediakan tombol ke
`chrome://extensions/shortcuts`. Pintasan utama tetap **Alt+Shift+K** ("Pindai gambar pada halaman ini").

### Alur manual tetap sama

```mermaid
sequenceDiagram
    actor P as Pengguna (NVDA)
    participant C as Chrome
    participant SW as Service worker
    participant Pa as Panel (halaman)
    P->>C: Alt+Shift+K
    C->>SW: commands.onCommand("scan-page")
    SW->>Pa: suntik content script + NV_TOGGLE
    Pa-->>P: "6 gambar ditemukan…" (fokus di daftar)
    P->>Pa: ↓ / ↑ pilih gambar
    P->>Pa: Enter
    Pa->>SW: NV_DESCRIBE
    SW-->>Pa: deskripsi
    Pa-->>P: tampil + dibacakan + alt gambar asli diisi
    P->>Pa: Esc
    Pa-->>P: panel tertutup, fokus kembali ke tempat semula
```

### Bukti (tes e2e)

`urutan baca = urutan DOM` · `layout grid dengan order CSS → urutan visual` · `alt asli bermakna tidak ditimpa, alt generik
digabung, tanpa alt diisi; terbaca di pohon aksesibilitas` · `baca berurutan: maks. N, satu per satu, yang terlihat dulu, lanjut
saat digulir; progres via aria-live` · `halaman dengan kolom kata sandi / domain dikecualikan → tidak jalan` ·
`ALUR MANUAL: Alt+Shift+K → panel → panah → Enter → dibacakan → Esc`.

---

## Tahap 3 — Fitur menuju 70% (11 RF tambahan → 21/30)

### Prinsip yang sama untuk setiap fitur

Setiap fitur akun, riwayat, pengaturan, dan laporan mengikuti empat aturan yang sama di backend:

1. **Validasi input** di server (bukan hanya di halaman): panjang teks, format email, pilihan yang diizinkan.
2. **Query berparameter** (`?`), tidak pernah menyambung teks pengguna ke SQL.
3. **Cek kepemilikan**: setiap query memakai `WHERE user_id = <pengguna yang login>`. Data milik orang lain
   diperlakukan seolah tidak ada (`404`), jadi orang lain bahkan tidak tahu data itu ada.
4. **Pesan galat berbahasa Indonesia** yang aman dibacakan, plus nama kolom yang salah (`details.field`) supaya halaman
   bisa memindahkan fokus keyboard ke kolom itu.

```mermaid
flowchart LR
    A[Halaman extension] -->|token JWT| B[authenticate:<br/>token sah? akun masih ada?<br/>waktu registrasi cocok?]
    B -- tidak --> X[401 Silakan login]
    B -- ya --> C[Validasi input]
    C -- salah --> Y[400 + details.field<br/>fokus pindah ke kolom itu]
    C -- benar --> D[Query berparameter<br/>WHERE user_id = pengguna]
    D -- bukan miliknya --> Z[404 tidak ditemukan]
    D -- miliknya --> E[200 + data]
```

### Akun (RF-02, RF-03, RF-04)

- **Lihat profil (RF-02):** nama, email, status (Gratis/Premium/Admin), kuota hari ini, tanggal daftar.
- **Ubah profil (RF-03):** nama bebas diubah. Mengganti **email atau kata sandi wajib memasukkan kata sandi saat ini**,
  supaya orang yang sempat memakai laptop pengguna tidak bisa mengambil alih akun. Email yang sudah dipakai → pesan jelas.
- **Hapus akun permanen (RF-04):** pengguna mengetik **HAPUS** (huruf besar) dan kata sandinya. Bisa dilakukan sepenuhnya
  dengan keyboard; tidak ada dialog yang sulit dijangkau pembaca layar.

```mermaid
sequenceDiagram
    actor P as Pengguna
    participant H as Halaman Profil
    participant B as Backend
    participant DB as MySQL
    P->>H: ketik "HAPUS" + kata sandi, Enter
    H->>H: bukan "HAPUS"? → pesan + fokus ke kolom
    H->>B: DELETE /me {konfirmasi, kata_sandi}
    B->>B: cek "HAPUS" & kata sandi
    B->>DB: DELETE FROM users WHERE user_id = ?
    DB-->>DB: ON DELETE CASCADE: riwayat, laporan,<br/>pengaturan, kuota ikut terhapus;<br/>transaksi dianonimkan
    B-->>H: {dihapus: true}
    H->>H: hapus sesi di extension
    Note over B: Token lama → 401 (akunnya sudah tidak ada).<br/>Token juga membawa waktu registrasi, jadi tidak<br/>berlaku untuk akun baru yang mendapat ID sama.
```

### Riwayat (RF-14, RF-15, RF-16)

- **Daftar (RF-14):** 10 per halaman (tombol Sebelumnya/Berikutnya). Akun Gratis melihat 7 hari terakhir; yang lebih lama
  disembunyikan (bukan dihapus) dan muncul lagi setelah Premium.
- **Detail (RF-15):** `riwayat.html?id=…` menampilkan teks, **jenis gambar**, pembuat deskripsi (Google Gemini atau BLIP), waktu,
  alamat halaman & gambar. Fokus langsung di tombol **Putar ulang**, jadi cukup tekan Enter untuk mendengar lagi.
- **Hapus (RF-16):** satu per satu, atau **Hapus semua riwayat** — keduanya dengan konfirmasi. Backend hanya menghapus semua
  bila badan permintaan berisi `{"semua": true}`, untuk mencegah terhapus tanpa sengaja.

### Pengaturan (RF-17, RF-18, RF-19)

- **Bahasa (RF-18):** Indonesia atau English; dipakai untuk permintaan deskripsi berikutnya (tes e2e membuktikan AI menerima `lang=en`).
- **Pintasan (RF-18):** yang berlaku dibaca dari Chrome. Chrome hanya mengizinkan pintasan diubah di
  `chrome://extensions/shortcuts`, jadi halaman menyediakan tombol ke sana. Kombinasi yang bentrok dengan Chrome/NVDA ditolak.
- **Suara (RF-19):** kecepatan (semua pengguna — pengguna pembaca layar sangat bergantung pada kecepatan), nada & jenis suara
  (Premium), tombol **Coba suara**. Penggeser mengumumkan nilai yang mudah dipahami, mis. "1,5 kali".

### Laporan (RF-20)

```mermaid
flowchart TD
    A[Tombol L di panel / Laporkan di Riwayat] --> B[Pilih alasan:<br/>objek salah · tulisan salah dibaca ·<br/>kurang lengkap · jenis salah ·<br/>tidak pantas · lainnya]
    B --> C[Catatan opsional<br/>wajib bila Lainnya]
    C --> D[POST /reports]
    D --> E{Riwayat milik pengguna<br/>& masih terlihat?}
    E -- tidak --> F[404]
    E -- ya --> G[Simpan: kategori + alasan<br/>status baru]
    G --> H[Dashboard Admin: tinjau & tindak lanjut]
```

Pilihan alasan membuat laporan **bisa dihitung** (mis. "berapa persen laporan karena tulisan salah dibaca"), yang nanti berguna
untuk mengevaluasi model di Tahap 4.

### Premium (RF-23)

Halaman Premium menampilkan paket Bulanan Rp15.000 / 30 hari beserta manfaatnya (`GET /plans`, tanpa login). Pembayaran
sungguhan berada di luar target 70% (mode simulasi tetap tersedia untuk demo).

### Bukti (tes)

| RF | Backend (`npm test`) | E2E (`e2e/run.mjs`) |
|---|---|---|
| RF-02/03 | `UC-AKUN-02`, `UC-AKUN-03`, `RF-03: ubah email …` | `UC-AKUN-02`, `UC-AKUN-03`, `RF-03: ubah email …` |
| RF-04 | `UC-AKUN-04: … "HAPUS" … token dicabut`, `token akun terhapus …` | `RF-04: hapus akun permanen …` |
| RF-14..16 | `UC-RWY-02..04`, `RF-15`, `RF-16: hapus semua …` | `UC-RWY-02..04`, `RF-15: detail …`, `RF-16: hapus SEMUA …` |
| RF-17..19 | `UC-AKS-01..03`, `RF-17: pengaturan milik masing-masing …` | `UC-AKS-01..03`, `RF-18: bahasa English …`, `Coba suara` |
| RF-20 | `UC-LAP-01`, `RF-20: pilih alasan + catatan …` | `RF-20: kirim laporan dari panel`, `RF-20 dari halaman Riwayat` |
| RF-23 | `GET /plans` (premiumAdmin.test.js) | `UC-PRM-01: paket Bulanan Rp15.000 / 30 hari tampil` |
