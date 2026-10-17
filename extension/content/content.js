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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return; // hanya dari service worker NaraVisi sendiri
    if (message?.type === 'NV_TOGGLE') {
      if (state.open) closePanel();
      else openPanel();
      sendResponse({ open: state.open, count: state.images.length });
    } else if (message?.type === 'NV_COUNT') {
      // Pengumuman saat halaman dibuka: hanya menghitung, tidak menandai atau mengirim apa pun.
      sendResponse({ count: scanImages().length });
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

  function toAbsolute(raw) {
    if (!raw || raw.startsWith('javascript:')) return null;
    try {
      return new URL(raw, document.baseURI).href;
    } catch {
      return null;
    }
  }

  const altOf = (el) =>
    (el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();

  // Ikon dekoratif yang sengaja disembunyikan situs dari pembaca layar.
  const isDecorative = (el) =>
    el.getAttribute('aria-hidden') === 'true' || ['presentation', 'none'].includes(el.getAttribute('role'));

  /** Gambar latar CSS pertama yang berupa url(...) — gradien diabaikan. */
  function backgroundUrl(style) {
    const bg = style.backgroundImage;
    if (!bg || bg === 'none') return null;
    const match = bg.match(/url\(\s*(['"]?)(.*?)\1\s*\)/);
    return match ? toAbsolute(match[2]) : null;
  }

  // Kunci tetap per elemen <svg>, juga saat panel dibuka ulang.
  const svgKeys = new WeakMap();
  let svgCounter = 0;
  function inlineSvgKey(el) {
    if (!svgKeys.has(el)) svgKeys.set(el, `inline-svg:${++svgCounter}`);
    return svgKeys.get(el);
  }

  function scanImages() {
    const seen = new Set();
    const found = [];
    const add = (item) => {
      if (seen.has(item.src)) return;
      seen.add(item.src);
      found.push(item);
    };

    // Satu kali jalan dalam urutan dokumen agar nomor gambar mengikuti urutan baca halaman.
    for (const el of document.body?.querySelectorAll('*') ?? []) {
      if (el.id === HOST_ID || el.closest(`#${HOST_ID}`)) continue;
      const tag = el.localName;

      if (tag === 'img' || (tag === 'input' && el.type === 'image')) {
        const src = toAbsolute(el.currentSrc || el.src || el.getAttribute('data-src') || '');
        if (!src) continue;
        const rect = el.getBoundingClientRect();
        if (!isVisible(el, rect)) continue;
        const naturalW = el.naturalWidth || rect.width;
        const naturalH = el.naturalHeight || rect.height;
        if (Math.min(naturalW, naturalH) < MIN_NATURAL_SIDE) continue;
        if (Math.min(rect.width, rect.height) < MIN_RENDERED_SIDE) continue;
        const kind = /\.svg(?:[?#]|$)/i.test(src) || src.startsWith('data:image/svg') ? 'svg' : 'img';
        add({ el, src, kind, alt: altOf(el), width: Math.round(rect.width), height: Math.round(rect.height) });
        continue;
      }

      if (tag === 'svg') {
        if (el.parentElement?.closest('svg') || isDecorative(el)) continue;
        const rect = el.getBoundingClientRect();
        if (!isVisible(el, rect) || Math.min(rect.width, rect.height) < MIN_NATURAL_SIDE) continue;
        const title = el.querySelector(':scope > title')?.textContent?.trim() || '';
        add({
          el,
          src: inlineSvgKey(el), // kunci cache; isi SVG diambil saat dideskripsikan
          kind: 'inline-svg',
          alt: altOf(el) || title,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
        continue;
      }

      if (el.closest('svg')) continue; // elemen di dalam SVG bukan gambar latar
      const style = getComputedStyle(el);
      const src = backgroundUrl(style);
      if (!src || isDecorative(el)) continue;
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, rect)) continue;
      // Gambar latar tidak punya ukuran asli yang mudah dibaca; sprite ikon biasanya kecil.
      if (Math.min(rect.width, rect.height) < MIN_NATURAL_SIDE) continue;
      add({
        el,
        src,
        kind: 'background',
        alt: (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // SVG inline → data URL. Gaya dari CSS halaman (fill, stroke, ...) disalin ke atribut
  // style agar gambar tetap berwarna setelah dilepas dari halaman.
  // -------------------------------------------------------------------------
  const SVG_STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'opacity',
    'font-family', 'font-size', 'font-weight', 'display', 'visibility'];
  const MAX_SVG_NODES = 3000;

  function inlineSvgToDataUrl(svg) {
    const clone = svg.cloneNode(true);
    const originals = [svg, ...svg.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    if (originals.length <= MAX_SVG_NODES) {
      originals.forEach((orig, i) => {
        const computed = getComputedStyle(orig);
        const css = SVG_STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(';');
        copies[i].setAttribute('style', `${copies[i].getAttribute('style') || ''};${css}`);
      });
    }
    const rect = svg.getBoundingClientRect();
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(Math.round(rect.width)));
    clone.setAttribute('height', String(Math.round(rect.height)));
    // <use href="#id"> yang menunjuk sprite di luar elemen ini: salin definisinya ke dalam klon.
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    clone.insertBefore(defs, clone.firstChild); // dipasang dulu agar sprite yang sama tidak disalin dua kali
    for (const use of clone.querySelectorAll('use')) {
      const ref = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      if (!ref.startsWith('#') || clone.querySelector(`#${CSS.escape(ref.slice(1))}`)) continue;
      const target = document.getElementById(ref.slice(1));
      if (target) defs.appendChild(target.cloneNode(true));
    }
    if (!defs.childNodes.length) defs.remove();
    const xml = new XMLSerializer().serializeToString(clone);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  }

  function markImages() {
    state.markStyle = document.createElement('style');
    state.markStyle.textContent = `
      [${MARK_ATTR}] { outline: 3px dashed #E8A33D !important; outline-offset: 2px !important; }
      [${MARK_ATTR}="active"] { outline: 4px solid #14213D !important; outline-offset: 3px !important;
        box-shadow: 0 0 0 3px #E8A33D !important; }
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
  // Salinan token warna dari shared/tokens.css (Shadow DOM tidak bisa memuat berkas extension
  // tanpa web_accessible_resources, yang akan membuat situs bisa mendeteksi NaraVisi).
  // e2e/run.mjs memastikan nilai di sini sama dengan tokens.css.
  const PANEL_CSS = `
    :host { all: initial; }
    [hidden] { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    .panel {
      --nv-paper: #F7F3EA;
      --nv-surface: #FFFDF8;
      --nv-tint: #FBEBD0;
      --nv-ink: #14213D;
      --nv-ink-muted: #5A5446;
      --nv-on-ink: #F7F3EA;
      --nv-line: #E2D9C6;
      --nv-field: #6E6553;
      --nv-marigold: #E8A33D;
      --nv-focus-inner: #14213D;
      --nv-error: #A63D2F;
      --nv-error-bg: #F8E3DE;
      --nv-ok: #2F6B3F;
      --nv-ok-bg: #E2EEDF;
      --nv-motion: 120ms;
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      width: min(400px, calc(100vw - 32px)); max-height: min(600px, calc(100vh - 32px));
      display: flex; flex-direction: column;
      background: var(--nv-paper); color: var(--nv-ink);
      border: 2px solid var(--nv-ink); border-radius: 14px;
      box-shadow: 0 6px 20px rgba(20, 33, 61, .22);
      font: 16px/1.5 "NaraVisi Atkinson", system-ui, -apple-system, "Segoe UI", sans-serif;
      text-align: left;
    }
    @media (prefers-color-scheme: dark) {
      .panel {
        --nv-paper: #111A2C;
        --nv-surface: #1A2438;
        --nv-tint: #2A3550;
        --nv-ink: #F2ECDD;
        --nv-ink-muted: #BDB5A3;
        --nv-on-ink: #14213D;
        --nv-line: #2E3A55;
        --nv-field: #8C93A6;
        --nv-marigold: #E8A33D;
        --nv-focus-inner: #111A2C;
        --nv-error: #F08A78;
        --nv-error-bg: #3A2224;
        --nv-ok: #7CC48F;
        --nv-ok-bg: #1E3327;
        box-shadow: 0 6px 20px rgba(0, 0, 0, .5);
      }
    }
    @media (prefers-reduced-motion: reduce) { .panel { --nv-motion: 0ms; } }

    :focus-visible { outline: 3px solid var(--nv-marigold); outline-offset: 2px; box-shadow: 0 0 0 2px var(--nv-focus-inner); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--nv-line); }
    .brand { display: flex; align-items: center; gap: 8px; }
    .brand svg { flex: none; }
    h2 { margin: 0; font-size: 18px; font-weight: 700; line-height: 1.25; }
    h3 { margin: 0 0 4px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--nv-ink-muted); }
    .status { margin: 0; padding: 10px 14px; background: var(--nv-surface); border-bottom: 1px solid var(--nv-line); font-size: 15px; }
    .status:empty { display: none; }
    .status[data-tone="error"] { background: var(--nv-error-bg); color: var(--nv-error); font-weight: 700; }
    ul { list-style: none; margin: 0; padding: 8px; overflow-y: auto; flex: 1 1 auto; min-height: 60px; display: grid; gap: 4px; align-content: start; }
    ul:focus { outline: 3px solid var(--nv-marigold); outline-offset: -3px; box-shadow: inset 0 0 0 5px var(--nv-focus-inner); }
    li { padding: 8px 12px; border-radius: 10px; cursor: pointer; border: 2px solid transparent; }
    li:hover { background: var(--nv-surface); }
    li[aria-selected="true"] { background: var(--nv-tint); border-color: var(--nv-ink); box-shadow: inset 4px 0 0 var(--nv-marigold); }
    li .title { display: block; font-weight: 700; }
    li .meta { display: block; font-size: 13px; color: var(--nv-ink-muted); }
    .result { padding: 12px 14px; border-top: 1px solid var(--nv-line); background: var(--nv-surface); }
    .text { margin: 0 0 10px; font-size: 17px; }
    .controls { display: flex; flex-wrap: wrap; gap: 6px; }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 44px; min-width: 44px; padding: 6px 14px; border-radius: 10px;
      border: 2px solid var(--nv-ink); background: var(--nv-surface); color: var(--nv-ink);
      font: inherit; font-size: 15px; font-weight: 700; cursor: pointer;
      transition: background-color var(--nv-motion) ease-out; }
    button:hover { background: var(--nv-tint); }
    button[type="submit"], .action { background: var(--nv-ink); color: var(--nv-on-ink); }
    button[type="submit"]:hover, .action:hover { background: var(--nv-ink); text-decoration: underline; text-decoration-color: var(--nv-marigold); }
    .close { width: 44px; height: 44px; padding: 0; border-color: transparent; background: transparent; }
    .close svg { width: 22px; height: 22px; }
    .action { margin: 10px 14px 4px; }
    .report { display: grid; gap: 6px; margin-top: 12px; }
    .report label { font-weight: 700; font-size: 15px; }
    .report textarea { font: inherit; font-size: 15px; min-height: 88px; padding: 8px 10px; color: var(--nv-ink);
      background: var(--nv-paper); border: 2px solid var(--nv-field); border-radius: 10px; resize: vertical; }
    .help { margin: 0; padding: 8px 14px; font-size: 13px; line-height: 1.7; color: var(--nv-ink-muted); border-top: 1px solid var(--nv-line); }
    kbd { font: 12px ui-monospace, Consolas, monospace; color: var(--nv-ink); border: 1px solid currentColor; border-bottom-width: 2px; border-radius: 5px; padding: 0 4px; }
    @media (forced-colors: active) {
      li[aria-selected="true"] { outline: 2px solid Highlight; }
      :focus-visible { outline-color: Highlight; box-shadow: none; }
    }
  `;

  // Logo & ikon tutup: SVG statis milik extension sendiri (tidak ada data halaman di dalamnya).
  const LOGO_SVG = `<svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" focusable="false">
    <path d="M4 24C11 13 37 13 44 24C37 35 11 35 4 24Z" fill="#E8A33D" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
    <path d="M16 23v2M20 21v6M24 18.5v11M28 21v6M32 23v2" fill="none" stroke="#14213D" stroke-width="2.75" stroke-linecap="round"/></svg>`;
  const CLOSE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
    stroke-width="2.25" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

  // Atkinson Hyperlegible: byte font diminta dari service worker lalu dipasang dengan FontFace,
  // jadi berkas font tidak perlu dibuka untuk situs. Gagal → panel memakai huruf sistem.
  let fontRequested = false;
  async function loadPanelFont() {
    if (fontRequested || !('fonts' in document)) return;
    fontRequested = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'NV_FONTS' });
      for (const { weight, base64 } of res?.data ?? []) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const face = new FontFace('NaraVisi Atkinson', bytes, { weight: String(weight) });
        document.fonts.add(await face.load());
      }
    } catch {
      // huruf sistem tetap terbaca
    }
  }

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
          <div class="brand">${LOGO_SVG}<h2 id="nv-title">NaraVisi</h2></div>
          <button type="button" class="close" data-act="close" aria-label="Tutup NaraVisi">${CLOSE_SVG}</button>
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

  const KIND_LABEL = { svg: 'Gambar vektor', 'inline-svg': 'Gambar vektor', background: 'Gambar latar' };

  function describeItemLabel(item, i) {
    const alt = item.alt ? `Teks alternatif: “${item.alt}”` : 'Tanpa teks alternatif';
    const kind = KIND_LABEL[item.kind] ? `${KIND_LABEL[item.kind]} · ` : '';
    return { title: `Gambar ${i + 1} dari ${state.images.length}`, meta: `${kind}${alt} · ${item.width}×${item.height} px` };
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
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      current.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
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
    loadPanelFont();

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
        if (!res.loggedIn && state.open) setAction('Masuk atau daftar NaraVisi', 'masuk');
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
      let dataUrl = null;
      if (item.kind === 'inline-svg') dataUrl = inlineSvgToDataUrl(item.el);
      else if (item.src.startsWith('blob:')) dataUrl = await blobUrlToDataUrl(item.src);
      const res = await chrome.runtime.sendMessage({
        type: 'NV_DESCRIBE',
        src: item.kind === 'inline-svg' ? null : item.src,
        dataUrl,
        pageUrl: location.href,
      });
      if (!res?.ok) {
        const e = new Error(res?.message || 'Server gagal memproses gambar.');
        e.code = res?.code;
        e.spoken = res?.spoken;
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
      else if (['NOT_LOGGED_IN', 'UNAUTHORIZED', 'SESSION_EXPIRED'].includes(err.code)) setAction('Masuk atau daftar NaraVisi', 'masuk');
      if (!err.spoken) speak(message); // sudah dibacakan service worker → jangan dobel
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
