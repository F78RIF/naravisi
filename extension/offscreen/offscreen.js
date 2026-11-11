// NaraVisi · extension/offscreen/offscreen.js
// Fungsi   : Dokumen offscreen: mengubah SVG menjadi JPEG (service worker tidak punya DOM).
// SVG dimuat sebagai <img>: skrip di dalamnya tidak berjalan, sumber eksternal tidak diunduh.
// Kebutuhan: RF-09
// Terkait  : background.js (rasterizeSvg), offscreen.html

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
  if (message.type !== 'NV_RASTERIZE_SVG' || typeof message.svg !== 'string') return false;
  rasterize(message.svg)
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});
