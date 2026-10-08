// Content script NaraVisi — memindai gambar, menampilkan panel aksesibel,
// dan membacakan deskripsi dengan Web Speech API.
// Disuntik sesuai permintaan (Alt+Shift+N / popup); aman bila disuntik berulang.

(() => {
  if (window.__naraVisiLoaded) return;
  window.__naraVisiLoaded = true;

  const MIN_NATURAL_SIDE = 48; // abaikan ikon kecil
  const MIN_RENDERED_SIDE = 24;
  const HOST_ID = 'naravisi-host';
  const MARK_ATTR = 'data-naravisi-mark';

  const state = {
    open: false,
    images: [],
    index: 0,
    busy: false,
    lang: 'id',
    lastText: '',
    paused: false,
    cache: new Map(),
    host: null,
    root: null,
    markStyle: null,
    lastFocus: null,
    tts: null, // pengaturan suara dari server (UC-AKS-03)
    loggedIn: true,
  };

  // -------------------------------------------------------------------------
  // Pesan dari background
  // -------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'NV_TOGGLE') {
      if (state.open) closePanel();
      else openPanel();
      sendResponse({ open: state.open, count: state.images.length });
    }
  });

  // -------------------------------------------------------------------------
  // UC-GBR-01 Memindai gambar
  // -------------------------------------------------------------------------
  function isVisible(el, rect) {
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }

  function scanImages() {
    const seen = new Set();
    const found = [];
    for (const el of document.querySelectorAll('img, input[type="image"]')) {
      if (el.closest(`#${HOST_ID}`)) continue;
      const raw = el.currentSrc || el.src || el.getAttribute('data-src') || '';
      if (!raw || raw.startsWith('javascript:')) continue;

      let src;
      try {
        src = new URL(raw, document.baseURI).href;
      } catch {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (!isVisible(el, rect)) continue;
      const naturalW = el.naturalWidth || rect.width;
      const naturalH = el.naturalHeight || rect.height;
      if (Math.min(naturalW, naturalH) < MIN_NATURAL_SIDE) continue;
      if (Math.min(rect.width, rect.height) < MIN_RENDERED_SIDE) continue;
      if (seen.has(src)) continue;
      seen.add(src);

      found.push({
        el,
        src,
        alt: (el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
    return found;
  }

  function markImages() {
    state.markStyle = document.createElement('style');
    state.markStyle.textContent = `
      [${MARK_ATTR}] { outline: 3px dashed #ffb000 !important; outline-offset: 2px !important; }
      [${MARK_ATTR}="active"] { outline: 4px solid #0b57d0 !important; outline-offset: 3px !important; }
    `;
    document.documentElement.appendChild(state.markStyle);
    state.images.forEach((img) => img.el.setAttribute(MARK_ATTR, ''));
  }

  function unmarkImages() {
    state.images.forEach((img) => img.el.removeAttribute(MARK_ATTR));
    state.markStyle?.remove();
    state.markStyle = null;
  }

  // -------------------------------------------------------------------------
  // Panel (UC-GBR-02 Melihat daftar gambar, UC-GBR-03 Memilih gambar)
  // -------------------------------------------------------------------------
  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      width: min(380px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 32px));
      display: flex; flex-direction: column;
      background: #ffffff; color: #111111; border: 2px solid #111111; border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.35);
      font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 14px; border-bottom: 1px solid #d0d0d0; }
    h2 { margin: 0; font-size: 18px; }
    h3 { margin: 0 0 4px; font-size: 15px; }
    .status { margin: 0; padding: 8px 14px; background: #f3f6fb; font-size: 15px; }
    .status[data-tone="error"] { background: #fdecea; color: #8a1c13; }
    ul { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1 1 auto; min-height: 60px; }
    ul:focus { outline: 3px solid #0b57d0; outline-offset: -3px; }
    li { padding: 8px 10px; border-radius: 8px; cursor: pointer; border: 2px solid transparent; }
    li[aria-selected="true"] { background: #e8f0fe; border-color: #0b57d0; }
    li .meta { display: block; font-size: 13px; color: #444; }
    .result { padding: 10px 14px; border-top: 1px solid #d0d0d0; }
    .result[hidden] { display: none; }
    .text { margin: 0 0 8px; font-size: 16px; }
    .text:focus { outline: 3px solid #0b57d0; outline-offset: 2px; }
    .controls { display: flex; flex-wrap: wrap; gap: 6px; }
    button { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px;
      border: 2px solid #111; background: #fff; color: #111; cursor: pointer; }
    button:hover { background: #f0f0f0; }
    button:focus-visible { outline: 3px solid #0b57d0; outline-offset: 2px; }
    .close { padding: 2px 10px; font-size: 18px; line-height: 1; }
    .action { margin: 0 14px 8px; }
    .action[hidden], .report[hidden] { display: none; }
    .report { display: grid; gap: 6px; margin-top: 10px; }
    .report label { font-weight: 600; font-size: 14px; }
    .report textarea { font: inherit; font-size: 14px; padding: 6px 8px; border: 2px solid #555; border-radius: 8px; resize: vertical; }
    .report textarea:focus-visible { outline: 3px solid #0b57d0; outline-offset: 2px; }
    .help { margin: 0; padding: 8px 14px; font-size: 12.5px; color: #333; border-top: 1px solid #d0d0d0; }
    kbd { font: 12px ui-monospace, monospace; border: 1px solid #999; border-radius: 4px; padding: 0 4px; }
    @media (forced-colors: active) {
      li[aria-selected="true"] { outline: 2px solid Highlight; }
    }
  `;

  function buildPanel() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.dataset.tts = 'idle';
    host.dataset.state = 'idle';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${PANEL_CSS}</style>
      <div class="panel" role="dialog" aria-modal="false" aria-labelledby="nv-title">
        <header>
          <h2 id="nv-title">NaraVisi</h2>
          <button type="button" class="close" data-act="close" aria-label="Tutup NaraVisi">×</button>
        </header>
        <p class="status" id="nv-status" role="status" aria-live="polite"></p>
        <button type="button" class="action" id="nv-action" hidden></button>
        <ul id="nv-list" role="listbox" tabindex="0" aria-label="Daftar gambar pada halaman"></ul>
        <section class="result" id="nv-result" aria-labelledby="nv-result-title" hidden>
          <h3 id="nv-result-title">Deskripsi gambar</h3>
          <p class="text" id="nv-text" tabindex="-1"></p>
          <div class="controls" role="group" aria-label="Kontrol suara">
            <button type="button" data-act="play">Putar</button>
            <button type="button" data-act="pause">Jeda</button>
            <button type="button" data-act="repeat">Ulang</button>
            <button type="button" data-act="stop">Berhenti</button>
            <button type="button" data-act="report">Laporkan</button>
          </div>
          <form class="report" id="nv-report" hidden>
            <label for="nv-reason">Apa yang tidak akurat dari deskripsi ini?</label>
            <textarea id="nv-reason" rows="3" maxlength="1000"></textarea>
            <div class="controls">
              <button type="submit">Kirim laporan</button>
              <button type="button" data-act="report-cancel">Batal</button>
            </div>
          </form>
        </section>
        <p class="help">
          <kbd>↑</kbd>/<kbd>↓</kbd> pilih · <kbd>Enter</kbd> deskripsikan · <kbd>Spasi</kbd> jeda/lanjut ·
          <kbd>R</kbd> ulang · <kbd>S</kbd> berhenti · <kbd>L</kbd> laporkan · <kbd>Esc</kbd> tutup
        </p>
      </div>`;

    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onReportSubmit);
    return { host, root };
  }

  const $ = (sel) => state.root.querySelector(sel);

  function setStatus(message, tone = 'info') {
    const el = $('#nv-status');
    el.dataset.tone = tone;
    // Kosongkan dulu agar pembaca layar mengumumkan ulang pesan yang sama.
    el.textContent = '';
    requestAnimationFrame(() => {
      el.textContent = message;
    });
  }

  // Tombol tindakan kontekstual di bawah status (mis. "Masuk", "Lihat Premium").
  function setAction(label, page) {
    const btn = $('#nv-action');
    if (!label) {
      btn.hidden = true;
      btn.dataset.page = '';
      return;
    }
    btn.textContent = label;
    btn.dataset.page = page;
    btn.hidden = false;
  }

  function describeItemLabel(item, i) {
    const alt = item.alt ? `Teks alternatif: “${item.alt}”` : 'Tanpa teks alternatif';
    return { title: `Gambar ${i + 1} dari ${state.images.length}`, meta: `${alt} · ${item.width}×${item.height} px` };
  }

  function renderList() {
    const list = $('#nv-list');
    list.textContent = '';
    state.images.forEach((item, i) => {
      const li = document.createElement('li');
      const label = describeItemLabel(item, i);
      li.id = `nv-opt-${i}`;
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      li.innerHTML = '<span class="title"></span><span class="meta"></span>';
      li.querySelector('.title').textContent = label.title;
      li.querySelector('.meta').textContent = label.meta;
      list.appendChild(li);
    });
    list.hidden = state.images.length === 0;
  }

  function select(index, { scroll = true } = {}) {
    if (!state.images.length) return;
    state.index = (index + state.images.length) % state.images.length;
    const list = $('#nv-list');
    list.querySelectorAll('[role="option"]').forEach((li, i) => {
      li.setAttribute('aria-selected', String(i === state.index));
    });
    list.setAttribute('aria-activedescendant', `nv-opt-${state.index}`);
    $(`#nv-opt-${state.index}`)?.scrollIntoView({ block: 'nearest' });

    state.images.forEach((img, i) => img.el.setAttribute(MARK_ATTR, i === state.index ? 'active' : ''));
    const current = state.images[state.index];
    if (scroll && current.el.isConnected) {
      current.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
  }

  function openPanel() {
    state.images = scanImages();
    const { host, root } = buildPanel();
    state.host = host;
    state.root = root;
    state.index = 0;
    state.lastFocus = document.activeElement;
    document.documentElement.appendChild(host);
    state.open = true;

    renderList();
    markImages();
    loadTts();

    const n = state.images.length;
    if (n === 0) {
      setStatus('Tidak ada gambar yang dapat dideskripsikan pada halaman ini.');
      $('[data-act="close"]').focus();
      return;
    }
    select(0, { scroll: n === 1 });
    $('#nv-list').focus();
    setStatus(
      n === 1
        ? '1 gambar ditemukan dan sudah dipilih. Tekan Enter untuk mendeskripsikan.'
        : `${n} gambar ditemukan. Gunakan panah atas dan bawah untuk memilih, lalu Enter untuk mendeskripsikan.`,
    );
  }

  async function loadTts() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'NV_GET_TTS' });
      if (res?.ok) {
        state.tts = res.data;
        state.lang = res.data.bahasa_deskripsi || state.lang;
        state.loggedIn = res.loggedIn;
        if (!res.loggedIn && state.open) setAction('Masuk atau daftar NaraVisi', 'profil');
      }
    } catch {
      // extension diperbarui — ditangani saat mendeskripsikan
    }
  }

  function closePanel() {
    stopSpeech();
    unmarkImages();
    state.host?.remove();
    state.host = null;
    state.root = null;
    state.open = false;
    state.images = [];
    state.lastText = '';
    state.current = null;
    if (state.lastFocus && typeof state.lastFocus.focus === 'function' && state.lastFocus.isConnected) {
      state.lastFocus.focus();
    }
  }

  // -------------------------------------------------------------------------
  // UC-GBR-04..06 Mengirim gambar & menampilkan deskripsi
  // -------------------------------------------------------------------------
  async function blobUrlToDataUrl(url) {
    const blob = await (await fetch(url)).blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function friendlyError(err) {
    const msg = String(err?.message || '');
    if (msg.includes('Extension context invalidated')) {
      return 'NaraVisi baru saja diperbarui. Muat ulang halaman ini lalu coba lagi.';
    }
    return msg || 'Terjadi kesalahan saat mendeskripsikan gambar.';
  }

  function showResult(text) {
    $('#nv-result').hidden = false;
    $('#nv-text').textContent = text;
  }

  async function describeCurrent() {
    const item = state.images[state.index];
    if (!item || state.busy) return;
    const number = state.index + 1;

    const cached = state.cache.get(item.src);
    if (cached) {
      state.current = cached;
      showResult(cached.text);
      setStatus(`Deskripsi gambar ${number}.`);
      speak(cached.text);
      return;
    }

    state.busy = true;
    state.host.dataset.state = 'loading';
    stopSpeech();
    setStatus(`Mendeskripsikan gambar ${number}… mohon tunggu.`);

    try {
      const dataUrl = item.src.startsWith('blob:') ? await blobUrlToDataUrl(item.src) : null;
      const res = await chrome.runtime.sendMessage({
        type: 'NV_DESCRIBE',
        src: item.src,
        dataUrl,
        pageUrl: location.href,
      });
      if (!res?.ok) {
        const e = new Error(res?.message || 'Server gagal memproses gambar.');
        e.code = res?.code;
        throw e;
      }
      if (!state.open) return; // panel ditutup saat menunggu

      const { text, riwayat_id: riwayatId, kuota } = res.data;
      state.lang = res.data.lang || state.lang;
      state.current = { text, riwayatId };
      state.cache.set(item.src, state.current);
      showResult(text);
      state.host.dataset.state = 'done';
      setAction(null);
      const sisa = kuota && kuota.batas != null ? ` Sisa kuota hari ini: ${kuota.sisa}.` : '';
      setStatus(`Deskripsi gambar ${number} siap.${sisa}`);
      speak(text);
    } catch (err) {
      if (!state.open) return;
      const message = friendlyError(err);
      state.host.dataset.state = 'error';
      setStatus(message, 'error');
      if (err.code === 'QUOTA_EXCEEDED') setAction('Lihat paket Premium', 'premium');
      else if (['NOT_LOGGED_IN', 'UNAUTHORIZED', 'SESSION_EXPIRED'].includes(err.code)) setAction('Masuk atau daftar NaraVisi', 'profil');
      speak(message);
    } finally {
      state.busy = false;
    }
  }

  // -------------------------------------------------------------------------
  // UC-GBR-07 Membacakan deskripsi (Web Speech API)
  // -------------------------------------------------------------------------
  function setTts(value) {
    if (state.host) state.host.dataset.tts = value;
  }

  function pickVoice(langTag) {
    const voices = window.speechSynthesis.getVoices();
    const base = langTag.split('-')[0];
    return (
      voices.find((v) => v.lang === langTag) ||
      voices.find((v) => v.lang?.toLowerCase().startsWith(base)) ||
      null
    );
  }

  function speak(text) {
    state.lastText = text;
    state.paused = false;
    if (state.host) state.host.dataset.lastSpoken = text; // dipakai uji otomatis
    if (!('speechSynthesis' in window)) {
      setTts('unsupported');
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = state.lang === 'en' ? 'en-US' : 'id-ID';
    const chosen = state.tts?.jenis_suara
      ? synth.getVoices().find((v) => v.name === state.tts.jenis_suara)
      : null;
    const voice = chosen || pickVoice(utter.lang);
    if (voice) utter.voice = voice;
    utter.rate = Number(state.tts?.kecepatan_suara) || 1;
    utter.pitch = Number(state.tts?.nada_suara) || 1;
    utter.onstart = () => setTts('speaking');
    utter.onend = () => setTts('idle');
    utter.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') setTts('error');
    };
    setTts('queued');
    synth.speak(utter);
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    state.paused = false;
    setTts('idle');
  }

  function togglePause() {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    if (state.paused) {
      synth.resume();
      state.paused = false;
      setTts('speaking');
    } else if (synth.speaking) {
      synth.pause();
      state.paused = true;
      setTts('paused');
    } else if (state.lastText) {
      speak(state.lastText);
    }
  }

  function play() {
    if (state.paused) togglePause();
    else if (state.lastText) speak(state.lastText);
  }

  // -------------------------------------------------------------------------
  // Interaksi keyboard & mouse (RNF-03)
  // -------------------------------------------------------------------------
  // UC-LAP-01 Menambahkan laporan deskripsi tidak akurat
  function openReport() {
    if (!state.current?.riwayatId) {
      setStatus('Deskripsikan sebuah gambar terlebih dahulu sebelum melaporkan.', 'error');
      return;
    }
    const form = $('#nv-report');
    form.hidden = false;
    $('#nv-reason').value = '';
    $('#nv-reason').focus();
  }

  function closeReport() {
    $('#nv-report').hidden = true;
    $('#nv-list').focus();
  }

  async function onReportSubmit(event) {
    if (event.target.id !== 'nv-report') return;
    event.preventDefault();
    const alasan = $('#nv-reason').value.trim();
    if (!alasan) {
      setStatus('Alasan pelaporan wajib diisi sebelum laporan dikirim.', 'error');
      $('#nv-reason').focus();
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: 'NV_REPORT', riwayatId: state.current.riwayatId, alasan });
      if (!res?.ok) throw new Error(res?.message || 'Laporan gagal dikirim.');
      $('#nv-report').hidden = true;
      setStatus('Terima kasih. Laporan Anda sudah dikirim dan akan ditinjau Admin.');
      $('#nv-list').focus();
    } catch (err) {
      setStatus(friendlyError(err), 'error');
    }
  }

  function runAction(action) {
    switch (action) {
      case 'close': return closePanel();
      case 'play': return play();
      case 'pause': return togglePause();
      case 'repeat': return state.lastText && speak(state.lastText);
      case 'stop': return stopSpeech();
      case 'report': return openReport();
      case 'report-cancel': return closeReport();
      default: return undefined;
    }
  }

  function onClick(event) {
    const actionBtn = event.target.closest('#nv-action');
    if (actionBtn) {
      chrome.runtime.sendMessage({ type: 'NV_OPEN_PAGE', page: actionBtn.dataset.page });
      return;
    }
    const button = event.target.closest('button[data-act]');
    if (button) {
      runAction(button.dataset.act);
      return;
    }
    const option = event.target.closest('[role="option"]');
    if (option) {
      select(Number(option.dataset.index));
      describeCurrent();
    }
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = event.target?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeReport();
      }
      event.stopPropagation(); // jangan biarkan pintasan situs menangkap ketikan
      return;
    }
    const onButton = tag === 'BUTTON';
    let handled = true;

    switch (event.key) {
      case 'ArrowDown': select(state.index + 1); break;
      case 'ArrowUp': select(state.index - 1); break;
      case 'Home': select(0); break;
      case 'End': select(state.images.length - 1); break;
      case 'Enter':
        if (onButton) handled = false;
        else describeCurrent();
        break;
      case ' ':
        if (onButton) handled = false;
        else togglePause();
        break;
      case 'r': case 'R': runAction('repeat'); break;
      case 's': case 'S': runAction('stop'); break;
      case 'l': case 'L': runAction('report'); break;
      case 'Escape': closePanel(); break;
      default: handled = false;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  // Muat daftar suara lebih awal (Chrome memuatnya secara asinkron).
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
})();
