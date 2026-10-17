// Formulir Masuk & Daftar bersama untuk popup dan tab sambutan (UC-AKUN-01, UC-AKUN-05).
// Dibangun dengan DOM (tanpa innerHTML). Token hanya disimpan lewat startSession → chrome.storage.local.
import { apiFetch, startSession } from './config.js';
import { greetingText, speakGuide, spokenShortcut } from './guide.js';
import { icon } from './icons.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

/**
 * Tombol ikon mata di dalam kolom kata sandi. Mata terbuka = sandi tersembunyi (tekan untuk menampilkan),
 * mata dicoret = sandi terlihat. Fokus tetap di tombol dan posisi kursor di kolom dipertahankan.
 */
function revealButton(input) {
  const btn = h('button', {
    type: 'button',
    class: 'reveal',
    'aria-label': 'Tampilkan kata sandi',
    'aria-pressed': 'false',
    'aria-controls': input.id,
  }, icon('eye'));
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    const { selectionStart, selectionEnd, selectionDirection } = input;
    input.type = show ? 'text' : 'password';
    // Mengganti type mengatur ulang kursor; kembalikan tanpa memindahkan fokus dari tombol.
    if (selectionStart !== null) input.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    btn.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
  });
  return btn;
}

/** Label di atas, kolom, lalu teks error di bawahnya. */
function field(id, label, attrs, { reveal = false } = {}) {
  const input = h('input', { id, required: true, ...attrs });
  const error = h('p', { id: `${id}-error`, class: 'field-error', hidden: true });
  const control = reveal ? h('div', { class: 'input-wrap' }, input, revealButton(input)) : input;
  return { input, error, node: h('div', { class: 'field' }, h('label', { for: id }, label), control, error) };
}

function setError(f, message) {
  f.error.textContent = message;
  f.error.hidden = false;
  f.input.setAttribute('aria-invalid', 'true');
  f.input.setAttribute('aria-describedby', f.error.id);
}

function clearErrors(fields) {
  for (const f of fields) {
    f.error.textContent = '';
    f.error.hidden = true;
    f.input.removeAttribute('aria-invalid');
    f.input.removeAttribute('aria-describedby');
  }
}

/**
 * Memasang form Masuk/Daftar ke `container`: segmented control (tablist) di atas, satu form tampil.
 * `say(text, tone, { retry })` menulis ke area aria-live halaman (retry → tombol "Coba lagi");
 * `onSuccess(user, greeting)` dipanggil setelah masuk. `headingLevel` = tingkat judul form.
 */
export function mountAuthForms(container, { say, onSuccess, headingLevel = 2 }) {
  const login = {
    email: field('login-email', 'Email', { type: 'email', autocomplete: 'username' }),
    password: field('login-password', 'Kata sandi', { type: 'password', autocomplete: 'current-password' }, { reveal: true }),
  };
  const reg = {
    nama: field('reg-name', 'Nama', { autocomplete: 'name', minlength: '2', maxlength: '100' }),
    email: field('reg-email', 'Email', { type: 'email', autocomplete: 'email' }),
    kata_sandi: field('reg-password', 'Kata sandi (minimal 8 karakter)', { type: 'password', autocomplete: 'new-password', minlength: '8' }, { reveal: true }),
  };
  const heading = `h${headingLevel}`;

  const loginForm = h('form', { id: 'login-form', class: 'auth-form', novalidate: true },
    login.email.node, login.password.node,
    h('button', { type: 'submit', class: 'primary' }, 'Masuk'));
  const registerForm = h('form', { id: 'register-form', class: 'auth-form', novalidate: true },
    reg.nama.node, reg.email.node, reg.kata_sandi.node,
    h('button', { type: 'submit', class: 'primary' }, 'Daftar'));

  const panels = {
    login: h('section', { id: 'login-panel', class: 'auth-panel', role: 'tabpanel', 'aria-labelledby': 'tab-login' },
      h(heading, { class: 'form-title' }, 'Masuk ke NaraVisi'),
      h('p', { class: 'lead' }, 'Masuk untuk mulai mendeskripsikan gambar.'),
      loginForm),
    register: h('section', { id: 'register-panel', class: 'auth-panel', role: 'tabpanel', 'aria-labelledby': 'tab-register', hidden: true },
      h(heading, { class: 'form-title' }, 'Buat akun baru'),
      registerForm),
  };
  const tabs = {
    login: h('button', { type: 'button', role: 'tab', id: 'tab-login', 'aria-controls': 'login-panel', 'aria-selected': 'true', tabindex: '0' }, 'Masuk'),
    register: h('button', { type: 'button', role: 'tab', id: 'tab-register', 'aria-controls': 'register-panel', 'aria-selected': 'false', tabindex: '-1' }, 'Daftar'),
  };
  const tablist = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Masuk atau daftar' }, tabs.login, tabs.register);
  container.replaceChildren(tablist, panels.login, panels.register);

  /** Hanya satu form yang tampil; tab terpilih punya tabindex 0 (roving tabindex). */
  function select(key) {
    for (const k of Object.keys(tabs)) {
      const on = k === key;
      tabs[k].setAttribute('aria-selected', String(on));
      tabs[k].tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    }
  }

  const order = ['login', 'register'];
  tablist.addEventListener('keydown', (e) => {
    const current = order.findIndex((k) => tabs[k] === e.target);
    if (current < 0) return;
    const next = {
      ArrowRight: (current + 1) % order.length,
      ArrowLeft: (current - 1 + order.length) % order.length,
      Home: 0,
      End: order.length - 1,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(order[next]);
    tabs[order[next]].focus();
  });
  for (const k of order) tabs[k].addEventListener('click', () => select(k));

  /** Tandai kolom yang salah, fokus ke yang pertama, dan bacakan pesannya sekali. */
  function invalid(pairs) {
    for (const [f, msg] of pairs) setError(f, msg);
    const [first, message] = pairs[0];
    first.input.focus();
    say(message, 'error');
    speakGuide(message);
  }

  async function submit(form, fields, path, body) {
    clearErrors(Object.values(fields));
    say('Memeriksa…');
    try {
      const res = await apiFetch(path, { method: 'POST', auth: false, body });
      const user = await startSession(res);
      for (const f of Object.values(fields)) if (f.input.autocomplete.endsWith('password')) f.input.value = '';
      const greeting = greetingText(user, await spokenShortcut());
      onSuccess(user, greeting);
      say(greeting, 'ok');
      speakGuide(greeting);
    } catch (err) {
      const target = err.details?.field && fields[err.details.field];
      if (target) return invalid([[target, err.message]]);
      // Server mati / galat server: tawarkan "Coba lagi" yang mengirim ulang form yang sama.
      say(err.message, 'error', err.retryable ? { retry: () => form.requestSubmit() } : undefined);
      speakGuide(err.message);
    }
  }

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = login.email.input.value.trim();
    const pass = login.password.input.value;
    const problems = [];
    if (!email) problems.push([login.email, 'Email wajib diisi.']);
    else if (!EMAIL_RE.test(email)) problems.push([login.email, 'Format email tidak valid.']);
    if (!pass) problems.push([login.password, 'Kata sandi wajib diisi.']);
    if (problems.length) {
      clearErrors(Object.values(login));
      return invalid(problems);
    }
    // Pemetaan field server → kolom: { email, kata_sandi }
    submit(loginForm, { email: login.email, kata_sandi: login.password }, '/auth/login', { email, kata_sandi: pass });
  });

  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nama = reg.nama.input.value.trim();
    const email = reg.email.input.value.trim();
    const pass = reg.kata_sandi.input.value;
    const problems = [];
    if (nama.length < 2) problems.push([reg.nama, nama ? 'Nama minimal 2 karakter.' : 'Nama wajib diisi.']);
    if (!email) problems.push([reg.email, 'Email wajib diisi.']);
    else if (!EMAIL_RE.test(email)) problems.push([reg.email, 'Format email tidak valid.']);
    if (pass.length < 8) problems.push([reg.kata_sandi, pass ? 'Kata sandi minimal 8 karakter.' : 'Kata sandi wajib diisi.']);
    if (problems.length) {
      clearErrors(Object.values(reg));
      return invalid(problems);
    }
    submit(registerForm, reg, '/auth/register', { nama, email, kata_sandi: pass });
  });

  function showRegister({ focus = true } = {}) {
    select('register');
    if (focus) reg.nama.input.focus();
  }

  function showLogin({ focus = true } = {}) {
    select('login');
    if (focus) login.email.input.focus();
  }

  return { showLogin, showRegister };
}
