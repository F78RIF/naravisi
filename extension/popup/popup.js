import {
  apiFetch,
  DEFAULTS,
  getSession,
  getSettings,
  logout,
  refreshProfile,
  startSession,
} from '../shared/config.js';

const $ = (id) => document.getElementById(id);

function say(text, tone = 'info') {
  const el = $('message');
  el.dataset.tone = tone;
  el.textContent = text;
}

/** Ringkasan status akun — dibangun dengan DOM (tanpa innerHTML). */
function renderPlan(el, user) {
  const strong = document.createElement('strong');
  let rest;
  if (user.jenis_pengguna === 'Premium') {
    strong.textContent = 'Premium';
    rest = ` · berlaku hingga ${user.langganan.berlaku_hingga} · kuota tanpa batas`;
  } else if (user.jenis_pengguna === 'Admin') {
    strong.textContent = 'Admin';
    rest = ' · kuota tanpa batas';
  } else {
    strong.textContent = 'Gratis';
    rest = ` · sisa kuota hari ini ${user.kuota.sisa} dari ${user.kuota.batas}`;
  }
  el.replaceChildren(strong, document.createTextNode(rest));
}

async function showShortcut() {
  const [cmd] = (await chrome.commands.getAll()).filter((c) => c.name === 'scan-page');
  $('shortcut').textContent = cmd?.shortcut || 'belum diatur';
}

function render(user) {
  $('guest').hidden = Boolean(user);
  $('member').hidden = !user;
  if (user) {
    $('hello').textContent = `Halo, ${user.nama}.`;
    renderPlan($('plan'), user);
    $('premium-btn').textContent = user.jenis_pengguna === 'Premium' ? 'Langganan' : 'Upgrade Premium';
    $('scan').focus();
  } else {
    // Selalu kembali ke form Masuk (mis. setelah keluar dari akun yang baru didaftarkan).
    $('register-form').hidden = true;
    $('login-form').hidden = false;
    $('show-register').hidden = false;
    $('login-email').focus();
  }
}

async function checkHealth() {
  const health = await chrome.runtime.sendMessage({ type: 'NV_HEALTH' });
  const el = $('health');
  el.dataset.ok = String(Boolean(health?.ok && health.ai?.ok));
  if (!health?.ok) el.textContent = `Server tidak dapat dihubungi (${health?.apiBase ?? '-'}).`;
  else if (!health.ai?.ok) el.textContent = 'Server aktif, tetapi layanan AI belum siap.';
  else el.textContent = `Server dan layanan AI siap (${health.ai.model ?? health.ai.provider}).`;
}

// UC-AKUN-05
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('Memeriksa…');
  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email: $('login-email').value, kata_sandi: $('login-password').value },
    });
    $('login-password').value = '';
    render(await startSession(res));
    say('Berhasil masuk.');
  } catch (err) {
    say(err.message, 'error');
  }
});

// UC-AKUN-01
$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('Mendaftarkan akun…');
  try {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      auth: false,
      body: { nama: $('reg-name').value, email: $('reg-email').value, kata_sandi: $('reg-password').value },
    });
    $('reg-password').value = '';
    render(await startSession(res));
    say('Akun berhasil dibuat. Selamat datang di NaraVisi!');
  } catch (err) {
    say(err.message, 'error');
  }
});

$('show-register').addEventListener('click', () => {
  $('login-form').hidden = true;
  $('show-register').hidden = true;
  $('register-form').hidden = false;
  $('reg-name').focus();
});
$('show-login').addEventListener('click', () => {
  $('register-form').hidden = true;
  $('login-form').hidden = false;
  $('show-register').hidden = false;
  $('login-email').focus();
});

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

document.querySelectorAll('[data-page]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'NV_OPEN_PAGE', page: btn.dataset.page });
    window.close();
  }),
);

$('api-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const apiBase = $('api-base').value.trim().replace(/\/+$/, '') || DEFAULTS.apiBase;
  await chrome.storage.sync.set({ apiBase });
  say('Alamat API disimpan.');
  checkHealth();
});

(async () => {
  const settings = await getSettings();
  $('api-base').value = settings.apiBase;
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
