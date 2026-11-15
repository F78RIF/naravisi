// NaraVisi · examples/buat_gambar_lapis_lokal.mjs
// Fungsi   : Menggambar 10 gambar uji lapis lokal (PF-06 tulisan, PF-07 kode QR, PF-08 warna, PF-05 benda) dengan kode,
//            tanpa mengunduh apa pun, ke examples/gambar/lapis-lokal/. Dipakai examples/halaman-uji-lapis-lokal.html dan
//            scripts/ukur-lapis-lokal.mjs. Semua gambar buatan sendiri, berlisensi MIT seperti proyek ini.
// Kebutuhan: PF-05, PF-06, PF-07, PF-08
// Pemakaian: cd e2e && npm install && cd .. && node examples/buat_gambar_lapis_lokal.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(DIR, '../e2e/package.json'));
const sharp = require('sharp');
const QRCode = require('qrcode');
const OUT = path.join(DIR, 'gambar/lapis-lokal');
mkdirSync(OUT, { recursive: true });

const svg = (w, h, isi) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${isi}</svg>`);
const teks = (x, y, t, { size = 44, fill = '#111111', weight = 'bold', anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${t}</text>`;
const png = (buf) => sharp(buf).png();

async function qr(isi, sisi = 360) {
  return QRCode.toBuffer(isi, { width: sisi, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}

/** Segi delapan beraturan berpusat (cx, cy) dengan jari-jari r. */
function segiDelapan(cx, cy, r) {
  return Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

const GAMBAR = {
  // [PF-06] Teks di gambar (OCR) — poster bertulisan tiga baris (latar kuning, tulisan hitam)
  'poster-diskon.png': () => png(svg(900, 520,
    `<rect width="900" height="520" fill="#f7d33c"/><rect x="30" y="30" width="840" height="460" fill="none" stroke="#111" stroke-width="6"/>${
      teks(450, 170, 'DISKON AKHIR TAHUN', { size: 70, anchor: 'middle' })}${
      teks(450, 290, 'Semua buku 30 persen', { size: 50, weight: 'normal', anchor: 'middle' })}${
      teks(450, 390, 'Sampai 31 Desember', { size: 50, weight: 'normal', anchor: 'middle' })}`)),
  // [PF-06] Teks di gambar (OCR) — poster acara, tulisan putih di latar biru tua
  'poster-acara.png': () => png(svg(900, 480,
    `<rect width="900" height="480" fill="#1d3a8a"/>${
      teks(60, 150, 'Lomba Baca Puisi', { size: 64, fill: '#ffffff' })}${
      teks(60, 260, 'Sabtu, 6 Desember 2026', { size: 46, weight: 'normal', fill: '#ffffff' })}${
      teks(60, 350, 'Aula Perpustakaan Kota', { size: 46, weight: 'normal', fill: '#ffffff' })}`)),
  // [PF-07] Kode QR & barcode — QR berisi tautan https://example.com
  'qr-example-com.png': async () => sharp(await qr('https://example.com')).png(),
  // [PF-07] Kode QR & barcode — QR berbahaya "javascript:alert(1)" (tidak boleh dibaca sebagai tautan)
  'qr-javascript.png': async () => sharp(await qr('javascript:alert(1)')).png(),
  // [PF-07] Kode QR & barcode — QR berisi teks biasa
  'qr-teks.png': async () => sharp(await qr('Ruang baca lantai 2')).png(),
  // [PF-08] Warna dominan — dua warna: 60% biru, 40% putih
  'dua-warna.png': () => png(svg(600, 400, '<rect width="600" height="400" fill="#ffffff"/><rect width="360" height="400" fill="#2050e0"/>')),
  // [PF-08] Warna dominan — dua warna: merah dan hijau berselang-seling
  'merah-hijau.png': () => png(svg(600, 400, Array.from({ length: 6 }, (_, i) =>
    `<rect x="${i * 100}" y="0" width="100" height="400" fill="${i % 2 ? '#2e9e48' : '#d8302c'}"/>`).join(''))),
  // [PF-05] Deteksi objek lokal — "foto benda": rambu STOP di tiang, latar langit
  'rambu-stop.png': () => png(svg(640, 640,
    `<defs><linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#78aae1"/><stop offset="1" stop-color="#c8dcf5"/></linearGradient></defs>
     <rect width="640" height="640" fill="url(#l)"/><rect x="0" y="560" width="640" height="80" fill="#6d8f4e"/>
     <rect x="308" y="300" width="24" height="300" fill="#8a8a8a"/>
     <polygon points="${segiDelapan(320, 230, 160)}" fill="#ffffff"/><polygon points="${segiDelapan(320, 230, 148)}" fill="#c8102e"/>${
      teks(320, 262, 'STOP', { size: 96, fill: '#ffffff', anchor: 'middle' })}`)),
  // [PF-05] Deteksi objek lokal — bidang polos (dilewati Mode Baca Berurutan)
  'polos-krem.png': () => sharp({ create: { width: 600, height: 400, channels: 3, background: '#efe2c2' } }).png(),
  // [PF-06] Teks di gambar (OCR) — "tangkapan layar" aplikasi berisi beberapa baris teks
  'tangkapan-layar.png': () => png(svg(900, 560,
    `<rect width="900" height="560" fill="#f4f5f7"/><rect width="900" height="90" fill="#24303f"/>${
      teks(40, 60, 'Pengaturan Akun', { size: 40, fill: '#ffffff' })}${
      teks(40, 180, 'Nama pengguna: Rina Lestari', { size: 36, weight: 'normal' })}${
      teks(40, 260, 'Bahasa: Indonesia', { size: 36, weight: 'normal' })}${
      teks(40, 340, 'Notifikasi email aktif', { size: 36, weight: 'normal' })}
     <rect x="40" y="400" width="260" height="80" rx="10" fill="#1f6feb"/>${teks(170, 452, 'Simpan', { size: 36, fill: '#ffffff', anchor: 'middle' })}`)),
};

for (const [nama, buat] of Object.entries(GAMBAR)) {
  writeFileSync(path.join(OUT, nama), await (await buat()).toBuffer());
  console.log(`examples/gambar/lapis-lokal/${nama}`);
}
