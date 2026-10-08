import { DEFAULTS, getSettings } from '../shared/config.js';

const $ = (id) => document.getElementById(id);

function say(text, tone = 'info') {
  const el = $('message');
  el.dataset.tone = tone;
  el.textContent = text;
}

async function checkHealth() {
  const health = await chrome.runtime.sendMessage({ type: 'NV_HEALTH' });
  const el = $('health');
  el.dataset.ok = String(Boolean(health?.ok && health.ai?.ok));
  if (!health?.ok) el.textContent = `Server tidak dapat dihubungi (${health?.apiBase ?? '-'}).`;
  else if (!health.ai?.ok) el.textContent = 'Server aktif, tetapi layanan AI belum siap.';
  else el.textContent = `Server dan layanan AI siap (${health.ai.model ?? health.ai.provider}).`;
}

$('scan').addEventListener('click', async () => {
  say('Memindai…');
  const res = await chrome.runtime.sendMessage({ type: 'NV_TOGGLE_ACTIVE' });
  if (res?.ok) window.close(); // fokus kembali ke panel di halaman
  else say(res?.message || 'Gagal membuka NaraVisi.', 'error');
});

$('api-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const apiBase = $('api-base').value.trim().replace(/\/+$/, '') || DEFAULTS.apiBase;
  await chrome.storage.sync.set({ apiBase, lang: $('lang').value });
  say('Pengaturan disimpan.');
  checkHealth();
});

(async () => {
  const settings = await getSettings();
  $('api-base').value = settings.apiBase;
  $('lang').value = settings.lang;
  $('scan').focus();
  checkHealth();
})();
