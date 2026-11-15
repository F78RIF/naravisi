// NaraVisi · extension/shared/qr.js
// Fungsi   : Logika murni kode QR & barcode (PF-07): menggolongkan isi kode (tautan http/https, teks, skema berbahaya)
//            dan menyusun kalimat yang aman dibacakan. Tautan TIDAK PERNAH dibuka otomatis; yang dibacakan hanya
//            nama domainnya. Tanpa API browser, jadi bisa diuji langsung dengan Node.
// Kebutuhan: PF-07
// Terkait  : offscreen/kode-qr.js (pendeteksi), shared/lapis-lokal.js, background.js (NV_OPEN_QR), content/content.js

/** Panjang teks QR maksimum yang dibacakan. */
export const MAKS_TEKS_QR = 100;
/** Paling banyak kode yang disebut per gambar. */
export const MAKS_KODE = 2;

// Skema yang isinya tetap aman dibacakan sebagai teks (tidak pernah dijadikan tautan).
const SKEMA_TEKS = new Set(['mailto', 'tel', 'sms', 'smsto', 'geo', 'wifi', 'mecard', 'begin', 'bitcoin', 'upi']);
// Karakter tak terlihat yang dipakai untuk menyamarkan skema ("java\tscript:", spasi lebar nol, dll.).
const TAK_TERLIHAT = /[\u0000-\u0020\u007F-\u00A0\u00AD\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g;

function bersihkanTeks(teks) {
  return String(teks ?? '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// [PF-07] Kode QR & barcode — menggolongkan isi kode: tautan http/https (hanya domain), teks, atau skema berbahaya
/**
 * @param {{rawValue: string, format?: string}} kode  hasil BarcodeDetector / jsQR
 * @returns {{jenis: 'tautan', domain: string, url: string, format: string}
 *   | {jenis: 'teks', teks: string, terpotong: boolean, format: string}
 *   | {jenis: 'berbahaya', format: string} | null}
 */
export function golongkanKode(kode) {
  const mentah = String(kode?.rawValue ?? '');
  const format = String(kode?.format || 'qr_code');
  const teks = bersihkanTeks(mentah);
  if (!teks) return null;
  const skema = /^([a-z][a-z0-9+.-]*):/i.exec(mentah.replace(TAK_TERLIHAT, ''))?.[1]?.toLowerCase();
  if (skema === 'http' || skema === 'https') {
    try {
      const url = new URL(mentah.trim());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) {
        // Hanya nama host asli yang disebut ("https://bank.co.id@jahat.com" → "jahat.com"), tanpa jalur & parameter.
        return { jenis: 'tautan', domain: url.hostname.replace(/^www\./i, '').replace(/\.$/, ''), url: url.href, format };
      }
    } catch {
      /* bukan URL yang sah → dianggap berbahaya di bawah */
    }
    return { jenis: 'berbahaya', format };
  }
  // javascript:, data:, file:, intent:, vbscript:, chrome:, blob:, skema tak dikenal → isinya tidak dibacakan.
  if (skema && !SKEMA_TEKS.has(skema)) return { jenis: 'berbahaya', format };
  const terpotong = teks.length > MAKS_TEKS_QR;
  return { jenis: 'teks', teks: terpotong ? `${teks.slice(0, MAKS_TEKS_QR).trimEnd()}…` : teks, terpotong, format };
}

const namaKode = (format) => (format === 'qr_code' ? 'kode QR' : 'kode batang');

// [PF-07] Kode QR & barcode — kalimat aman: "Ada kode QR menuju rri.co.id." / "Ada kode QR berisi teks."
export function kalimatKode(kode) {
  if (!kode) return null;
  const nama = namaKode(kode.format);
  if (kode.jenis === 'tautan') return `Ada ${nama} menuju ${kode.domain}.`;
  if (kode.jenis === 'teks') return `Ada ${nama} berisi teks: ${kode.teks.replace(/[.…]+$/, '')}${kode.terpotong ? '…' : '.'}`;
  return `Ada ${nama} berisi teks.`;
}

// [PF-07] Kode QR & barcode — gabungkan hasil pendeteksi: buang duplikat, maks. 2 kode, satu kalimat per kode
/** @param {Array<{rawValue: string, format?: string}>} mentah */
export function ringkasKode(mentah) {
  const lihat = new Set();
  const kode = [];
  for (const m of mentah ?? []) {
    const k = golongkanKode(m);
    if (!k) continue;
    const kunci = `${k.format}|${m.rawValue}`;
    if (lihat.has(kunci)) continue;
    lihat.add(kunci);
    kode.push(k);
    if (kode.length >= MAKS_KODE) break;
  }
  return { kode, kalimat: kode.map(kalimatKode).join(' ') };
}

// [PF-07] Kode QR & barcode — pemeriksaan ulang sebelum membuka tab (dipakai service worker, setelah konfirmasi)
/** Hanya http/https yang sah; selain itu null. */
export function tautanAman(url) {
  try {
    const u = new URL(String(url ?? ''));
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u.href : null;
  } catch {
    return null;
  }
}
