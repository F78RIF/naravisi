// Kerangka bersama halaman extension: navigasi, pesan status, sesi, dan TTS.
import { apiFetch, getSession, getTts, startSession } from '../shared/config.js';
import { logo } from '../shared/icons.js';

export const $ = (id) => document.getElementById(id);

const NAV = [
  ['riwayat', 'Riwayat'],
  ['pengaturan', 'Pengaturan'],
  ['premium', 'Premium'],
  ['profil', 'Profil'],
];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Membuat header + navigasi + area pesan. `current` = nama halaman ini. */
export function shell(current, title) {
  document.title = `${title} — NaraVisi`;
  const header = el(
    'header',
    { class: 'site' },
    el(
      'div',
      { class: 'inner' },
      el('p', { class: 'brand' }, logo(32), el('span', { class: 'brand-name' }, 'NaraVisi')),
      el(
        'nav',
        { 'aria-label': 'Menu NaraVisi' },
        el(
          'ul',
          {},
          NAV.map(([page, label]) =>
            el('li', {}, el('a', { href: `${page}.html`, 'aria-current': page === current ? 'page' : null }, label)),
          ),
        ),
      ),
    ),
  );
  document.body.prepend(el('a', { class: 'skip', href: '#main' }, 'Lewati ke konten utama'), header);
  const main = $('main');
  main.prepend(el('h1', {}, title), el('p', { id: 'msg', class: 'message', role: 'status', 'aria-live': 'polite', tabindex: '-1' }));
}

let retryAction = null;

/** Tombol "Coba lagi" di bawah #msg (di luar area aria-live), dibuat sekali bila dibutuhkan. */
function retryButton() {
  let btn = $('retry');
  if (!btn) {
    btn = el('button', { type: 'button', id: 'retry', class: 'retry', hidden: true, onclick: () => retryAction?.() }, 'Coba lagi');
    $('msg').after(btn);
  }
  return btn;
}

/** Pesan di area aria-live. `retry` → tampilkan tombol "Coba lagi" yang menjalankan fungsi itu. */
export function say(message, tone = 'info', { retry } = {}) {
  const box = $('msg');
  const btn = retryButton();
  if (!retry && document.activeElement === btn) box.focus(); // jangan biarkan fokus hilang ke <body>
  retryAction = retry ?? null;
  btn.hidden = !retry;
  box.dataset.tone = tone;
  box.textContent = '';
  requestAnimationFrame(() => {
    box.textContent = message;
  });
}

/** Galat dari apiFetch: server mati / galat server → tawarkan "Coba lagi" (bawaan: muat ulang halaman). */
export function sayError(err, retry = () => location.reload()) {
  say(err.message, 'error', err.retryable ? { retry } : undefined);
}

/** Mengembalikan sesi aktif; bila belum masuk, menampilkan formulir masuk di halaman. */
export async function requireSession() {
  const session = await getSession();
  if (session?.token) return session;

  const email = el('input', { id: 'g-email', type: 'email', autocomplete: 'username', required: true });
  const pass = el('input', { id: 'g-pass', type: 'password', autocomplete: 'current-password', required: true });
  const form = el(
    'form',
    { class: 'card stack', novalidate: true },
    el('h2', {}, 'Masuk ke NaraVisi'),
    el('p', { class: 'hint' }, 'Belum punya akun? Klik ikon NaraVisi di toolbar browser lalu pilih "Daftar".'),
    el('div', { class: 'field' }, el('label', { for: 'g-email' }, 'Email'), email),
    el('div', { class: 'field' }, el('label', { for: 'g-pass' }, 'Kata sandi'), pass),
    el('div', { class: 'row' }, el('button', { type: 'submit', class: 'primary' }, 'Masuk')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: email.value, kata_sandi: pass.value },
      });
      await startSession(res);
      location.reload();
    } catch (err) {
      sayError(err, () => form.requestSubmit());
    }
  });
  $('content').replaceChildren(form);
  say('Anda belum masuk. Silakan masuk terlebih dahulu.');
  email.focus();
  return null;
}

export function fmtDateTime(iso) {
  return iso
    ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Makassar' })
    : '-';
}

export function fmtDate(ymd) {
  if (!ymd) return '-';
  return new Date(`${ymd}T00:00:00+08:00`).toLocaleDateString('id-ID', { dateStyle: 'long', timeZone: 'Asia/Makassar' });
}

export const rupiah = (n) => `Rp${Number(n).toLocaleString('id-ID')}`;

/** Jenis gambar dari Gemini (ADR-22). */
export const JENIS_LABEL = {
  foto: 'Foto', ilustrasi: 'Ilustrasi', grafik: 'Grafik', infografis: 'Infografis', tangkapan_layar: 'Tangkapan layar',
  diagram: 'Diagram', logo: 'Logo', meme: 'Meme', dokumen: 'Dokumen', lainnya: 'Lainnya',
};
export const jenisLabel = (jenis) => JENIS_LABEL[jenis] ?? 'Tidak diketahui';

const PROVIDER_LABEL = { gemini: 'Google Gemini', blip: 'BLIP (model lokal)', mock: 'Mode uji (mock)' };
export const providerLabel = (provider) => PROVIDER_LABEL[provider] ?? (provider || '-');

/** Membacakan teks dengan pengaturan TTS pengguna (UC-GBR-07 / UC-RWY-03). */
export async function speak(text, override) {
  if (!('speechSynthesis' in window)) return false;
  const tts = { ...(await getTts()), ...(override ?? {}) };
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tts.bahasa_deskripsi === 'en' ? 'en-US' : 'id-ID';
  const voices = synth.getVoices();
  const voice =
    (tts.jenis_suara && voices.find((v) => v.name === tts.jenis_suara)) ||
    voices.find((v) => v.lang === u.lang) ||
    voices.find((v) => v.lang?.startsWith(u.lang.slice(0, 2)));
  if (voice) u.voice = voice;
  u.rate = Number(tts.kecepatan_suara) || 1;
  u.pitch = Number(tts.nada_suara) || 1;
  document.body.dataset.lastSpoken = text; // dipakai uji otomatis
  synth.speak(u);
  return true;
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
