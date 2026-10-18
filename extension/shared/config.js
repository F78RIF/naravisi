// Konfigurasi & sesi bersama untuk background, popup, dan halaman extension.
// Situs yang tidak pernah diproses mode otomatis (bisa diedit di Pengaturan). Entri tanpa titik
// ("gopay") cocok dengan bagian nama domain mana pun, mis. gopay.co.id.
export const DEFAULT_AUTO_EXCLUDE = Object.freeze([
  'klikbca.com', 'bri.co.id', 'bankmandiri.co.id', 'bni.co.id', 'dana.id', 'ovo.id', 'gopay',
  'mail.google.com', 'outlook.live.com', 'web.whatsapp.com',
]);

export const DEFAULTS = Object.freeze({
  apiBase: 'http://localhost:3000/api/v1',
  announceImages: true, // umumkan jumlah gambar saat halaman dibuka (disimpan lokal, tidak ke server)
  greetOnStartup: true, // sapaan singkat saat Chrome dibuka
  autoDescribe: false, // mode otomatis: kirim gambar utama tanpa alt → wajib persetujuan
  autoMax: 3, // maks. gambar per halaman (1–5)
  describeOnFocus: false, // deskripsikan gambar yang mendapat fokus Tab → wajib persetujuan
  autoExclude: DEFAULT_AUTO_EXCLUDE,
});

export const AUTO_RESERVE = 2; // mode otomatis berhenti bila sisa kuota ≤ 2 (disisakan untuk pilihan manual)
export const AUTO_DAILY_MAX = 30; // batas deskripsi otomatis per hari, apa pun kuotanya

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const DEFAULT_TTS = Object.freeze({
  bahasa_deskripsi: 'id',
  pintasan_keyboard: 'Alt+Shift+K',
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

  /** Gangguan koneksi/server (bukan kesalahan isian) → layak ditawari tombol "Coba lagi". */
  get retryable() {
    return this.code === 'BACKEND_UNREACHABLE' || this.code === 'TIMEOUT' || this.status >= 500;
  }
}

/** "http://localhost:3000/api/v1" → "localhost:3000" (untuk pesan yang dibacakan). */
export function apiHost(apiBase) {
  try {
    return new URL(apiBase).host;
  } catch {
    return apiBase;
  }
}

/** Memanggil REST API NaraVisi dengan token sesi. */
export async function apiFetch(path, { method = 'GET', body, timeoutMs = 15000, auth = true } = {}) {
  const { apiBase } = await getSettings();
  const host = apiHost(apiBase);
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
      throw new ApiError('TIMEOUT', `Server NaraVisi (${host}) terlalu lama menjawab. Coba lagi.`, 0);
    }
    // Tidak ada jawaban sama sekali: server belum dijalankan, port salah, atau jaringan putus.
    throw new ApiError(
      'BACKEND_UNREACHABLE',
      `Tidak dapat terhubung ke server NaraVisi: ${host} tidak menjawab. Pastikan server sudah berjalan, lalu coba lagi.`,
      0,
    );
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth) await clearSession();
    const code = data?.error?.code;
    // Server menjawab tetapi gagal tanpa pesan yang berarti (galat internal, basis data mati, proxy, bukan JSON).
    if (res.status >= 500 && (!code || code === 'INTERNAL')) {
      throw new ApiError(
        code || 'SERVER_ERROR',
        `Server NaraVisi menjawab, tetapi sedang bermasalah (kode ${res.status}). Coba lagi sebentar lagi; bila tetap gagal, periksa log server.`,
        res.status,
      );
    }
    throw new ApiError(
      code || 'SERVER_ERROR',
      data?.error?.message || `Server NaraVisi menjawab, tetapi permintaan gagal (kode ${res.status}).`,
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
