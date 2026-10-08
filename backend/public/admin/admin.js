// Dashboard Admin NaraVisi — memanggil REST API /api/v1 (RF-21, RF-22, RF-27..RF-30).

const API = '/api/v1';
const TOKEN_KEY = 'naravisi-admin-token';
const $ = (id) => document.getElementById(id);

const state = {
  token: null,
  me: null,
  users: { page: 1, limit: 15, q: '', total: 0 },
  reports: { page: 1, limit: 10, status: 'baru', total: 0 },
  editingUserId: null,
  reviewingId: null,
};

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------
function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(t) {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // penyimpanan diblokir — token tetap di memori
  }
}

async function api(method, path, body) {
  const headers = { accept: 'application/json' };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('Tidak dapat terhubung ke server.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    logout('Sesi berakhir. Silakan masuk kembali.');
  }
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Terjadi kesalahan.');
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.textContent = ''), 5000);
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Makassar' }) : '-';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) node.append(c instanceof Node ? c : document.createTextNode(String(c ?? '')));
  return node;
}

const badge = (text, kind) => el('span', { class: `badge ${kind}` }, text);

// ---------------------------------------------------------------------------
// Sesi
// ---------------------------------------------------------------------------
function showApp(show) {
  $('login-view').hidden = show;
  $('app-view').hidden = !show;
  $('session').hidden = !show;
}

function logout(message) {
  state.token = null;
  state.me = null;
  writeToken(null);
  showApp(false);
  if (message) $('login-error').textContent = message;
  $('login-email').focus();
}

async function enter(token) {
  state.token = token;
  const me = await api('GET', '/me');
  if (me.peran !== 'admin') {
    logout('Akun ini bukan Admin.');
    return;
  }
  state.me = me;
  writeToken(token);
  $('admin-name').textContent = me.nama;
  showApp(true);
  await loadUsers();
  $('main').focus();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const res = await api('POST', '/auth/login', {
      email: $('login-email').value,
      kata_sandi: $('login-password').value,
    });
    $('login-password').value = '';
    await enter(res.token);
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', () => logout());

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
const tabs = [$('tab-users'), $('tab-reports')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  tab.focus();
  if (tab.id === 'tab-reports') loadReports();
  else loadUsers();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      selectTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
    }
  });
});

// ---------------------------------------------------------------------------
// Pengguna (UC-ADM-01..04)
// ---------------------------------------------------------------------------
async function loadUsers() {
  const { page, limit, q } = state.users;
  try {
    const data = await api('GET', `/admin/users?page=${page}&limit=${limit}&q=${encodeURIComponent(q)}`);
    state.users.total = data.total;
    renderUsers(data.items);
  } catch (err) {
    toast(err.message);
  }
}

function renderUsers(items) {
  const body = $('users-body');
  body.replaceChildren();
  const { page, limit, total, q } = state.users;
  $('users-caption').textContent = q
    ? `Hasil pencarian "${q}": ${total} pengguna`
    : `Daftar pengguna (${total})`;
  if (!items.length) {
    body.append(el('tr', {}, el('td', { colspan: 6 }, 'Tidak ada pengguna yang cocok.')));
  }
  for (const u of items) {
    const jenisKind = u.jenis_pengguna === 'Premium' ? 'premium' : u.jenis_pengguna === 'Admin' ? 'admin' : '';
    body.append(
      el(
        'tr',
        {},
        el('td', {}, u.nama),
        el('td', {}, u.email),
        el('td', {}, badge(u.jenis_pengguna, jenisKind), u.premium_hingga ? el('div', { class: 'muted' }, `s.d. ${u.premium_hingga}`) : ''),
        el('td', {}, badge(u.status_akun === 'aktif' ? 'Aktif' : 'Nonaktif', u.status_akun)),
        el('td', {}, fmtDate(u.tanggal_registrasi)),
        el(
          'td',
          {},
          el(
            'div',
            { class: 'row-actions' },
            el('button', { type: 'button', 'aria-label': `Ubah ${u.nama}`, onclick: () => openUserDialog(u) }, 'Ubah'),
            el(
              'button',
              {
                type: 'button',
                'aria-label': `Hapus ${u.nama}`,
                disabled: u.user_id === state.me?.user_id ? '' : null,
                onclick: () => confirmDelete(u),
              },
              'Hapus',
            ),
          ),
        ),
      ),
    );
  }
  const pages = Math.max(1, Math.ceil(total / limit));
  $('users-page').textContent = `Halaman ${page} dari ${pages}`;
  $('users-prev').disabled = page <= 1;
  $('users-next').disabled = page >= pages;
}

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.users.q = $('search').value.trim();
  state.users.page = 1;
  loadUsers();
});
$('users-prev').addEventListener('click', () => {
  state.users.page -= 1;
  loadUsers();
});
$('users-next').addEventListener('click', () => {
  state.users.page += 1;
  loadUsers();
});

function openUserDialog(user) {
  state.editingUserId = user?.user_id ?? null;
  const editing = Boolean(user);
  $('user-dialog-title').textContent = editing ? `Ubah data ${user.nama}` : 'Tambah pengguna';
  $('u-nama').value = user?.nama ?? '';
  $('u-email').value = user?.email ?? '';
  $('u-sandi').value = '';
  $('u-sandi-label').textContent = editing ? 'Kata sandi baru (kosongkan bila tidak diubah)' : 'Kata sandi';
  $('u-peran').value = user?.peran ?? 'pengguna';
  $('u-status').value = user?.status_akun ?? 'aktif';
  $('u-status-row').hidden = !editing;
  $('user-error').textContent = '';
  $('user-dialog').showModal();
  $('u-nama').focus();
}
$('add-user').addEventListener('click', () => openUserDialog(null));

$('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editing = state.editingUserId !== null;
  const body = {
    nama: $('u-nama').value,
    email: $('u-email').value,
    peran: $('u-peran').value,
  };
  if ($('u-sandi').value) body.kata_sandi = $('u-sandi').value;
  if (editing) body.status_akun = $('u-status').value;
  try {
    if (editing) await api('PATCH', `/admin/users/${state.editingUserId}`, body);
    else await api('POST', '/admin/users', body);
    $('user-dialog').close();
    toast(editing ? 'Data pengguna berhasil diperbarui.' : 'Pengguna baru berhasil ditambahkan.');
    loadUsers();
  } catch (err) {
    $('user-error').textContent = err.message;
  }
});

let pendingDelete = null;
function confirmDelete(user) {
  pendingDelete = user;
  $('confirm-text').textContent = `Akun ${user.nama} (${user.email}) beserta riwayat, pengaturan, dan laporannya akan dihapus permanen. Data transaksi disimpan tanpa identitas.`;
  $('confirm-dialog').showModal();
}
$('confirm-dialog').addEventListener('close', async () => {
  const user = pendingDelete;
  pendingDelete = null;
  if ($('confirm-dialog').returnValue !== 'ok' || !user) {
    toast('Penghapusan dibatalkan.');
    return;
  }
  try {
    await api('DELETE', `/admin/users/${user.user_id}`);
    toast(`Pengguna ${user.nama} berhasil dihapus.`);
    loadUsers();
  } catch (err) {
    toast(err.message);
  }
});

// ---------------------------------------------------------------------------
// Laporan (UC-LAP-02..03)
// ---------------------------------------------------------------------------
async function loadReports() {
  const { page, limit, status } = state.reports;
  try {
    const data = await api('GET', `/admin/reports?page=${page}&limit=${limit}&status=${status}`);
    state.reports.total = data.total;
    renderReports(data.items);
  } catch (err) {
    toast(err.message);
  }
}

function renderReports(items) {
  const list = $('reports-list');
  list.replaceChildren();
  $('reports-empty').hidden = items.length > 0;
  for (const r of items) {
    const img = el('img', { src: r.riwayat.url_gambar || '', alt: 'Gambar yang dilaporkan', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(el('div', { class: 'noimg' }, 'Gambar tidak dapat dimuat')));
    list.append(
      el(
        'li',
        { class: 'report' },
        img,
        el(
          'div',
          {},
          el('h3', {}, `Laporan #${r.laporan_id} `, badge(r.status_laporan === 'baru' ? 'Baru' : 'Sudah ditinjau', r.status_laporan)),
          el(
            'dl',
            {},
            el('dt', {}, 'Deskripsi AI'), el('dd', {}, r.riwayat.teks_deskripsi),
            el('dt', {}, 'Alasan'), el('dd', {}, r.alasan),
            el('dt', {}, 'Pelapor'), el('dd', {}, `${r.pelapor.nama} (${r.pelapor.email})`),
            el('dt', {}, 'Halaman'), el('dd', {}, r.riwayat.url_halaman || '-'),
            el('dt', {}, 'Dilaporkan'), el('dd', {}, fmtDate(r.tanggal_laporan)),
            ...(r.tindak_lanjut
              ? [el('dt', {}, 'Tindak lanjut'), el('dd', {}, `${r.tindak_lanjut} — ${r.peninjau?.nama ?? '-'}, ${fmtDate(r.tanggal_tinjau)}`)]
              : []),
          ),
          el('button', { type: 'button', onclick: () => openReview(r) }, r.status_laporan === 'baru' ? 'Tinjau' : 'Ubah status'),
        ),
      ),
    );
  }
  const pages = Math.max(1, Math.ceil(state.reports.total / state.reports.limit));
  $('reports-page').textContent = `Halaman ${state.reports.page} dari ${pages}`;
  $('reports-prev').disabled = state.reports.page <= 1;
  $('reports-next').disabled = state.reports.page >= pages;
}

$('report-filter').addEventListener('change', () => {
  state.reports.status = $('report-filter').value;
  state.reports.page = 1;
  loadReports();
});
$('reports-prev').addEventListener('click', () => {
  state.reports.page -= 1;
  loadReports();
});
$('reports-next').addEventListener('click', () => {
  state.reports.page += 1;
  loadReports();
});

function openReview(r) {
  state.reviewingId = r.laporan_id;
  $('review-title').textContent = `Tinjau laporan #${r.laporan_id}`;
  $('r-status').value = 'ditinjau';
  $('r-tindak').value = r.tindak_lanjut ?? '';
  $('review-error').textContent = '';
  $('review-dialog').showModal();
  $('r-tindak').focus();
}

$('review-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PATCH', `/admin/reports/${state.reviewingId}`, {
      status_laporan: $('r-status').value,
      tindak_lanjut: $('r-tindak').value,
    });
    $('review-dialog').close();
    toast('Status laporan berhasil diperbarui.');
    loadReports();
  } catch (err) {
    $('review-error').textContent = err.message;
  }
});

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close()),
);

// ---------------------------------------------------------------------------
// Mulai
// ---------------------------------------------------------------------------
(async () => {
  const saved = readToken();
  if (saved) {
    try {
      await enter(saved);
      return;
    } catch {
      logout();
    }
  }
  showApp(false);
  $('login-email').focus();
})();
