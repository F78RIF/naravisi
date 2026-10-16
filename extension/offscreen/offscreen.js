// Dokumen offscreen NaraVisi: mengubah SVG menjadi JPEG.
// Service worker tidak punya DOM, sedangkan createImageBitmap tidak menerima SVG.
// SVG dimuat sebagai <img>, jadi skrip di dalamnya tidak berjalan dan sumber eksternal tidak diunduh.

const MAX_SIDE = 1280;
const FALLBACK_SIDE = 512; // SVG tanpa width/height/viewBox

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
