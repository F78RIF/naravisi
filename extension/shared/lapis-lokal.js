// NaraVisi · extension/shared/lapis-lokal.js
// Fungsi   : Logika murni penggabung lapis lokal: benda (PF-05) + warna dominan (PF-08) + tulisan (PF-06) + kode QR
//            (PF-07). Menentukan urutan bacaan, kalimat cadangan "Deskripsi sederhana (tanpa AI)", tambahan setelah
//            deskripsi AI (tanpa mengulang teks yang sudah dibaca AI), dan penyaring Mode Baca Berurutan.
//            Tanpa API browser, jadi bisa diuji langsung dengan Node.
// Kebutuhan: PF-05, PF-06, PF-07, PF-08, PF-09
// Terkait  : background.js (requestDescription, sendQuick), content/content.js (antrean suara), shared/deteksi.js

import { kalimatObjek } from './deteksi.js';
import { kalimatWarna } from './warna.js';
import { kalimatOrientasi } from './orientasi.js';

/** Urutan bagian yang dibacakan. */
export const URUTAN_BAGIAN = ['benda', 'tulisan', 'kode'];

const warnaAktif = (benda, opsi) => (opsi?.sebutWarna === false ? [] : benda?.warna ?? []);
// [PF-09] Orientasi — bawaan nonaktif (agar ringkas); hanya disebut bila opsi.sebutOrientasi === true
const orientasiAktif = (benda, opsi) => (opsi?.sebutOrientasi === true ? kalimatOrientasi(benda?.orientasi) : null);

// [PF-08] Warna dominan — kalimat bagian "benda": "Kemungkinan berisi: 2 orang. Warna dominan: biru." (sakelar warna)
export function kalimatBenda(benda, opsi = {}) {
  const isi = benda?.kalimat || kalimatObjek(benda?.objek);
  const bagian = [isi ? `Kemungkinan berisi: ${isi}.` : null, kalimatWarna(warnaAktif(benda, opsi)), orientasiAktif(benda, opsi)];
  return bagian.filter(Boolean).join(' ') || null;
}

// [PF-07] Kode QR & barcode — bagian-bagian lapis lokal, berurutan: benda → tulisan → kode
/**
 * @param {{benda?: object|null, tulisan?: {kalimat?: string}|null, kode?: {kalimat?: string}|null}} lokal
 * @returns {Array<{bagian: 'benda'|'tulisan'|'kode', text: string}>}
 */
export function bagianLokal(lokal, opsi = {}) {
  const out = [];
  const benda = kalimatBenda(lokal?.benda, opsi);
  if (benda) out.push({ bagian: 'benda', text: benda });
  if (opsi.bacaTulisan !== false && lokal?.tulisan?.kalimat) out.push({ bagian: 'tulisan', text: lokal.tulisan.kalimat });
  if (opsi.bacaQr !== false && lokal?.kode?.kalimat) out.push({ bagian: 'kode', text: lokal.kode.kalimat });
  return out;
}

// [PF-06] Teks di gambar (OCR) — tambahan setelah deskripsi AI: tulisan TIDAK dibacakan bila AI sudah memuat
// teks_dalam_gambar; info QR tetap dibacakan. Bagian yang sudah terdengar saat menunggu AI tidak diulang.
/** @param {{bagian: string, text: string}} item  @param {{adaTeksAi: boolean, sudah: Set<string>}} keadaan */
export function perluSetelahAi(item, { adaTeksAi = false, sudah = new Set() } = {}) {
  if (!item?.text || sudah.has(item.bagian)) return false;
  if (item.bagian === 'kode') return true;
  if (item.bagian === 'tulisan') return !adaTeksAi;
  return false; // "benda" hanya untuk menunggu AI; deskripsi AI sudah lebih lengkap
}

// [PF-05] Deteksi objek lokal — cadangan saat AI gagal/kuota habis/offline: gabungan semua lapis lokal
/** Semua lapis gagal (tidak ada hasil sama sekali) → null, sehingga pesan galat biasa yang dipakai. */
export function kalimatSederhanaLengkap(lokal, opsi = {}) {
  const { benda, tulisan, kode } = lokal ?? {};
  if (!benda && !tulisan && !kode) return null;
  const isi = [];
  const objek = benda?.kalimat || kalimatObjek(benda?.objek);
  if (objek) isi.push(`kemungkinan berisi ${objek}.`);
  else if (benda?.polos) isi.push('gambar hampir polos, tidak ada benda yang dikenali.');
  else if (benda) isi.push('tidak ada benda yang dikenali.');
  const warna = kalimatWarna(warnaAktif(benda, opsi));
  if (warna) isi.push(warna);
  const o = orientasiAktif(benda, opsi);
  if (o) isi.push(o);
  if (opsi.bacaTulisan !== false && tulisan?.kalimat) isi.push(tulisan.kalimat);
  if (opsi.bacaQr !== false && kode?.kalimat) isi.push(kode.kalimat);
  if (!isi.length) return null;
  return `Deskripsi sederhana (tanpa AI): ${isi.join(' ')}`;
}

// [PF-02] Baca berurutan — dilewati hanya bila tanpa benda, hampir polos, DAN tanpa tulisan maupun kode QR
export function layakDilewatiLengkap({ benda, tulisan, kode } = {}) {
  const tanpaBenda = Boolean(benda && Array.isArray(benda.objek) && benda.objek.length === 0 && benda.polos === true);
  return tanpaBenda && !tulisan?.teks && !(kode?.kode?.length > 0);
}
