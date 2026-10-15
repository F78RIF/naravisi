// Formulir Masuk & Daftar bersama untuk popup dan tab sambutan (UC-AKUN-01, UC-AKUN-05).
// Dibangun dengan DOM (tanpa innerHTML). Token hanya disimpan lewat startSession → chrome.storage.local.
import { apiFetch, startSession } from './config.js';
import { greetingText, speakGuide, spokenShortcut } from './guide.js';

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

/** Kolom + teks error di bawahnya; kolom kata sandi mendapat tombol "Tampilkan kata sandi". */
function field(id, label, attrs, { reveal = false } = {}) {
  const input = h('input', { id, required: true, ...attrs });
  const error = h('p', { id: `${id}-error`, class: 'field-error', hidden: true });
  let toggle = null;
  if (reveal) {
    toggle = h('button', { type: 'button', class: 'reveal', 'aria-pressed': 'false', 'aria-controls': id }, 'Tampilkan kata sandi');
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
    });
  }
  return { input, error, nodes: [h('label', { for: id }, label), input, error, toggle] };
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
 * Memasang form Masuk/Daftar ke `container`.
 * `say(text, tone)` menulis ke area aria-live halaman; `onSuccess(user, greeting)` dipanggil setelah masuk.
 */
export function mountAuthForms(container, { say, onSuccess }) {
  const login = {
    email: field('login-email', 'Email', { type: 'email', autocomplete: 'username' }),
    password: field('login-password', 'Kata sandi', { type: 'password', autocomplete: 'current-password' }, { reveal: true }),
  };
  const reg = {
    nama: field('reg-name', 'Nama', { autocomplete: 'name', minlength: '2', maxlength: '100' }),
    email: field('reg-email', 'Email', { type: 'email', autocomplete: 'email' }),
    kata_sandi: field('reg-password', 'Kata sandi (minimal 8 karakter)', { type: 'password', autocomplete: 'new-password', minlength: '8' }, { reveal: true }),
  };

  const loginForm = h('form', { id: 'login-form', novalidate: true },
    ...login.email.nodes, ...login.password.nodes,
    h('button', { type: 'submit', class: 'primary' }, 'Masuk'));
  const showRegisterBtn = h('button', { type: 'button', id: 'show-register', class: 'link' }, 'Belum punya akun? Daftar');
  const showLoginBtn = h('button', { type: 'button', id: 'show-login', class: 'link' }, 'Sudah punya akun? Masuk');
  const registerForm = h('form', { id: 'register-form', novalidate: true, hidden: true },
    h('h2', {}, 'Daftar akun baru'),
    ...reg.nama.nodes, ...reg.email.nodes, ...reg.kata_sandi.nodes,
    h('button', { type: 'submit', class: 'primary' }, 'Daftar'),
    showLoginBtn);
  container.replaceChildren(loginForm, showRegisterBtn, registerForm);

  /** Tandai kolom yang salah, fokus ke yang pertama, dan bacakan pesannya sekali. */
  function invalid(pairs) {
    for (const [f, msg] of pairs) setError(f, msg);
    const [first, message] = pairs[0];
    first.input.focus();
    say(message, 'error');
    speakGuide(message);
  }

  async function submit(fields, path, body) {
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
      say(err.message, 'error');
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
    submit({ email: login.email, kata_sandi: login.password }, '/auth/login', { email, kata_sandi: pass });
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
    submit(reg, '/auth/register', { nama, email, kata_sandi: pass });
  });

  function showRegister() {
    loginForm.hidden = true;
    showRegisterBtn.hidden = true;
    registerForm.hidden = false;
    reg.nama.input.focus();
    say('Formulir pendaftaran');
  }

  function showLogin({ announce = true, focus = true } = {}) {
    registerForm.hidden = true;
    loginForm.hidden = false;
    showRegisterBtn.hidden = false;
    if (focus) login.email.input.focus();
    if (announce) say('Formulir masuk');
  }

  showRegisterBtn.addEventListener('click', showRegister);
  showLoginBtn.addEventListener('click', () => showLogin());
  return { showLogin, showRegister };
}
