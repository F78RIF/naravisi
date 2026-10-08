// Service worker NaraVisi (Manifest V3).
// Tugas: menyuntik panel ke halaman, mengambil byte gambar, memanggil REST API.

import { getSettings, MAX_IMAGE_BYTES } from './shared/config.js';

const CONTENT_FILE = 'content/content.js';
const DIRECT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIDE = 1280; // gambar lebih besar diperkecil sebelum dikirim
const REENCODE_ABOVE_BYTES = 1.5 * 1024 * 1024;

class NvError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Membuka / menutup panel (UC-GBR-01)
// ---------------------------------------------------------------------------
export async function togglePanel(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
    const res = await chrome.tabs.sendMessage(tabId, { type: 'NV_TOGGLE' });
    return { ok: true, ...res };
  } catch (err) {
    console.warn('NaraVisi: gagal membuka panel', err);
    return {
      ok: false,
      code: 'PAGE_NOT_ACCESSIBLE',
      message: 'Halaman ini tidak dapat diakses oleh NaraVisi (misalnya halaman pengaturan browser atau Chrome Web Store).',
    };
  }
}

async function toggleActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, message: 'Tidak ada tab aktif.' };
  return togglePanel(tab.id);
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'scan-page') return;
  if (tab?.id) await togglePanel(tab.id);
  else await toggleActiveTab();
});

// ---------------------------------------------------------------------------
// Mengambil gambar → base64 (UC-GBR-04)
// ---------------------------------------------------------------------------
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImageBlob(src) {
  let response;
  try {
    // credentials: include → gambar yang hanya tampil setelah login tetap bisa diambil.
    response = await fetch(src, { credentials: 'include', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new NvError('IMAGE_FETCH_FAILED', 'Gambar tidak dapat diunduh dari halaman ini.');
  }
  if (!response.ok) {
    throw new NvError('IMAGE_FETCH_FAILED', `Gambar tidak dapat diunduh (kode ${response.status}).`);
  }
  return response.blob();
}

/** Ubah format tak didukung (AVIF, SVG raster, dll.) atau gambar besar menjadi JPEG. */
async function normalizeBlob(blob) {
  const type = (blob.type || '').toLowerCase();
  if (type === 'image/svg+xml') {
    throw new NvError('IMAGE_UNSUPPORTED', 'Gambar vektor (SVG) belum didukung.');
  }
  if (DIRECT_TYPES.has(type) && blob.size <= REENCODE_ABOVE_BYTES) return blob;

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    if (DIRECT_TYPES.has(type) && blob.size <= MAX_IMAGE_BYTES) return blob;
    throw new NvError('IMAGE_UNSUPPORTED', 'Format gambar ini tidak didukung.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

async function imageToBase64({ src, dataUrl }) {
  const source = dataUrl || src;
  if (!source) throw new NvError('IMAGE_MISSING', 'Alamat gambar kosong.');
  const blob = await normalizeBlob(await fetchImageBlob(source));
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new NvError('IMAGE_TOO_LARGE', 'Ukuran gambar terlalu besar untuk diproses.');
  }
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

// ---------------------------------------------------------------------------
// Memanggil REST API (RF-09, RF-10, RF-11)
// ---------------------------------------------------------------------------
async function requestDescription({ src, dataUrl, pageUrl }) {
  const settings = await getSettings();
  const imageBase64 = await imageToBase64({ src, dataUrl });

  let response;
  try {
    response = await fetch(`${settings.apiBase}/descriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        image_url: src && !src.startsWith('data:') ? src : null,
        page_url: pageUrl,
        lang: settings.lang,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new NvError('TIMEOUT', 'Server terlalu lama merespons. Coba lagi.');
    }
    throw new NvError(
      'BACKEND_UNREACHABLE',
      'Tidak dapat terhubung ke server NaraVisi. Periksa koneksi internet atau pastikan server berjalan.',
    );
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // bukan JSON
  }
  if (!response.ok) {
    throw new NvError(body?.error?.code || 'SERVER_ERROR', body?.error?.message || 'Server gagal memproses gambar.');
  }
  return body;
}

async function backendHealth() {
  const { apiBase } = await getSettings();
  try {
    const res = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, apiBase };
    return { ok: true, apiBase, ...(await res.json()) };
  } catch {
    return { ok: false, apiBase };
  }
}

// ---------------------------------------------------------------------------
// Pesan dari content script & popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case 'NV_DESCRIBE':
        return { ok: true, data: await requestDescription(message) };
      case 'NV_TOGGLE_ACTIVE':
        return toggleActiveTab();
      case 'NV_HEALTH':
        return backendHealth();
      default:
        return { ok: false, message: 'Pesan tidak dikenal.' };
    }
  };

  handle()
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ ok: false, code: err.code || 'UNKNOWN', message: err.message || 'Terjadi kesalahan.' }),
    );
  return true; // respons asinkron
});

// Dipakai pengujian otomatis (Playwright) untuk memicu panel tanpa shortcut.
globalThis.naraVisi = { togglePanel, toggleActiveTab };
