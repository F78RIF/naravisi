// Service worker NaraVisi (Manifest V3).
// Tugas: menyuntik panel ke halaman, mengambil byte gambar, memanggil REST API,
// dan pemandu suara (chrome.tts) yang tetap bekerja tanpa halaman terbuka.

import { ApiError, apiFetch, getSession, getSettings, getTts, MAX_IMAGE_BYTES, refreshProfile, setSession } from './shared/config.js';
import { imageCountText, spokenShortcut, welcomeText } from './shared/guide.js';

const CONTENT_FILE = 'content/content.js';
const DIRECT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIDE = 1280; // gambar lebih besar diperkecil sebelum dikirim
const REENCODE_ABOVE_BYTES = 1.5 * 1024 * 1024;

class NvError extends Error {
  constructor(code, message, { spoken = false } = {}) {
    super(message);
    this.code = code;
    this.spoken = spoken; // sudah dibacakan oleh chrome.tts → panel tidak perlu membacakan ulang
  }
}

// ---------------------------------------------------------------------------
// Pemandu suara (chrome.tts) — satu kalimat per kejadian, kalimat baru memotong yang lama
// ---------------------------------------------------------------------------
const spokenLog = []; // dipakai uji otomatis

export async function speakGuide(text) {
  spokenLog.push({ text, at: Date.now() });
  if (spokenLog.length > 50) spokenLog.shift();
  const tts = await getTts();
  chrome.tts.speak(text, { lang: 'id-ID', rate: Number(tts.kecepatan_suara) || 1, enqueue: false }, () => {
    void chrome.runtime.lastError; // perangkat tanpa mesin suara: abaikan, teks tetap ada di aria-live
  });
}

/** Belum/tidak lagi masuk: bacakan alasannya lalu buka tab masuk. */
async function sendToLogin(message) {
  await speakGuide(message);
  await openPage('masuk');
  return message;
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) return;
  // Popup sulit ditemukan pembaca layar; tab biasa langsung mendapat fokus.
  await chrome.tabs.create({ url: chrome.runtime.getURL(PAGES.selamatDatang) });
  await speakGuide(welcomeText(await spokenShortcut()));
});

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

export async function handleScanCommand(tab) {
  if (!(await getSession())?.token) {
    await sendToLogin('Anda belum masuk. Halaman masuk dibuka.');
    return { ok: false, code: 'NOT_LOGGED_IN' };
  }
  return tab?.id ? togglePanel(tab.id) : toggleActiveTab();
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'scan-page') handleScanCommand(tab);
});

// ---------------------------------------------------------------------------
// Pengumuman jumlah gambar saat halaman dibuka (hanya menghitung, tidak ada yang dikirim ke server;
// deskripsi tetap hanya setelah pengguna memilih gambar, supaya kuota tidak terpakai tanpa izin).
// ---------------------------------------------------------------------------
const ANNOUNCE_DELAY_MS = 1500;
const isWebPage = (url) => /^https?:/i.test(url || ''); // bukan chrome://, bukan halaman extension
const announcing = new Set();

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !isWebPage(tab.url)) return;
  setTimeout(() => announceImageCount(tabId).catch(() => {}), ANNOUNCE_DELAY_MS);
});

export async function announceImageCount(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || !isWebPage(tab.url)) return;
  const { announceImages } = await getSettings();
  if (!announceImages || !(await getSession())?.token) return;

  // Pakai pemindai yang sama dengan panel agar jumlahnya cocok.
  const [injected] = await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
  const documentId = injected?.documentId;
  if (!documentId || announcing.has(documentId)) return;
  announcing.add(documentId);
  // Sekali per halaman (per dokumen), juga setelah service worker dimulai ulang.
  const { nvAnnounced = [] } = await chrome.storage.session.get('nvAnnounced');
  if (nvAnnounced.includes(documentId)) return;
  await chrome.storage.session.set({ nvAnnounced: [...nvAnnounced.slice(-99), documentId] });

  const res = await chrome.tabs.sendMessage(tabId, { type: 'NV_COUNT' }, { documentId });
  if (res?.count > 0) await speakGuide(imageCountText(res.count, await spokenShortcut()));
}

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
// Memanggil REST API (RF-09, RF-10, RF-11, RF-13)
// ---------------------------------------------------------------------------
async function requestDescription({ src, dataUrl, pageUrl }) {
  const session = await getSession();
  if (!session?.token) {
    throw new NvError('NOT_LOGGED_IN', await sendToLogin('Anda belum masuk. Halaman masuk dibuka.'), { spoken: true });
  }
  const tts = await getTts();
  const imageBase64 = await imageToBase64({ src, dataUrl });

  let data;
  try {
    data = await apiFetch('/descriptions', {
      method: 'POST',
      timeoutMs: 30000,
      body: {
        image_base64: imageBase64,
        image_url: src && !src.startsWith('data:') && !src.startsWith('blob:') ? src : null,
        page_url: pageUrl,
        lang: tts.bahasa_deskripsi,
      },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new NvError(err.code, await sendToLogin('Sesi berakhir. Halaman masuk dibuka.'), { spoken: true });
    }
    throw new NvError(err.code || 'SERVER_ERROR', err.message);
  }

  // Simpan sisa kuota terbaru ke sesi agar popup langsung akurat.
  if (data.kuota && session.user) {
    await setSession({ ...session, user: { ...session.user, kuota: data.kuota } });
  }
  return data;
}

async function sendReport({ riwayatId, alasan }) {
  try {
    return await apiFetch('/reports', { method: 'POST', body: { riwayat_id: riwayatId, alasan } });
  } catch (err) {
    throw new NvError(err.code || 'SERVER_ERROR', err.message);
  }
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

const PAGES = {
  riwayat: 'pages/riwayat.html',
  pengaturan: 'pages/pengaturan.html',
  premium: 'pages/premium.html',
  profil: 'pages/profil.html',
  masuk: 'pages/selamat-datang.html#masuk',
  selamatDatang: 'pages/selamat-datang.html',
};

async function openPage(name) {
  const path = PAGES[name];
  if (!path) return { ok: false };
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pesan dari content script & popup
// ---------------------------------------------------------------------------
// Tipe pesan yang diterima, per jenis pengirim. Content script berjalan di dalam halaman web
// (kurang tepercaya), jadi hanya boleh memakai yang dibutuhkan panel; token tidak pernah dikirim balik.
const CONTENT_SCRIPT_TYPES = new Set(['NV_DESCRIBE', 'NV_REPORT', 'NV_GET_TTS', 'NV_OPEN_PAGE']);
const EXTENSION_PAGE_TYPES = new Set([
  ...CONTENT_SCRIPT_TYPES,
  'NV_TOGGLE_ACTIVE',
  'NV_HEALTH',
  'NV_REFRESH_PROFILE',
  'NV_SPEAK',
]);
const EXTENSION_ORIGIN = chrome.runtime.getURL('');

/** 'sender' = pengirim tidak dikenal, 'type' = tipe tidak dikenal/tidak diizinkan, null = boleh. */
export function rejectReason(message, sender) {
  if (!sender || sender.id !== chrome.runtime.id) return 'sender';
  const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(EXTENSION_ORIGIN);
  const allowed = fromExtensionPage ? EXTENSION_PAGE_TYPES : CONTENT_SCRIPT_TYPES;
  return allowed.has(message?.type) ? null : 'type';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const rejected = rejectReason(message, sender);
  if (rejected === 'sender') return false; // abaikan tanpa jawaban
  if (rejected === 'type') {
    sendResponse({ ok: false, code: 'MESSAGE_REJECTED', message: 'Pesan tidak dikenal.' });
    return false;
  }

  const handle = async () => {
    switch (message?.type) {
      case 'NV_DESCRIBE':
        return { ok: true, data: await requestDescription(message) };
      case 'NV_TOGGLE_ACTIVE':
        return toggleActiveTab();
      case 'NV_HEALTH':
        return backendHealth();
      case 'NV_REPORT':
        return { ok: true, data: await sendReport(message) };
      case 'NV_GET_TTS':
        return { ok: true, data: await getTts(), loggedIn: Boolean((await getSession())?.token) };
      case 'NV_OPEN_PAGE':
        return openPage(message.page);
      case 'NV_REFRESH_PROFILE':
        return { ok: true, data: await refreshProfile() };
      case 'NV_SPEAK':
        if (typeof message.text !== 'string' || !message.text.trim()) return { ok: false };
        await speakGuide(message.text.slice(0, 500));
        return { ok: true };
      default:
        return { ok: false, code: 'MESSAGE_REJECTED', message: 'Pesan tidak dikenal.' };
    }
  };

  handle()
    .then(sendResponse)
    .catch((err) =>
      sendResponse({
        ok: false,
        code: err.code || 'UNKNOWN',
        message: err.message || 'Terjadi kesalahan.',
        spoken: Boolean(err.spoken),
      }),
    );
  return true; // respons asinkron
});

// Dipakai pengujian otomatis (Playwright) untuk memicu panel tanpa shortcut.
globalThis.naraVisi = { togglePanel, toggleActiveTab, openPage, handleScanCommand, announceImageCount, spokenLog, rejectReason };
