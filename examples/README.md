# examples/: mencoba NaraVisi langkah demi langkah

Panduan untuk penguji/dosen. Semua gambar di folder ini dibuat sendiri dengan kode. Data di grafik adalah
**data tiruan**.

| Berkas | Isi |
|---|---|
| `halaman-uji.html` | Halaman statis berisi foto, grafik, infografis, diagram SVG inline, gambar dengan dan tanpa alt, hiasan `alt=""`, dan simbol kecil |
| `gambar/` | Gambar untuk halaman uji (SVG ditulis tangan, PNG dari `buat_gambar_contoh.py`) |
| `buat_gambar_contoh.py` | Menggambar ulang PNG contoh dengan Pillow: `python -I examples/buat_gambar_contoh.py` |
| `contoh-respons-caption.json` | Contoh respons `POST /caption` layanan AI (data tiruan berlabel CONTOH) |

## 1. Pasang (sekali saja)

Butuh Node.js 22.9+, Python 3.12, Google Chrome. MySQL boleh diganti SQLite untuk demo.

```powershell
# Layanan AI
cd ai-service
python -m venv .venv
.venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
copy .env.example .env      # isi GEMINI_API_KEY & GEMINI_MODEL, atau CAPTION_PROVIDER=blip / mock
cd ..

# Backend
cd backend
npm install
copy .env.example .env      # isi JWT_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD; tanpa MySQL: DB_DRIVER=sqlite
npm run db:setup
cd ..
```

Tanpa internet dan tanpa kunci Gemini, pakai `CAPTION_PROVIDER=mock` di `ai-service/.env`. Deskripsinya berupa teks
tetap, tetapi seluruh alur (daftar gambar, urutan, suara, alt) tetap bisa dicoba.

## 2. Jalankan

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-demo.ps1 -Contoh
```

Skrip membuka layanan AI (port 8000), backend (port 3000), dan server halaman contoh (port 8080) di jendela
masing-masing, lalu menunggu sampai `/health` menjawab. Cara manual ada di README utama, bagian
"Menjalankan di laptop". Halaman contoh juga bisa disajikan sendiri:

```powershell
ai-service\.venv\Scripts\python -m http.server 8080 --bind 127.0.0.1 --directory examples
```

Halaman dibuka lewat `http://`, bukan `file://`, karena Chrome tidak mengizinkan extension membaca `file://`
kecuali opsi "Allow access to file URLs" dinyalakan.

## 3. Pasang extension

1. Buka `chrome://extensions`, aktifkan **Developer mode**.
2. **Load unpacked**, pilih folder `extension/`.
3. Salin ID extension ke `backend/.env` (`ALLOWED_ORIGINS=chrome-extension://<ID>`), lalu restart jendela backend.
4. Tab **Selamat datang** terbuka. Tekan **Tab** untuk daftar atau masuk.

## 4. Coba di halaman uji

Buka `http://127.0.0.1:8080/halaman-uji.html`, lalu tekan **Alt+Shift+K**.

Panel harus menampilkan **6 gambar** dengan urutan atas → bawah:

| No. | Gambar | Yang diperiksa |
|---|---|---|
| 1 | Foto pantai (PNG, tanpa alt, ada `figcaption`) | Label panel memakai keterangan foto |
| 2 | Grafik batang (SVG, `alt="gambar"`) | Alt generik: setelah dideskripsikan menjadi `gambar. Deskripsi NaraVisi: …` |
| 3 | Infografis (SVG, alt bermakna) | Alt asli **tidak ditimpa** |
| 4 | Diagram alur (SVG inline, `aria-label` bermakna) | SVG inline dikirim sebagai JPEG; `aria-label` asli tidak ditimpa |
| 5 | Grafik garis (PNG, `alt="IMG_0412.png"`) | Alt nama file dianggap generik, jadi digabung dengan deskripsi |
| 6 | Sampul buletin (di `<aside>`, tanpa alt) | Di luar `<main>`, jadi paling akhir walau di layar lebar tampil di kanan atas |

Yang **tidak** boleh muncul: hiasan bergelombang (`alt=""`, dekoratif) dan simbol "i" 32×32 (sisi < 100 px).

Kontrol panel: **↑/↓** pilih · **Enter** deskripsikan (dibacakan) · **Spasi** jeda/lanjut · **R** ulang ·
**S** berhenti · **L** laporkan · **Esc** tutup.

Setelah beberapa gambar dideskripsikan, tutup panel lalu periksa dengan pembaca layar (NVDA: tombol **G** = gambar
berikutnya) atau DevTools (`Elements`, atribut `alt` dan `data-naravisi="1"`).

## 5. Bentuk respons layanan AI

`contoh-respons-caption.json` memperlihatkan respons `POST http://127.0.0.1:8000/caption`: field `jenis`,
`ringkasan`, `detail`, `teks_dalam_gambar`, dan `keyakinan` dirangkai menjadi kalimat `text` yang dibacakan dan
disuntikkan ke alt. Contoh 3 menunjukkan kalimat peringatan saat `keyakinan` rendah. Contoh 4 menunjukkan cadangan
BLIP (tanpa jenis, ada `text_en`). Kontrak lengkapnya ada di `docs/API.md`.
