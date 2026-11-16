// NaraVisi · extension/pages/pengaturan.js
// Fungsi   : Halaman Pengaturan: bahasa, pintasan, suara, mode otomatis, server, privasi.
// Kebutuhan: RF-17, RF-18, RF-19, PF-02, PF-05, PF-06, PF-07, PF-08, PF-09, PF-10, PF-11, RNF-13
// Terkait  : pengaturan.html, common.js, backend settingsService.js
import { apiFetch, apiHost, AUTO_MAX_PER_PAGE, AUTO_RESERVE, DEFAULT_AUTO_EXCLUDE, DEFAULTS, getSettings, setTts } from '../shared/config.js';
import { currentShortcut, openShortcutsPage, SHORTCUTS_URL, speakGuide } from '../shared/guide.js';
import { $, el, requireSession, say, sayError, shell, speak } from './common.js';
import { ukuranPaketMb } from '../shared/paket-model.js';

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
// [RF-17] Halaman pengaturan — alamat server API & status koneksi
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
  $('server').replaceChildren(form, privacyCard());
  check();
}

// --- Pemberitahuan privasi (ADR-22): selalu tampil, juga sebelum masuk.
// [RNF-13] File gambar tidak disimpan — pemberitahuan privasi: gambar terpilih diteruskan ke Gemini
function privacyCard() {
  return el(
    'section',
    { class: 'card stack', id: 'privasi', 'aria-labelledby': 'sec-privasi' },
    el('h2', { id: 'sec-privasi' }, 'Privasi'),
    el('p', {}, 'Gambar yang Anda pilih dikirim ke server NaraVisi, lalu ke Google Gemini untuk dideskripsikan. File gambar tidak disimpan; yang disimpan hanya teks deskripsi, alamat gambar, dan alamat halaman di riwayat Anda.'),
    el('p', {}, 'Pada layanan Gemini tingkat gratis, Google dapat memakai data yang dikirim untuk meningkatkan produknya. Jangan mendeskripsikan gambar yang berisi data pribadi atau rahasia.'),
    el('p', {}, 'Bila Gemini tidak dapat dipakai (kuota habis atau tidak ada internet), server memakai model cadangan BLIP yang berjalan di komputer server sendiri.'),
    // [PF-13] Cadangan AI cloud gratis — pihak ketiga lain yang mungkin menerima gambar bila diatur pengelola server
    el('p', {}, 'Pengelola server dapat menambahkan cadangan AI cloud gratis sebelum BLIP, yaitu OpenRouter dan Hugging Face. Bila Gemini gagal, gambar yang Anda pilih dapat dikirim ke penyedia tersebut. Deskripsi offline (AI bawaan Chrome, Florence-2, deskripsi sederhana) diproses di komputer Anda dan tidak dikirim ke mana pun.'),
  );
}

// --- Otomatis: semua tersimpan di perangkat ini (chrome.storage.sync) dan langsung berlaku.
const CONSENT_TEXT =
  'Gambar dari halaman yang Anda buka akan dikirim ke server NaraVisi untuk dideskripsikan dan memakai kuota harian. Server meneruskannya ke Google Gemini. Lanjutkan?';

// [PF-02] Baca berurutan — persetujuan wajib sebelum Baca berurutan aktif
/** Dialog persetujuan (modal, dibacakan). Fokus awal di "Batal" agar tidak tersetujui tanpa sengaja. */
function askConsent(text = CONSENT_TEXT, title = 'Kirim gambar ke server?', yesLabel = 'Ya, aktifkan') {
  const yes = el('button', { type: 'button', class: 'primary' }, yesLabel);
  const no = el('button', { type: 'button' }, 'Batal');
  const dialog = el(
    'dialog',
    { class: 'consent', 'aria-labelledby': 'consent-title', 'aria-describedby': 'consent-text' },
    el('h2', { id: 'consent-title' }, title),
    el('p', { id: 'consent-text' }, text),
    el('div', { class: 'row' }, yes, no),
  );
  document.body.append(dialog);
  return new Promise((resolve) => {
    const done = (answer) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    dialog.showModal();
    no.focus();
    speakGuide(text);
  });
}

/** Normalisasi daftar situs: satu domain per baris, tanpa protokol/jalur, tanpa duplikat. */
function parseSites(text) {
  const sites = text
    .split(/[\n,]+/)
    .map((line) => line.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:].*$/, ''))
    .filter(Boolean);
  return [...new Set(sites)];
}

// [PF-02] Baca berurutan — pengaturan mode otomatis & daftar situs dikecualikan
async function autoSection() {
  const stored = await getSettings();
  const check = (id, key, label, hint) => {
    const input = el('input', { id, type: 'checkbox', checked: Boolean(stored[key]), 'aria-describedby': `${id}-hint` });
    const node = el(
      'div',
      { class: 'stack' },
      el('label', { for: id, class: 'check' }, input, label),
      el('p', { class: 'hint', id: `${id}-hint` }, hint),
    );
    return { input, node };
  };

  const sapa = check('sapa', 'greetOnStartup', 'Sapaan saat Chrome dibuka',
    'Contoh: "NaraVisi aktif. Sisa kuota hari ini 10." Juga memberi tahu bila pintasan belum diatur.');
  const umumkan = check('umumkan', 'announceImages', 'Umumkan jumlah gambar saat halaman dibuka',
    'Contoh: "Ada 5 gambar." Gambar tidak dideskripsikan, jadi kuota tidak terpakai dan tidak ada yang dikirim ke server.');
  const otomatis = check('otomatis', 'autoDescribe', 'Baca berurutan: deskripsikan otomatis gambar tanpa teks alternatif',
    `Gambar diproses satu per satu dari atas ke bawah, yang terlihat lebih dulu, lalu lanjut saat Anda menggulir atau membaca. Deskripsi dimasukkan ke teks alternatif gambar, jadi NVDA atau JAWS membacanya saat menelusuri halaman (mis. tombol G). Mengirim gambar ke server dan Google Gemini serta memakai kuota; berhenti saat sisa kuota ${AUTO_RESERVE}.`);
  // [PF-05] Deteksi objek lokal — sakelar "Deskripsi kilat tanpa AI" (bawaan aktif; tidak mengirim apa pun ke server)
  const kilat = check('kilat', 'quickLocal', 'Deskripsi kilat tanpa AI',
    'Sambil menunggu AI, NaraVisi membacakan perkiraan isi gambar dari pendeteksi di komputer Anda, mis. "Kemungkinan berisi: 2 orang, 1 sepeda.", ditambah warna, tulisan, dan kode QR sesuai tiga pilihan di bawah. Bila server atau AI gagal, kuota habis, atau sedang offline, dibacakan "Deskripsi sederhana (tanpa AI)". Gratis, tidak memakai kuota, dan gambar tidak dikirim ke mana pun untuk ini.');
  // [PF-08] Warna dominan — sakelar "Sebutkan warna" (bagian lapis lokal; bawaan aktif)
  const warna = check('sebut-warna', 'sebutWarna', 'Sebutkan warna',
    'Menambahkan warna utama gambar, mis. "Warna dominan: biru dan putih." Dihitung di komputer Anda.');
  // [PF-06] Teks di gambar (OCR) — sakelar "Baca tulisan di gambar (offline)" (bawaan aktif)
  const tulisan = check('baca-tulisan', 'bacaTulisan', 'Baca tulisan di gambar (offline)',
    `Membaca tulisan pada poster atau tangkapan layar dengan pembaca teks di komputer Anda, mis. 'Tulisan: "Diskon akhir tahun".' Tidak dibacakan ulang bila deskripsi AI sudah memuat tulisannya.`);
  // [PF-07] Kode QR & barcode — sakelar "Baca kode QR" (bawaan aktif; tautan tidak pernah dibuka otomatis)
  const qr = check('baca-qr', 'bacaQr', 'Baca kode QR',
    'Menyebut ke mana kode QR mengarah, mis. "Ada kode QR menuju rri.co.id." Hanya nama situsnya yang dibacakan; tautan tidak pernah dibuka otomatis. Kode berisi skrip atau berkas dibacakan sebagai "kode QR berisi teks".');
  // [PF-09] Orientasi — sakelar "Sebutkan orientasi" (bawaan nonaktif agar bacaan ringkas)
  const orientasi = check('sebut-orientasi', 'sebutOrientasi', 'Sebutkan orientasi',
    'Menambahkan bentuk gambar, mis. "Gambar mendatar.", "Gambar tegak.", atau "Gambar persegi." Dihitung di komputer Anda.');
  const fokus = check('fokus', 'describeOnFocus', 'Deskripsikan saat gambar mendapat fokus keyboard',
    'Saat Tab berhenti di gambar, atau tautan yang isinya hanya gambar, tanpa teks alternatif.');

  const jumlah = el('select', { id: 'otomatis-jumlah', 'aria-describedby': 'otomatis-jumlah-hint' },
    Array.from({ length: AUTO_MAX_PER_PAGE }, (_, i) => el('option', { value: String(i + 1) }, `${i + 1} gambar`)));
  jumlah.value = String(stored.autoMax);

  const sites = el('textarea', { id: 'kecuali', rows: 7, spellcheck: 'false', 'aria-describedby': 'kecuali-hint' });
  sites.value = stored.autoExclude.join('\n');

  const save = async (patch, message) => {
    await chrome.storage.sync.set(patch);
    say(message, 'ok');
  };

  sapa.input.addEventListener('change', () =>
    save({ greetOnStartup: sapa.input.checked }, sapa.input.checked ? 'Sapaan saat Chrome dibuka diaktifkan.' : 'Sapaan saat Chrome dibuka dimatikan.'));
  umumkan.input.addEventListener('change', () =>
    save({ announceImages: umumkan.input.checked }, umumkan.input.checked ? 'Pengumuman jumlah gambar diaktifkan.' : 'Pengumuman jumlah gambar dimatikan.'));
  kilat.input.addEventListener('change', () =>
    save({ quickLocal: kilat.input.checked }, kilat.input.checked ? 'Deskripsi kilat tanpa AI diaktifkan.' : 'Deskripsi kilat tanpa AI dimatikan.'));
  for (const [{ input }, key, name] of [[warna, 'sebutWarna', 'Sebutkan warna'], [tulisan, 'bacaTulisan', 'Baca tulisan di gambar'], [qr, 'bacaQr', 'Baca kode QR'], [orientasi, 'sebutOrientasi', 'Sebutkan orientasi']]) {
    input.addEventListener('change', () => save({ [key]: input.checked }, `${name} ${input.checked ? 'diaktifkan' : 'dimatikan'}.`));
  }

  // Mengirim gambar ke server → hanya aktif setelah persetujuan.
  for (const [{ input }, key, name] of [[otomatis, 'autoDescribe', 'Baca berurutan'], [fokus, 'describeOnFocus', 'Deskripsi saat fokus']]) {
    input.addEventListener('change', async () => {
      if (!input.checked) return save({ [key]: false }, `${name} dimatikan.`);
      input.checked = false;
      const agreed = await askConsent();
      input.focus();
      if (!agreed) return say(`${name} tetap mati.`);
      input.checked = true;
      return save({ [key]: true }, `${name} diaktifkan.`);
    });
  }

  jumlah.addEventListener('change', () => save({ autoMax: Number(jumlah.value) }, `Maksimal ${jumlah.value} gambar per halaman.`));

  const saveSites = el('button', { type: 'button', id: 'simpan-kecuali' }, 'Simpan daftar situs');
  saveSites.addEventListener('click', async () => {
    const list = parseSites(sites.value);
    sites.value = list.join('\n');
    await save({ autoExclude: list }, `Daftar situs disimpan: ${list.length} situs dikecualikan.`);
  });
  const resetSites = el('button', { type: 'button' }, 'Kembalikan daftar bawaan');
  resetSites.addEventListener('click', async () => {
    sites.value = DEFAULT_AUTO_EXCLUDE.join('\n');
    await save({ autoExclude: [...DEFAULT_AUTO_EXCLUDE] }, 'Daftar situs bawaan dikembalikan.');
  });

  return el(
    'section',
    { class: 'card stack', id: 'otomatis-section', 'aria-labelledby': 'sec-otomatis' },
    el('h2', { id: 'sec-otomatis' }, 'Otomatis'),
    sapa.node,
    umumkan.node,
    kilat.node,
    el('div', { class: 'stack', role: 'group', 'aria-label': 'Lapis lokal (gratis, offline, tanpa kuota)' }, warna.node, tulisan.node, qr.node, orientasi.node),
    otomatis.node,
    field('otomatis-jumlah', 'Jumlah gambar per halaman (baca berurutan)', jumlah, `1 sampai ${AUTO_MAX_PER_PAGE} gambar. Diproses satu per satu setelah halaman tenang.`),
    fokus.node,
    field(
      'kecuali',
      'Situs yang tidak pernah diproses otomatis (satu per baris)',
      sites,
      'Bank, dompet digital, email, dan WhatsApp sudah termasuk. Halaman yang memiliki kolom kata sandi dan jendela Incognito selalu dilewati.',
    ),
    el('div', { class: 'row' }, saveSites, resetSites),
  );
}

// [PF-10] Florence-2 offline — "Deskripsi offline lengkap": unduh hanya setelah konfirmasi yang dibacakan (berisi ukuran)
const UKURAN_FLORENCE_MB = ukuranPaketMb('florence');
const TEKS_UNDUH_FLORENCE = `Model deskripsi offline Florence-2 beserta penerjemahnya, sekitar ${UKURAN_FLORENCE_MB} megabita, akan diunduh dari huggingface.co dan disimpan di komputer ini. Unduhan bisa memakan waktu beberapa menit dan memakai kuota internet. Gambar tetap tidak dikirim ke mana pun. Lanjutkan?`;

function teksStatusModel(st) {
  if (!st || !st.izin || st.status === 'mati') return 'Model offline: belum diunduh.';
  if (st.status === 'mengunduh') return `Model offline: mengunduh… ${st.persen ?? 0}%`;
  if (st.status === 'siap') return `Model offline: siap${st.perangkat ? ` (${st.perangkat === 'webgpu' ? 'WebGPU' : 'WASM'})` : ''}.`;
  return 'Model offline: unduhan gagal. Coba lagi.';
}

async function florenceControls() {
  const res = await chrome.runtime.sendMessage({ type: 'NV_MODEL_OFFLINE', aksi: 'status', paket: 'florence' }).catch(() => null);
  const st = res?.data;
  const input = el('input', { id: 'florence', type: 'checkbox', checked: Boolean(st?.izin), 'aria-describedby': 'florence-hint' });
  const status = el('p', { id: 'status-florence', role: 'status' }, teksStatusModel(st));
  const hapus = el('button', { type: 'button', id: 'hapus-florence' }, 'Hapus model offline');
  hapus.hidden = !st?.izin;
  const node = el('div', { class: 'stack' },
    el('label', { for: 'florence', class: 'check' }, input, 'Deskripsi offline lengkap (Florence-2)'),
    el('p', { class: 'hint', id: 'florence-hint' }, `Deskripsi gambar dan tulisannya tanpa internet, dipakai setelah AI bawaan Chrome. Perlu mengunduh model sekitar ${UKURAN_FLORENCE_MB} MB sekali saja; tidak diunduh sebelum Anda setuju.`),
    status, hapus);
  input.addEventListener('change', async () => {
    if (!input.checked) {
      input.checked = true; // mematikan = menghapus model; pakai tombol agar tidak terhapus tanpa sengaja
      hapus.focus();
      return say('Untuk mematikan, tekan "Hapus model offline".');
    }
    input.checked = false;
    const agreed = await askConsent(TEKS_UNDUH_FLORENCE, 'Unduh model deskripsi offline?', 'Ya, unduh');
    input.focus();
    if (!agreed) return say('Model offline tidak diunduh.');
    input.checked = true;
    hapus.hidden = false;
    say('Mengunduh model offline…');
    const r = await chrome.runtime.sendMessage({ type: 'NV_MODEL_OFFLINE', aksi: 'unduh', paket: 'florence' }).catch(() => null);
    say(r?.ok ? 'Model deskripsi offline siap dipakai.' : 'Unduhan model offline gagal.', r?.ok ? 'ok' : 'error');
    return undefined;
  });
  hapus.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'NV_MODEL_OFFLINE', aksi: 'hapus', paket: 'florence' }).catch(() => null);
    input.checked = false;
    hapus.hidden = true;
    input.focus();
    say('Model offline dihapus dari komputer ini.', 'ok');
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.modelOffline) status.textContent = teksStatusModel(changes.modelOffline.newValue?.florence);
  });
  return [node];
}

// [PF-11] Chrome Built-in AI — kartu "AI di perangkat": status AI bawaan Chrome (diperiksa, tidak pernah diunduh NaraVisi)
async function perangkatSection() {
  const status = el('p', { id: 'status-ai-bawaan', role: 'status' }, 'AI bawaan Chrome: memeriksa…');
  const card = el(
    'section',
    { class: 'card stack', id: 'perangkat-section', 'aria-labelledby': 'sec-perangkat' },
    el('h2', { id: 'sec-perangkat' }, 'AI di perangkat (cadangan offline)'),
    el('p', { class: 'hint' }, 'Dipakai hanya bila semua AI server gagal, sebelum deskripsi sederhana. Gambar tidak dikirim ke mana pun.'),
    status,
  );
  card.append(...(await florenceControls()));
  chrome.runtime.sendMessage({ type: 'NV_STATUS_AI_PERANGKAT' }).then((res) => {
    const a = res?.data?.aiBawaan;
    status.textContent = a?.tersedia ? 'AI bawaan Chrome: tersedia' : `AI bawaan Chrome: tidak tersedia${a?.alasan ? ` (${a.alasan})` : ''}`;
  }, () => { status.textContent = 'AI bawaan Chrome: tidak tersedia'; });
  return card;
}

function field(id, label, control, hint) {
  return el('div', { class: 'stack' }, el('label', { for: id }, label), control, hint ? el('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
}

// [RF-17] Halaman pengaturan — menampilkan pengaturan dari GET /settings
// [RF-18] Ubah bahasa & pintasan — bahasa deskripsi & pintasan aktif
// [RF-19] Ubah kecepatan, nada & suara — kecepatan (Gratis), nada & jenis suara (Premium)
async function render(settings) {
  const premium = settings.fitur_premium;
  // Pintasan yang benar-benar berlaku dibaca dari chrome.commands.getAll(), bukan dari teks tetap.
  const activeShortcut = (await currentShortcut()) || 'belum diatur';
  const noShortcut = activeShortcut === 'belum diatur';

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
  // aria-valuetext: NVDA membacakan "1,5 kali" alih-alih angka mentah saat panah kiri/kanan ditekan.
  const decimal = (v) => String(v).replace('.', ',');
  const rateOut = el('output', { for: 'kecepatan', id: 'kecepatan-out' }, `${settings.kecepatan_suara}×`);
  const kecepatan = el('input', {
    id: 'kecepatan', type: 'range', min: '0.5', max: '2', step: '0.1', value: settings.kecepatan_suara,
    'aria-valuetext': `${decimal(settings.kecepatan_suara)} kali`,
  });
  kecepatan.addEventListener('input', () => {
    rateOut.textContent = `${kecepatan.value}×`;
    kecepatan.setAttribute('aria-valuetext', `${decimal(kecepatan.value)} kali`);
  });

  const pitchOut = el('output', { for: 'nada', id: 'nada-out' }, `${settings.nada_suara}`);
  const nada = el('input', {
    id: 'nada', type: 'range', min: '0.5', max: '2', step: '0.1', value: settings.nada_suara,
    disabled: !premium, 'aria-describedby': premium ? null : 'nada-hint', 'aria-valuetext': `nada ${decimal(settings.nada_suara)}`,
  });
  nada.addEventListener('input', () => {
    pitchOut.textContent = nada.value;
    nada.setAttribute('aria-valuetext', `nada ${decimal(nada.value)}`);
  });

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
      // Halaman extension tidak boleh membuka chrome:// lewat href biasa → tautan dibuka dengan chrome.tabs.create.
      noShortcut
        ? el(
            'p',
            { class: 'notice', id: 'no-shortcut' },
            'Pintasan belum diatur. Atur di ',
            el('a', { href: SHORTCUTS_URL, id: 'shortcuts-link', onclick: (e) => { e.preventDefault(); openShortcutsPage(); } }, SHORTCUTS_URL),
            '.',
          )
        : null,
      el('div', { class: 'row' }, el('button', { type: 'button', id: 'open-shortcuts', onclick: () => openShortcutsPage() }, 'Buka halaman pintasan Chrome')),
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

  // [RF-18] Ubah bahasa & pintasan — simpan bahasa & pintasan lewat PUT /settings
  // [RF-19] Ubah kecepatan, nada & suara — simpan kecepatan, nada & suara lewat PUT /settings
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

  $('content').replaceChildren(form, await autoSection(), await perangkatSection());
  if (noShortcut && location.hash !== '#pintasan') speakGuide(`Pintasan belum diatur. Atur di halaman pintasan Chrome, ${SHORTCUTS_URL}.`);
  if (location.hash === '#pintasan') {
    // Dibuka saat Chrome dimulai dan pintasan belum diatur.
    $('open-shortcuts').focus();
    say('Pintasan NaraVisi belum diatur. Tekan tombol "Buka halaman pintasan Chrome" untuk mengaturnya.');
  }
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
