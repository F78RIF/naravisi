// Pengaturan aksesibilitas & TTS: RF-17..RF-19 (UC-AKS-01..03)
import { apiFetch, apiHost, DEFAULTS, getSettings, setTts } from '../shared/config.js';
import { $, el, requireSession, say, sayError, shell, speak } from './common.js';

shell('pengaturan', 'Pengaturan aksesibilitas');

const SAMPLE = {
  id: 'Ini contoh suara NaraVisi. Seekor kucing oranye sedang tidur di atas sofa.',
  en: 'This is a NaraVisi voice sample. An orange cat is sleeping on a sofa.',
};

function voicesFor(lang) {
  return new Promise((resolve) => {
    const pick = () =>
      window.speechSynthesis
        .getVoices()
        .filter((v) => v.lang?.toLowerCase().startsWith(lang))
        .sort((a, b) => a.name.localeCompare(b.name));
    const now = pick();
    if (now.length || !('onvoiceschanged' in window.speechSynthesis)) return resolve(now);
    window.speechSynthesis.onvoiceschanged = () => resolve(pick());
    setTimeout(() => resolve(pick()), 1500);
  });
}

// --- Koneksi server (dipindah dari popup): alamat API + status titik/teks
async function renderServer() {
  const { apiBase } = await getSettings();
  const input = el('input', { id: 'api-base', type: 'url', value: apiBase, spellcheck: 'false', required: true, 'aria-describedby': 'api-base-hint' });
  const dot = el('span', { class: 'dot', 'data-state': 'checking' });
  const text = el('span', { id: 'server-text' }, 'Memeriksa server…');

  async function check() {
    const health = await chrome.runtime.sendMessage({ type: 'NV_HEALTH' });
    const host = apiHost(health?.apiBase ?? input.value);
    if (!health?.ok) {
      dot.dataset.state = 'off';
      text.textContent = `Server tidak aktif: ${host} tidak menjawab.`;
    } else if (!health.ai?.ok) {
      dot.dataset.state = 'warn';
      text.textContent = `Server terhubung (${host}), tetapi layanan AI belum siap.`;
    } else {
      dot.dataset.state = 'ok';
      text.textContent = `Server terhubung (${host}).`;
    }
  }

  const form = el(
    'form',
    { class: 'card stack', novalidate: true, 'aria-labelledby': 'sec-server' },
    el('h2', { id: 'sec-server' }, 'Koneksi server'),
    el('p', { class: 'server-status', role: 'status' }, dot, text),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'api-base' }, 'Alamat API'),
      input,
      el('p', { class: 'hint', id: 'api-base-hint' }, `Bawaan: ${DEFAULTS.apiBase}. Ubah hanya bila server NaraVisi berjalan di alamat lain.`),
    ),
    el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Simpan alamat'), el('button', { type: 'button', onclick: check }, 'Periksa ulang')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim().replace(/\/+$/, '') || DEFAULTS.apiBase;
    if (!/^https?:\/\/[^/]+/i.test(value)) {
      input.setAttribute('aria-invalid', 'true');
      say('Alamat API harus diawali http:// atau https://, mis. http://localhost:3000/api/v1.', 'error');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    input.value = value;
    await chrome.storage.sync.set({ apiBase: value });
    say('Alamat API disimpan.', 'ok');
    check();
  });
  $('server').replaceChildren(form);
  check();
}

function field(id, label, control, hint) {
  return el('div', { class: 'stack' }, el('label', { for: id }, label), control, hint ? el('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
}

async function render(settings) {
  const premium = settings.fitur_premium;
  const [cmd] = (await chrome.commands.getAll()).filter((c) => c.name === 'scan-page');
  const activeShortcut = cmd?.shortcut || 'belum diatur';

  // --- Bahasa & pintasan (UC-AKS-02)
  const bahasa = el(
    'select',
    { id: 'bahasa' },
    el('option', { value: 'id' }, 'Bahasa Indonesia'),
    el('option', { value: 'en' }, 'English'),
  );
  bahasa.value = settings.bahasa_deskripsi;
  const pintasan = el('input', { id: 'pintasan', value: settings.pintasan_keyboard, 'aria-describedby': 'pintasan-hint', spellcheck: 'false' });

  // Pengumuman jumlah gambar: disimpan di perangkat ini (chrome.storage.sync), langsung berlaku.
  const umumkan = el('input', { id: 'umumkan', type: 'checkbox', checked: (await getSettings()).announceImages, 'aria-describedby': 'umumkan-hint' });
  umumkan.addEventListener('change', async () => {
    await chrome.storage.sync.set({ announceImages: umumkan.checked });
    say(umumkan.checked ? 'Pengumuman jumlah gambar diaktifkan.' : 'Pengumuman jumlah gambar dimatikan.', 'ok');
  });

  // --- Suara (UC-AKS-03)
  const rateOut = el('output', { for: 'kecepatan', id: 'kecepatan-out' }, `${settings.kecepatan_suara}×`);
  const kecepatan = el('input', { id: 'kecepatan', type: 'range', min: '0.5', max: '2', step: '0.1', value: settings.kecepatan_suara });
  kecepatan.addEventListener('input', () => (rateOut.textContent = `${kecepatan.value}×`));

  const pitchOut = el('output', { for: 'nada', id: 'nada-out' }, `${settings.nada_suara}`);
  const nada = el('input', {
    id: 'nada', type: 'range', min: '0.5', max: '2', step: '0.1', value: settings.nada_suara,
    disabled: !premium, 'aria-describedby': premium ? null : 'nada-hint',
  });
  nada.addEventListener('input', () => (pitchOut.textContent = nada.value));

  const suara = el('select', { id: 'suara', disabled: !premium, 'aria-describedby': premium ? null : 'suara-hint' }, el('option', { value: '' }, 'Suara default perangkat'));
  for (const v of await voicesFor(settings.bahasa_deskripsi)) {
    suara.append(el('option', { value: v.name }, `${v.name} (${v.lang})`));
  }
  suara.value = settings.jenis_suara ?? '';

  const premiumNote = premium
    ? null
    : el('p', { class: 'notice' }, 'Pilihan jenis suara dan nada khusus Pengguna Premium. ', el('a', { href: 'premium.html' }, 'Upgrade ke Premium'));

  const form = el(
    'form',
    { class: 'stack', novalidate: true },
    el(
      'section',
      { class: 'card stack', 'aria-labelledby': 'sec-umum' },
      el('h2', { id: 'sec-umum' }, 'Umum'),
      field('bahasa', 'Bahasa deskripsi', bahasa),
      field(
        'pintasan',
        'Pintasan keyboard untuk memindai',
        pintasan,
        `Pintasan aktif saat ini: ${activeShortcut}. Chrome hanya mengizinkan pintasan diubah dari halaman pintasan Chrome — simpan pilihan Anda di sini, lalu terapkan di sana.`,
      ),
      el('div', { class: 'row' }, el('button', { type: 'button', id: 'open-shortcuts', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }, 'Buka halaman pintasan Chrome')),
      el(
        'div',
        { class: 'stack' },
        el('label', { for: 'umumkan', class: 'check' }, umumkan, 'Umumkan jumlah gambar saat halaman dibuka'),
        el('p', { class: 'hint', id: 'umumkan-hint' }, 'Contoh: "Ada 5 gambar." Gambar tidak dideskripsikan otomatis, jadi kuota tidak terpakai. Tersimpan langsung.'),
      ),
    ),
    el(
      'section',
      { class: 'card stack', 'aria-labelledby': 'sec-suara' },
      el('h2', { id: 'sec-suara' }, 'Suara'),
      el('div', { class: 'stack' }, el('label', { for: 'kecepatan' }, 'Kecepatan suara ', rateOut), kecepatan),
      el('div', { class: 'stack premium-only', 'aria-disabled': String(!premium) }, el('label', { for: 'nada' }, 'Nada suara ', pitchOut), nada, premium ? null : el('p', { class: 'hint', id: 'nada-hint' }, 'Khusus Premium.')),
      el('div', { class: 'stack premium-only', 'aria-disabled': String(!premium) }, el('label', { for: 'suara' }, 'Jenis suara'), suara, premium ? null : el('p', { class: 'hint', id: 'suara-hint' }, 'Khusus Premium.')),
      premiumNote,
      el(
        'div',
        { class: 'row' },
        el('button', {
          type: 'button',
          id: 'test-voice',
          onclick: () =>
            speak(SAMPLE[bahasa.value], {
              bahasa_deskripsi: bahasa.value,
              kecepatan_suara: Number(kecepatan.value),
              nada_suara: Number(nada.value),
              jenis_suara: suara.value || null,
            }),
        }, 'Coba suara'),
      ),
    ),
    el('div', { class: 'row' }, el('button', { type: 'submit', class: 'primary' }, 'Simpan pengaturan')),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      bahasa_deskripsi: bahasa.value,
      pintasan_keyboard: pintasan.value,
      kecepatan_suara: Number(kecepatan.value),
    };
    if (premium) {
      body.nada_suara = Number(nada.value);
      body.jenis_suara = suara.value || null;
    }
    try {
      const saved = await apiFetch('/settings', { method: 'PUT', body });
      await setTts(saved);
      const reminder =
        saved.pintasan_keyboard !== activeShortcut
          ? ` Pintasan ${saved.pintasan_keyboard} tersimpan; terapkan di halaman pintasan Chrome agar aktif.`
          : '';
      say(`Pengaturan berhasil disimpan.${reminder}`, 'ok');
      if (saved.bahasa_deskripsi !== settings.bahasa_deskripsi) render(saved);
    } catch (err) {
      say(err.message, 'error');
      if (err.details?.field === 'pintasan_keyboard' || err.code === 'SHORTCUT_CONFLICT') pintasan.focus();
    }
  });

  bahasa.addEventListener('change', async () => {
    // Daftar suara mengikuti bahasa yang dipilih
    const keep = suara.value;
    suara.replaceChildren(el('option', { value: '' }, 'Suara default perangkat'));
    for (const v of await voicesFor(bahasa.value)) suara.append(el('option', { value: v.name }, `${v.name} (${v.lang})`));
    suara.value = [...suara.options].some((o) => o.value === keep) ? keep : '';
  });

  $('content').replaceChildren(form);
}

(async () => {
  renderServer();
  if (!(await requireSession())) return;
  try {
    const settings = await apiFetch('/settings');
    await setTts(settings);
    await render(settings);
  } catch (err) {
    sayError(err);
  }
})();
