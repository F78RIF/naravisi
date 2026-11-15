// NaraVisi · extension/offscreen/kode-qr.js
// Fungsi   : Membaca kode QR & barcode secara lokal di dokumen offscreen. Memakai BarcodeDetector bawaan Chrome bila
//            ada (macOS, ChromeOS, Android); bila tidak (mis. Chrome di Windows/Linux) memakai jsQR yang disimpan di
//            extension/vendor/jsqr (hanya QR). Tidak ada gambar yang dikirim ke server; tautan TIDAK dibuka di sini.
// Kebutuhan: PF-07
// Terkait  : offscreen.js (penerima pesan NV_READ_CODES), shared/qr.js (penggolongan & kalimat), background.js

import { ringkasKode } from '../shared/qr.js';

const JSQR_URL = new URL('../vendor/jsqr/jsQR.js', import.meta.url).href;
const SISI_CEPAT = 800; // percobaan pertama pada gambar yang diperkecil (lebih cepat)
const SISI_PENUH = 1280; // percobaan kedua bila QR kecil tidak terbaca

let pembaca = null; // Promise<(bitmap) => Promise<Array<{rawValue, format}>>> — dibuat sekali

// [PF-07] Kode QR & barcode — jsQR dimuat sekali sebagai skrip klasik (mendaftarkan self.jsQR), tanpa internet
function muatJsQr() {
  if (self.jsQR) return Promise.resolve(self.jsQR);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSQR_URL;
    s.onload = () => (self.jsQR ? resolve(self.jsQR) : reject(new Error('jsQR tidak terdaftar')));
    s.onerror = () => reject(new Error('jsQR gagal dimuat'));
    document.head.append(s);
  });
}

function piksel(bitmap, sisi) {
  const skala = Math.min(1, sisi / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * skala));
  const h = Math.max(1, Math.round(bitmap.height * skala));
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff'; // latar transparan → putih (QR hitam di atas transparan tetap terbaca)
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// [PF-07] Kode QR & barcode — pilih mesin: BarcodeDetector bawaan bila mendukung QR, selain itu jsQR lokal
function muatPembaca() {
  pembaca ??= (async () => {
    if ('BarcodeDetector' in self) {
      try {
        const format = await self.BarcodeDetector.getSupportedFormats();
        if (format.includes('qr_code')) {
          const detektor = new self.BarcodeDetector({ formats: format });
          return {
            mesin: 'BarcodeDetector',
            baca: async (bitmap) => (await detektor.detect(bitmap)).map((k) => ({ rawValue: k.rawValue, format: k.format })),
          };
        }
      } catch {
        /* jatuh ke jsQR */
      }
    }
    const jsQR = await muatJsQr();
    const coba = (img) => jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return {
      mesin: 'jsQR',
      baca: async (bitmap) => {
        let hasil = coba(piksel(bitmap, SISI_CEPAT));
        if (!hasil && Math.max(bitmap.width, bitmap.height) > SISI_CEPAT) hasil = coba(piksel(bitmap, SISI_PENUH));
        return hasil?.data ? [{ rawValue: hasil.data, format: 'qr_code' }] : [];
      },
    };
  })().catch((err) => {
    pembaca = null;
    throw err;
  });
  return pembaca;
}

// [PF-07] Kode QR & barcode — membaca kode pada gambar yang sudah dinormalisasi service worker
/**
 * @param {string} dataUrl  gambar ≤ 1280 px dari service worker
 * @returns {Promise<{kode: Array, kalimat: string, mesin: string, ms: number}>}
 */
export async function bacaKode(dataUrl) {
  const { mesin, baca } = await muatPembaca();
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const t0 = performance.now();
    const mentah = await baca(bitmap);
    return { ...ringkasKode(mentah), mesin, ms: Math.round(performance.now() - t0) };
  } finally {
    bitmap.close();
  }
}
