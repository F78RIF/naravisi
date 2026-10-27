// Service worker NaraVisi (Manifest V3).
// Tugas: menyuntik panel ke halaman, mengambil byte gambar, memanggil REST API,
// dan pemandu suara (chrome.tts) yang tetap bekerja tanpa halaman terbuka.

import {
  ApiError, apiFetch, AUTO_DAILY_MAX, AUTO_MAX_PER_PAGE, AUTO_RESERVE, getSession, getSettings, getTts, MAX_IMAGE_BYTES, refreshProfile, setSession,
} from './shared/config.js';
import { imageCountText, spokenShortcut, welcomeText } from './shared/guide.js';

const CONTENT_FILE = 'content/content.js';
const DIRECT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIDE = 1280; // gambar lebih besar diperkecil sebelum dikirim
const REENCODE_ABOVE_BYTES = 1.5 * 1024 * 1024;

class NvError extends Error {
  constructor(code, message, { spoken = false, sisa } = {}) {
    super(message);
    this.code = code;
    this.spoken = spoken; // sudah dibacakan oleh chrome.tts → panel tidak perlu membacakan ulang
    if (sisa !== undefined) this.sisa = sisa; // sisa kuota saat mode baca berurutan berhenti
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

/** Pintasan Chrome (manifest "commands"): Alt+Shift+K = "scan-page" → buka/tutup panel. */
export function onCommand(command, tab) {
  if (command === 'scan-page') return handleScanCommand(tab);
  return undefined;
}

chrome.commands.onCommand.addListener(onCommand);

// ---------------------------------------------------------------------------
// Pengumuman jumlah gambar saat halaman dibuka (hanya menghitung, tidak ada yang dikirim ke server;
// deskripsi tetap hanya setelah pengguna memilih gambar, supaya kuota tidak terpakai tanpa izin).
// ---------------------------------------------------------------------------
const ANNOUNCE_DELAY_MS = 1500;
const isWebPage = (url) => /^https?:/i.test(url || ''); // bukan chrome://, bukan halaman extension
const announcing = new Set();

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !isWebPage(tab.url)) return;
  setTimeout(() => {
    announceImageCount(tabId).catch(() => {});
    autoDescribePage(tabId).catch(() => {});
    enableFocusDescribe(tabId).catch(() => {});
  }, ANNOUNCE_DELAY_MS);
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
// Mode "Baca berurutan" (bawaan MATI, wajib persetujuan di Pengaturan).
// Semua syarat diperiksa di sini, bukan di halaman: http/https saja, bukan Incognito,
// bukan situs dikecualikan, sudah masuk, sisa kuota > AUTO_RESERVE, dan batas harian.
// ---------------------------------------------------------------------------
const autoLog = []; // dipakai uji otomatis

function logAuto(entry) {
  autoLog.push({ ...entry, at: Date.now() });
  if (autoLog.length > 50) autoLog.shift();
  return entry;
}

const todayWita = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Makassar' }); // kuota direset 00.00 WITA

/** "gopay" cocok dengan bagian domain mana pun; "bri.co.id" cocok dengan domain itu & subdomainnya. */
export function isExcluded(url, list) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return (list ?? []).some((raw) => {
    const entry = String(raw).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:].*$/, '');
    if (!entry) return false;
    if (!entry.includes('.')) return host.split('.').includes(entry);
    return host === entry || host.endsWith(`.${entry}`);
  });
}

/** null = boleh; selain itu alasan penolakan. */
async function autoBlockedReason(tab, settings) {
  if (!tab || !isWebPage(tab.url)) return 'not-web';
  if (tab.incognito) return 'incognito';
  if (isExcluded(tab.url, settings.autoExclude)) return 'excluded';
  if (!(await getSession())?.token) return 'not-logged-in';
  return null;
}

const quotaLow = (kuota) => Boolean(kuota && kuota.batas != null && kuota.sisa <= AUTO_RESERVE);

async function autoDailyCount() {
  const { nvAutoDaily } = await chrome.storage.local.get('nvAutoDaily');
  return nvAutoDaily?.date === todayWita() ? nvAutoDaily.count : 0;
}

async function countAutoUse() {
  await chrome.storage.local.set({ nvAutoDaily: { date: todayWita(), count: (await autoDailyCount()) + 1 } });
}

/**
 * Alasan berhenti karena kuota diumumkan sekali per hari, tidak di setiap halaman. Dengan `page`, pengumuman
 * masuk ke live region halaman (aria-live polite, tidak menyela NVDA); tanpa itu dibacakan chrome.tts.
 */
async function noticeReserve(sisa, page) {
  const { nvAutoReserveNotice } = await chrome.storage.local.get('nvAutoReserveNotice');
  if (nvAutoReserveNotice === todayWita()) return;
  await chrome.storage.local.set({ nvAutoReserveNotice: todayWita() });
  const text = `Baca berurutan berhenti: sisa kuota hari ini ${sisa}, disisakan untuk pilihan Anda.`;
  if (page) await chrome.tabs.sendMessage(page.tabId, { type: 'NV_LIVE', text }, { documentId: page.documentId });
  else await speakGuide(text);
}

/** Dipanggil untuk setiap NV_DESCRIBE bertanda auto; melempar NvError bila tidak boleh. */
async function autoGate(auto, sender, session) {
  const settings = await getSettings();
  const enabled = auto === 'focus' ? settings.describeOnFocus : settings.autoDescribe;
  if (!enabled) throw new NvError('AUTO_OFF', 'Mode otomatis tidak aktif.');
  if (await autoBlockedReason(sender?.tab, settings)) throw new NvError('AUTO_NOT_ALLOWED', 'Halaman ini tidak diproses otomatis.');
  let kuota = session?.user?.kuota;
  // Kuota tersimpan bisa basi (mis. sudah lewat 00.00 WITA): pastikan ke server sebelum menolak.
  if (quotaLow(kuota)) kuota = (await refreshProfile().catch(() => null))?.kuota ?? kuota;
  if (quotaLow(kuota)) {
    // Baca berurutan mengumumkan alasannya lewat aria-live di halaman (tidak menyela NVDA); mode fokus lewat suara.
    if (auto === 'focus') await noticeReserve(kuota.sisa);
    throw new NvError('AUTO_RESERVE', `Sisa kuota ${kuota.sisa} disisakan untuk pilihan Anda.`, { spoken: auto === 'focus', sisa: kuota.sisa });
  }
  if ((await autoDailyCount()) >= AUTO_DAILY_MAX) throw new NvError('AUTO_DAILY_LIMIT', 'Batas harian mode otomatis tercapai.');
}

function autoSummary({ described = 0, stopped, kuota }) {
  if (!described && stopped !== 'quota' && stopped !== 'daily') return null;
  const parts = [];
  if (described) parts.push(`${described} gambar sudah dideskripsikan.`);
  if (kuota && kuota.batas != null) parts.push(`Sisa kuota hari ini ${kuota.sisa}.`);
  if (stopped === 'quota') parts.push(`Baca berurutan berhenti agar ${AUTO_RESERVE} kuota tersisa untuk pilihan Anda.`);
  if (stopped === 'daily') parts.push('Batas harian baca berurutan tercapai.');
  return parts.join(' ');
}

/**
 * Setelah halaman selesai dimuat: deskripsikan maks. N gambar tanpa alt bermakna, satu per satu dari atas ke bawah.
 * Progres & alasan berhenti diumumkan content script lewat aria-live; di sini hanya dicatat (autoLog).
 */
export async function autoDescribePage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const base = { tabId, url: tab.url };
  if (!tab.active) return null;
  const settings = await getSettings();
  if (!settings.autoDescribe) return logAuto({ ...base, result: 'off' });
  const blocked = await autoBlockedReason(tab, settings);
  if (blocked) return logAuto({ ...base, result: blocked });

  let user;
  try {
    user = await refreshProfile(); // kuota terbaru; tidak memakai kuota
  } catch {
    return logAuto({ ...base, result: 'error' });
  }
  const dailyLeft = AUTO_DAILY_MAX - (await autoDailyCount());
  const [injected] = await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
  if (quotaLow(user.kuota)) {
    await noticeReserve(user.kuota.sisa, { tabId, documentId: injected.documentId });
    return logAuto({ ...base, result: 'quota' });
  }
  if (dailyLeft <= 0) return logAuto({ ...base, result: 'daily' });

  const max = Math.min(Math.max(1, Math.min(AUTO_MAX_PER_PAGE, Number(settings.autoMax) || 3)), dailyLeft);
  const res = await chrome.tabs.sendMessage(tabId, { type: 'NV_AUTO_START', max }, { documentId: injected.documentId });
  const summary = autoSummary(res ?? {});
  return logAuto({ ...base, result: res?.skipped || 'done', described: res?.described ?? 0, stopped: res?.stopped ?? null, summary });
}

/** Pasang pendengar fokus di halaman bila "Deskripsikan saat gambar mendapat fokus" aktif. */
export async function enableFocusDescribe(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const settings = await getSettings();
  if (!settings.describeOnFocus || (await autoBlockedReason(tab, settings))) return false;
  const [injected] = await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
  await chrome.tabs.sendMessage(tabId, { type: 'NV_FOCUS_ENABLE' }, { documentId: injected.documentId });
  return true;
}

// ---------------------------------------------------------------------------
// Saat Chrome dibuka: sapaan singkat, sesi kedaluwarsa, atau pintasan belum diatur
// ---------------------------------------------------------------------------
chrome.runtime.onStartup.addListener(() => {
  startupGreeting().catch(() => {});
});

export async function startupGreeting() {
  const { greetOnStartup } = await getSettings();
  if (!greetOnStartup || !(await getSession())?.token) return null;
  let user = null;
  try {
    user = await refreshProfile();
  } catch (err) {
    if (err.status === 401) {
      await sendToLogin('Sesi NaraVisi berakhir. Halaman masuk dibuka.');
      return 'expired';
    }
  }
  const parts = ['NaraVisi aktif.'];
  if (!user) parts.push('Server NaraVisi belum terhubung.');
  else if (user.kuota?.batas != null) parts.push(`Sisa kuota hari ini ${user.kuota.sisa}.`);
  else parts.push('Kuota tanpa batas.');
  const shortcut = await spokenShortcut();
  if (!shortcut) parts.push('Pintasan NaraVisi belum diatur. Halaman pengaturan dibuka.');
  await speakGuide(parts.join(' '));
  if (!shortcut) await openPage('pintasan'); // tombol ke chrome://extensions/shortcuts
  return shortcut ? 'greeted' : 'no-shortcut';
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

// ---------------------------------------------------------------------------
// SVG → JPEG lewat dokumen offscreen (service worker tidak bisa menggambar SVG)
// ---------------------------------------------------------------------------
const OFFSCREEN_URL = 'offscreen/offscreen.html';
const MAX_SVG_BYTES = 2 * 1024 * 1024;
let offscreenReady = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length) return;
  offscreenReady ??= chrome.offscreen
    .createDocument({ url: OFFSCREEN_URL, reasons: ['BLOBS'], justification: 'Mengubah gambar SVG menjadi JPEG sebelum dideskripsikan.' })
    .finally(() => { offscreenReady = null; });
  await offscreenReady;
}

async function looksLikeSvg(blob, type) {
  if (type === 'image/svg+xml') return true;
  if (type.startsWith('image/')) return false;
  // Server yang salah mengirim jenis berkas (text/xml, text/plain, kosong).
  const head = (await blob.slice(0, 512).text()).trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

async function rasterizeSvg(blob) {
  if (blob.size > MAX_SVG_BYTES) throw new NvError('IMAGE_TOO_LARGE', 'Gambar vektor (SVG) terlalu besar untuk diproses.');
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'NV_RASTERIZE_SVG', svg: await blob.text() });
  if (!res?.ok) throw new NvError('IMAGE_UNSUPPORTED', 'Gambar vektor (SVG) ini tidak dapat dibaca.');
  return (await fetch(res.dataUrl)).blob();
}

/** Ubah format tak didukung (AVIF, SVG, dll.) atau gambar besar menjadi JPEG. */
async function normalizeBlob(blob) {
  const type = (blob.type || '').toLowerCase().split(';')[0].trim();
  if (await looksLikeSvg(blob, type)) return rasterizeSvg(blob);
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
/** Petunjuk halaman dari content script (kurang tepercaya): hanya teks pendek pada kunci yang dikenal. */
function pageContext(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const key of ['alt', 'caption', 'page_title']) {
    if (typeof raw[key] === 'string' && raw[key].trim()) out[key] = raw[key].trim().slice(0, 300);
  }
  return Object.keys(out).length ? out : undefined;
}

async function requestDescription({ src, dataUrl, pageUrl, auto, context }, sender) {
  const session = await getSession();
  if (auto) {
    if (!['page', 'focus'].includes(auto)) throw new NvError('MESSAGE_REJECTED', 'Pesan tidak dikenal.');
    await autoGate(auto, sender, session); // mode otomatis tidak pernah membuka tab masuk
  }
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
        context: pageContext(context),
      },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !auto) {
      throw new NvError(err.code, await sendToLogin('Sesi berakhir. Halaman masuk dibuka.'), { spoken: true });
    }
    throw new NvError(err.code || 'SERVER_ERROR', err.message);
  }
  if (auto) await countAutoUse();

  // Simpan sisa kuota terbaru ke sesi agar popup langsung akurat.
  if (data.kuota && session.user) {
    await setSession({ ...session, user: { ...session.user, kuota: data.kuota } });
  }
  return data;
}

async function sendReport({ riwayatId, kategori, catatan }) {
  const text = (v) => (typeof v === 'string' ? v.slice(0, 1000) : undefined);
  try {
    return await apiFetch('/reports', { method: 'POST', body: { riwayat_id: riwayatId, kategori: text(kategori), catatan: text(catatan) || undefined } });
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

// Font panel (Atkinson Hyperlegible) dikirim sebagai byte ke content script, supaya berkas font
// tidak perlu dijadikan web_accessible_resources (yang memungkinkan situs mendeteksi NaraVisi).
const FONT_WEIGHTS = [400, 700];
let fontCache = null;

function fontPayload() {
  fontCache ??= Promise.all(
    FONT_WEIGHTS.map(async (weight) => {
      const res = await fetch(chrome.runtime.getURL(`fonts/atkinson-hyperlegible-${weight}.woff2`));
      return { weight, base64: bytesToBase64(new Uint8Array(await res.arrayBuffer())) };
    }),
  ).catch((err) => {
    fontCache = null;
    throw err;
  });
  return fontCache;
}

const PAGES = {
  riwayat: 'pages/riwayat.html',
  pengaturan: 'pages/pengaturan.html',
  premium: 'pages/premium.html',
  profil: 'pages/profil.html',
  masuk: 'pages/selamat-datang.html#masuk',
  pintasan: 'pages/pengaturan.html#pintasan',
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
const CONTENT_SCRIPT_TYPES = new Set(['NV_DESCRIBE', 'NV_REPORT', 'NV_GET_TTS', 'NV_OPEN_PAGE', 'NV_FONTS']);
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
      case 'NV_DESCRIBE': {
        const data = await requestDescription(message, sender);
        if (message.auto === 'focus') await speakGuide(`Deskripsi NaraVisi: ${data.text}`);
        return { ok: true, data };
      }
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
      case 'NV_FONTS':
        return { ok: true, data: await fontPayload() };
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
        sisa: err.sisa,
      }),
    );
  return true; // respons asinkron
});

// Dipakai pengujian otomatis (Playwright) untuk memicu panel tanpa shortcut.
globalThis.naraVisi = {
  togglePanel, toggleActiveTab, openPage, handleScanCommand, onCommand, announceImageCount, spokenLog, rejectReason,
  autoDescribePage, enableFocusDescribe, startupGreeting, isExcluded, autoLog,
};
