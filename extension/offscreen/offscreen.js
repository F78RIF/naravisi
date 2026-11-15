// NaraVisi · extension/offscreen/offscreen.js
// Fungsi   : Dokumen offscreen: mengubah SVG menjadi JPEG (service worker tidak punya DOM).
// SVG dimuat sebagai <img>: skrip di dalamnya tidak berjalan, sumber eksternal tidak diunduh.
//            Juga menjalankan lapis lokal atas permintaan service worker: deteksi objek MediaPipe + warna dominan
//            (PF-05, PF-08), pembaca kode QR (PF-07), dan pembaca teks di gambar Tesseract.js (PF-06).
// Kebutuhan: RF-09, PF-05, PF-06, PF-07, PF-08, PF-11
// Terkait  : background.js (rasterizeSvg, detectObjects, readCodes, readText), offscreen.html, deteksi-objek.js,
//            kode-qr.js, baca-teks.js

import { deteksiObjek } from './deteksi-objek.js';
import { bacaKode } from './kode-qr.js';
import { bacaTeks, panaskanOcr } from './baca-teks.js';
import { deskripsiAiBawaan, statusAiBawaan } from './ai-bawaan.js';

const MAX_SIDE = 1280;
const FALLBACK_SIDE = 512; // SVG tanpa width/height/viewBox

// [RF-09] Mengirim gambar ke AI — SVG → JPEG di dokumen offscreen (skrip di SVG tidak dijalankan)
async function rasterize(svgText) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || FALLBACK_SIDE;
    let h = img.naturalHeight || FALLBACK_SIDE;
    // Ikon kecil diperbesar agar model AI melihat detailnya; gambar besar diperkecil.
    const scale = Math.min(MAX_SIDE / Math.max(w, h), Math.max(1, FALLBACK_SIDE / Math.max(w, h)));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Hanya pesan khusus dari service worker NaraVisi; pesan lain dibiarkan untuk service worker.
  const fromExtension = sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (!fromExtension || message?.target !== 'offscreen') return false;
  // [PF-05] Deteksi objek lokal — permintaan deteksi dari service worker (data URL gambar yang sudah dinormalisasi)
  if (message.type === 'NV_DETECT_OBJECTS' && typeof message.dataUrl === 'string' && message.dataUrl.startsWith('data:image/')) {
    deteksiObjek(message.dataUrl)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, message: String(err?.message || err) }));
    return true;
  }
  // [PF-07] Kode QR & barcode — permintaan baca kode dari service worker (hasil: domain/teks, tautan tidak dibuka)
  if (message.type === 'NV_READ_CODES' && typeof message.dataUrl === 'string' && message.dataUrl.startsWith('data:image/')) {
    bacaKode(message.dataUrl)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, message: String(err?.message || err) }));
    return true;
  }
  // [PF-06] Teks di gambar (OCR) — permintaan baca teks (Tesseract lokal, batas 4 detik) dan pemanasan saat panel dibuka
  if (message.type === 'NV_READ_TEXT' && typeof message.dataUrl === 'string' && message.dataUrl.startsWith('data:image/')) {
    bacaTeks(message.dataUrl)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, message: String(err?.message || err) }));
    return true;
  }
  if (message.type === 'NV_WARM_OCR') {
    panaskanOcr().then((ok) => sendResponse({ ok }));
    return true;
  }
  // [PF-11] Chrome Built-in AI — status (untuk Pengaturan) & deskripsi cadangan offline pertama
  if (message.type === 'NV_AI_BAWAAN_STATUS') {
    statusAiBawaan().then((data) => sendResponse({ ok: true, data }), () => sendResponse({ ok: true, data: { tersedia: false, alasan: 'galat' } }));
    return true;
  }
  if (message.type === 'NV_AI_BAWAAN_DESKRIPSI' && typeof message.dataUrl === 'string' && message.dataUrl.startsWith('data:image/')) {
    deskripsiAiBawaan(message.dataUrl, message.konteks)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, message: String(err?.message || err) }));
    return true;
  }
  if (message.type !== 'NV_RASTERIZE_SVG' || typeof message.svg !== 'string') return false;
  rasterize(message.svg)
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
