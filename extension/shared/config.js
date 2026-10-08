// Konfigurasi bersama untuk background dan popup.
export const DEFAULTS = Object.freeze({
  apiBase: 'http://localhost:3000/api/v1',
  lang: 'id',
});

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}
