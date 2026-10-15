// Konfigurasi & sesi bersama untuk background, popup, dan halaman extension.
export const DEFAULTS = Object.freeze({
  apiBase: 'http://localhost:3000/api/v1',
  announceImages: true, // umumkan jumlah gambar saat halaman dibuka (disimpan lokal, tidak ke server)
});

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const DEFAULT_TTS = Object.freeze({
  bahasa_deskripsi: 'id',
  pintasan_keyboard: 'Alt+Shift+N',
  kecepatan_suara: 1,
  nada_suara: 1,
  jenis_suara: null,
  fitur_premium: false,
});

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

// ---------------------------------------------------------------------------
// Sesi login (W8): token disimpan di chrome.storage.local milik extension,
// tidak dapat dibaca situs web, dan dihapus saat keluar atau saat server menolak.
// ---------------------------------------------------------------------------
export async function getSession() {
  const { nvSession } = await chrome.storage.local.get('nvSession');
  return nvSession ?? null;
}

export async function setSession(session) {
  await chrome.storage.local.set({ nvSession: session });
}

export async function clearSession() {
  await chrome.storage.local.remove(['nvSession', 'nvTts']);
}

export async function getTts() {
  const { nvTts } = await chrome.storage.local.get('nvTts');
  return { ...DEFAULT_TTS, ...(nvTts ?? {}) };
}

export async function setTts(tts) {
  await chrome.storage.local.set({ nvTts: tts });
}

export class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Memanggil REST API NaraVisi dengan token sesi. */
export async function apiFetch(path, { method = 'GET', body, timeoutMs = 15000, auth = true } = {}) {
  const { apiBase } = await getSettings();
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const session = await getSession();
    if (session?.token) headers.authorization = `Bearer ${session.token}`;
  }

  let res;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new ApiError('TIMEOUT', 'Server terlalu lama merespons. Coba lagi.', 0);
    }
    throw new ApiError(
      'BACKEND_UNREACHABLE',
      'Tidak dapat terhubung ke server NaraVisi. Periksa koneksi internet atau pastikan server berjalan.',
      0,
    );
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth) await clearSession();
    throw new ApiError(
      data?.error?.code || 'SERVER_ERROR',
      data?.error?.message || 'Server gagal memproses permintaan.',
      res.status,
      data?.error?.details,
    );
  }
  return data;
}

/** Login/registrasi berhasil → simpan sesi & ambil pengaturan TTS dari server. */
export async function startSession({ token, user }) {
  await setSession({ token, user, savedAt: Date.now() });
  await refreshTts();
  return user;
}

export async function refreshProfile() {
  const user = await apiFetch('/me');
  const session = await getSession();
  if (session) await setSession({ ...session, user });
  return user;
}

export async function refreshTts() {
  try {
    const tts = await apiFetch('/settings');
    await setTts(tts);
    return tts;
  } catch {
    return getTts();
  }
}

export async function logout() {
  await clearSession();
}
