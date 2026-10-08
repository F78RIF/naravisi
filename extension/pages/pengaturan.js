// Pengaturan aksesibilitas & TTS: RF-17..RF-19 (UC-AKS-01..03)
import { apiFetch, setTts } from '../shared/config.js';
import { $, el, requireSession, say, shell, speak } from './common.js';

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
  if (!(await requireSession())) return;
  try {
    const settings = await apiFetch('/settings');
    await setTts(settings);
    await render(settings);
  } catch (err) {
    say(err.message, 'error');
  }
})();
