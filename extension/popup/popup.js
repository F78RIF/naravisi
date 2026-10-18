import { mountAuthForms } from '../shared/auth-forms.js';
import { getSession, logout, refreshProfile } from '../shared/config.js';
import { currentShortcut, openShortcutsPage } from '../shared/guide.js';
import { icon } from '../shared/icons.js';

const $ = (id) => document.getElementById(id);

let retryAction = null;

/**
 * Pesan di area aria-live. `retry` → tombol "Coba lagi" di bawah pesan (di luar area live
 * agar label tombol tidak ikut dibacakan setiap kali pesan berubah).
 */
function say(text, tone = 'info', { retry } = {}) {
  const el = $('message');
  const btn = $('retry');
  // Tombol yang sedang difokus akan disembunyikan → pindahkan fokus ke pesan agar tidak hilang ke <body>.
  if (!retry && document.activeElement === btn) el.focus();
  el.dataset.tone = tone;
  el.textContent = text;
  retryAction = retry ?? null;
  btn.hidden = !retry;
}

$('retry').addEventListener('click', () => {
  checkHealth();
  retryAction?.();
});

/** Kartu kuota: angka besar "7 / 10", dibangun dengan DOM (tanpa innerHTML). */
function renderQuota(user) {
  const figure = $('quota');
  const plan = $('plan');
  const bar = $('quota-bar');
  const span = (cls, text, attrs = {}) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    return s;
  };
  const strong = document.createElement('strong');

  if (user.jenis_pengguna === 'Gratis' && user.kuota?.batas != null) {
    const { sisa, batas } = user.kuota;
    figure.replaceChildren(
      span('num', String(sisa)),
      span('of', ' / ', { 'aria-hidden': 'true' }),
      span('sr-only', ' dari '),
      span('of', String(batas)),
      span('unit', ' gambar hari ini'),
    );
    bar.style.setProperty('--nv-quota', `${Math.round((sisa / batas) * 100)}%`);
    bar.hidden = false;
    strong.textContent = 'Akun Gratis';
    plan.replaceChildren(strong, document.createTextNode(' · kuota diisi ulang pukul 00.00 WITA'));
  } else {
    figure.replaceChildren(span('num', 'Tanpa batas'), span('unit', ' gambar hari ini'));
    bar.hidden = true;
    strong.textContent = user.jenis_pengguna === 'Admin' ? 'Akun Admin' : 'Premium';
    const until = user.langganan?.berlaku_hingga ? ` · berlaku hingga ${user.langganan.berlaku_hingga}` : '';
    plan.replaceChildren(strong, document.createTextNode(until));
  }
}

/** Pintasan yang sedang berlaku (bisa diubah pengguna di chrome://extensions/shortcuts), bukan teks tetap. */
async function showShortcut() {
  const shortcut = await currentShortcut();
  $('shortcut').textContent = shortcut || 'belum diatur';
  $('set-shortcut').hidden = Boolean(shortcut);
  if (shortcut) $('scan').setAttribute('aria-keyshortcuts', shortcut);
  else {
    $('scan').removeAttribute('aria-keyshortcuts');
    say('Pintasan belum diatur.');
  }
}

$('set-shortcut').addEventListener('click', async () => {
  await openShortcutsPage();
  window.close();
});

function render(user) {
  $('guest').hidden = Boolean(user);
  $('member').hidden = !user;
  if (user) {
    $('hello').textContent = `Halo, ${user.nama}.`;
    renderQuota(user);
    $('premium-btn').querySelector('.label').textContent = user.jenis_pengguna === 'Premium' ? 'Langganan' : 'Upgrade Premium';
    $('scan').focus();
  } else {
    // Selalu kembali ke form Masuk (mis. setelah keluar dari akun yang baru didaftarkan).
    auth.showLogin();
  }
}

/** Titik + teks di kaki popup: hijau = terhubung, marigold = AI belum siap, merah bata = tidak aktif. */
async function checkHealth() {
  const health = await chrome.runtime.sendMessage({ type: 'NV_HEALTH' });
  const dot = $('health-dot');
  const text = $('health');
  if (!health?.ok) {
    dot.dataset.state = 'off';
    text.textContent = 'Server tidak aktif';
  } else if (!health.ai?.ok) {
    dot.dataset.state = 'warn';
    text.textContent = 'Server terhubung · AI belum siap';
  } else {
    dot.dataset.state = 'ok';
    text.textContent = 'Server terhubung';
  }
  $('server-settings').hidden = Boolean(health?.ok);
}

// UC-AKUN-05 & UC-AKUN-01: setelah daftar langsung masuk, tanpa login ulang.
const auth = mountAuthForms($('auth'), { say, onSuccess: (user) => render(user) });

$('logout').addEventListener('click', async () => {
  await logout();
  render(null);
  say('Anda sudah keluar.');
});

$('scan').addEventListener('click', async () => {
  say('Memindai…');
  const res = await chrome.runtime.sendMessage({ type: 'NV_TOGGLE_ACTIVE' });
  if (res?.ok) window.close(); // fokus kembali ke panel di halaman
  else say(res?.message || 'Gagal membuka NaraVisi.', 'error');
});

// Menu berikon: ikon & panah dipasang di sini agar HTML tetap ringkas.
document.querySelectorAll('.menu-list [data-icon]').forEach((btn) => {
  btn.prepend(icon(btn.dataset.icon));
  btn.append(icon('chevron', { size: 20, className: 'chevron' }));
});

document.querySelectorAll('[data-page]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'NV_OPEN_PAGE', page: btn.dataset.page });
    window.close();
  }),
);

(async () => {
  showShortcut();
  checkHealth();

  const session = await getSession();
  render(session?.user ?? null);
  if (session?.token) {
    try {
      render(await refreshProfile()); // kuota & status terbaru
    } catch (err) {
      if (err.status === 401) {
        render(null);
        say(err.message, 'error');
      }
    }
  }
})();
