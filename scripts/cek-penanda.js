// NaraVisi · scripts/cek-penanda.js
// Fungsi   : Memeriksa bahwa setiap kebutuhan punya penanda di kode dan tes otomatis.
// Kebutuhan: RF-01..RF-30, PF-01..PF-05 (lihat docs/PETA_KODE.md)
// Terkait  : backend/package.json (npm run cek:penanda), docs/PETA_KODE.md
// Pemakaian: cd backend && npm run cek:penanda      (atau: node scripts/cek-penanda.js dari akar repo)
// Keluar dengan kode 1 bila ada RF tanpa penanda/tes atau penanda yang formatnya salah.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Nama resmi kebutuhan (sama dengan teks di setiap penanda) dan use case SRS-nya.
const KEBUTUHAN = {
  'RF-01': ['Registrasi akun', 'UC-AKUN-01'],
  'RF-02': ['Lihat profil', 'UC-AKUN-02'],
  'RF-03': ['Ubah profil', 'UC-AKUN-03'],
  'RF-04': ['Hapus akun', 'UC-AKUN-04'],
  'RF-05': ['Login', 'UC-AKUN-05'],
  'RF-06': ['Memindai gambar', 'UC-GBR-01'],
  'RF-07': ['Menampilkan gambar terdeteksi', 'UC-GBR-02'],
  'RF-08': ['Memilih gambar', 'UC-GBR-03'],
  'RF-09': ['Mengirim gambar ke AI', 'UC-GBR-04'],
  'RF-10': ['Menerima & menyimpan deskripsi', 'UC-GBR-05'],
  'RF-11': ['Menampilkan deskripsi teks', 'UC-GBR-06'],
  'RF-12': ['Membacakan deskripsi', 'UC-GBR-07'],
  'RF-13': ['Menyimpan riwayat', 'UC-RWY-01'],
  'RF-14': ['Daftar riwayat', 'UC-RWY-02'],
  'RF-15': ['Detail riwayat', 'UC-RWY-03'],
  'RF-16': ['Hapus riwayat', 'UC-RWY-04'],
  'RF-17': ['Halaman pengaturan', 'UC-AKS-01'],
  'RF-18': ['Ubah bahasa & pintasan', 'UC-AKS-02'],
  'RF-19': ['Ubah kecepatan, nada & suara', 'UC-AKS-03'],
  'RF-20': ['Melaporkan deskripsi', 'UC-LAP-01'],
  'RF-21': ['Admin: daftar laporan', 'UC-LAP-02'],
  'RF-22': ['Admin: ubah status laporan', 'UC-LAP-03'],
  'RF-23': ['Daftar paket Premium', 'UC-PRM-01'],
  'RF-24': ['Memilih paket', 'UC-PRM-02'],
  'RF-25': ['Pembayaran & aktivasi Premium', 'UC-PRM-03'],
  'RF-26': ['Status & masa aktif langganan', 'UC-PRM-04'],
  'RF-27': ['Admin: tambah pengguna', 'UC-ADM-01'],
  'RF-28': ['Admin: daftar pengguna', 'UC-ADM-02'],
  'RF-29': ['Admin: ubah pengguna', 'UC-ADM-03'],
  'RF-30': ['Admin: hapus pengguna', 'UC-ADM-04'],
  'PF-01': ['Pemandu suara', null],
  'PF-02': ['Baca berurutan', null],
  'PF-03': ['Deskripsi ke alt gambar', null],
  'PF-04': ['Cadangan AI Gemini → BLIP', null],
  'PF-05': ['Deteksi objek lokal', null],
  'RNF-02': ['Pembaca layar', null],
  'RNF-03': ['Navigasi keyboard', null],
  'RNF-06': ['Pesan error jelas', null],
  'RNF-07': ['HTTPS/TLS', null],
  'RNF-08': ['Sandi ter-hash', null],
  'RNF-09': ['Autentikasi token', null],
  'RNF-10': ['Hak akses per peran', null],
  'RNF-12': ['Info saat AI/server mati', null],
  'RNF-13': ['File gambar tidak disimpan', null],
};

const KODE_DIRS = ['extension', 'backend/src', 'backend/public', 'ai-service/app'];
// e2e/demo.mjs (rekam video) dan e2e/build-icons.mjs bukan tes, jadi tidak dihitung.
const TES_DIRS = ['backend/test', 'ai-service/tests', 'e2e'];
const BUKAN_TES = new Set(['e2e/demo.mjs', 'e2e/build-icons.mjs']);
const LEWATI = new Set(['node_modules', '__pycache__', '.venv', 'screenshots', 'demo', 'fonts', 'icons']);
const EKSTENSI = /\.(js|mjs|py|html)$/;

function daftarFile(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (LEWATI.has(entry.name)) continue;
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...daftarFile(rel));
    else if (EKSTENSI.test(entry.name)) out.push(rel);
  }
  return out;
}

// Penanda: komentar satu baris "// [RF-09] Nama — penjelasan", "# [RF-09] ...", "<!-- [RF-09] ... -->".
const PENANDA = /^\s*(?:\/\/|#|<!--)\s*\[((?:RF|PF|RNF)-\d{2})\]\s*(.*?)\s*(?:-->)?\s*$/;

function kumpulkanPenanda(files) {
  const lokasi = new Map(); // kode → ['file:baris', ...]
  const salah = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = PENANDA.exec(line);
      if (!m) return;
      const [, kode, isi] = m;
      const where = `${file}:${i + 1}`;
      const nama = KEBUTUHAN[kode]?.[0];
      if (!nama) salah.push(`${where}  kode ${kode} tidak dikenal`);
      else if (!isi.startsWith(`${nama} — `) || isi.length <= nama.length + 3)
        salah.push(`${where}  format harus "[${kode}] ${nama} — <penjelasan>"`);
      if (!lokasi.has(kode)) lokasi.set(kode, []);
      lokasi.get(kode).push(where);
    });
  }
  return { lokasi, salah };
}

// Tes dihitung bila file tes menyebut kode kebutuhan, kode use case-nya (persis, bukan rentang "01..07"),
// atau memuat penanda [RF-xx] di atas skenario yang mengujinya.
function kumpulkanTes(files) {
  const isi = files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  const hasil = new Map();
  for (const [kode, [, uc]] of Object.entries(KEBUTUHAN)) {
    const pola = [kode, uc].filter(Boolean).map((k) => new RegExp(`(?<![\\w-])${k}(?![\\d])(?!\\.\\.)`));
    const kena = isi.filter(([, s]) => pola.some((p) => p.test(s))).map(([f]) => path.posix.basename(f));
    hasil.set(kode, kena);
  }
  return hasil;
}

const kodeFiles = KODE_DIRS.flatMap(daftarFile);
const tesFiles = TES_DIRS.flatMap(daftarFile).filter((f) => !BUKAN_TES.has(f));
const { lokasi, salah } = kumpulkanPenanda(kodeFiles);
const { salah: salahTes } = kumpulkanPenanda(tesFiles);
const tes = kumpulkanTes(tesFiles);

const pad = (s, n) => String(s).padEnd(n);
console.log(`Memindai ${kodeFiles.length} file kode dan ${tesFiles.length} file tes.\n`);
console.log(`${pad('Kode', 7)}${pad('Penanda', 9)}${pad('Tes', 7)}Nama · file tes`);

const kurang = [];
for (const [kode, [nama]] of Object.entries(KEBUTUHAN)) {
  if (kode.startsWith('RNF')) continue;
  const n = lokasi.get(kode)?.length ?? 0;
  const t = tes.get(kode);
  const wajib = kode.startsWith('RF');
  if (wajib && !n) kurang.push(`${kode} (${nama}) belum punya penanda di kode`);
  if (wajib && !t.length) kurang.push(`${kode} (${nama}) belum punya tes otomatis`);
  const tanda = (ok) => (ok ? 'ya' : wajib ? 'TIDAK' : '-');
  console.log(`${pad(kode, 7)}${pad(n ? `${n}x` : tanda(false), 9)}${pad(tanda(t.length > 0), 7)}${nama} · ${t.join(', ') || '-'}`);
}

const rnf = [...lokasi.keys()].filter((k) => k.startsWith('RNF')).sort();
console.log(`\nRNF yang diberi penanda: ${rnf.map((k) => `${k} (${lokasi.get(k).length}x)`).join(', ')}`);

const masalah = [...kurang, ...salah, ...salahTes];
if (masalah.length) {
  console.log(`\nMASALAH (${masalah.length}):`);
  for (const m of masalah) console.log(`  - ${m}`);
  process.exit(1);
}
const totalRf = Object.keys(KEBUTUHAN).filter((k) => k.startsWith('RF')).length;
console.log(`\nOK: ${totalRf}/${totalRf} RF punya penanda di kode dan tes otomatis; semua penanda berformat benar.`);
