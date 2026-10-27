// Profil: RF-02..RF-04 (UC-AKUN-02..04)
import { apiFetch, logout, refreshProfile } from '../shared/config.js';
import { $, el, fmtDate, fmtDateTime, requireSession, say, sayError, shell } from './common.js';

shell('profil', 'Profil saya');

function infoCard(user) {
  const k = user.kuota;
  return el(
    'section',
    { class: 'card', 'aria-labelledby': 'info-title' },
    el('h2', { id: 'info-title' }, 'Data akun'),
    el(
      'dl',
      { class: 'kv' },
      el('dt', {}, 'Nama'), el('dd', { id: 'p-nama' }, user.nama),
      el('dt', {}, 'Email'), el('dd', {}, user.email),
      el('dt', {}, 'Status akun'), el('dd', { id: 'p-jenis' }, user.jenis_pengguna),
      user.langganan.premium ? [el('dt', {}, 'Premium hingga'), el('dd', {}, fmtDate(user.langganan.berlaku_hingga))] : null,
      el('dt', {}, 'Kuota hari ini'),
      el('dd', {}, k.batas == null ? `${k.terpakai} terpakai · tanpa batas` : `${k.terpakai} terpakai · sisa ${k.sisa} dari ${k.batas}`),
      el('dt', {}, 'Terdaftar'), el('dd', {}, fmtDateTime(user.tanggal_registrasi)),
    ),
  );
}

function editCard(user) {
  const nama = el('input', { id: 'e-nama', value: user.nama, autocomplete: 'name', minlength: 2, maxlength: 100 });
  const email = el('input', { id: 'e-email', type: 'email', value: user.email, autocomplete: 'email', maxlength: 100 });
  const lama = el('input', { id: 'e-lama', type: 'password', autocomplete: 'current-password', 'aria-describedby': 'e-lama-hint' });
  const baru = el('input', { id: 'e-baru', type: 'password', autocomplete: 'new-password', minlength: 8, 'aria-describedby': 'e-baru-hint' });
  const form = el(
    'form',
    { class: 'card stack', novalidate: true, 'aria-labelledby': 'edit-title' },
    el('h2', { id: 'edit-title' }, 'Ubah profil'),
    el('label', { for: 'e-nama' }, 'Nama'),
    nama,
    el('label', { for: 'e-email' }, 'Email'),
    email,
    el('label', { for: 'e-lama' }, 'Kata sandi saat ini'),
    lama,
    el('p', { class: 'hint', id: 'e-lama-hint' }, 'Wajib bila mengganti email atau kata sandi.'),
    el('label', { for: 'e-baru' }, 'Kata sandi baru'),
    baru,
    el('p', { class: 'hint', id: 'e-baru-hint' }, 'Minimal 8 karakter. Kosongkan bila tidak ingin mengganti.'),
    el('div', { class: 'row' }, el('button', { type: 'submit', class: 'primary' }, 'Simpan perubahan')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    if (nama.value.trim() !== user.nama) body.nama = nama.value;
    const emailChanged = email.value.trim().toLowerCase() !== user.email;
    if (emailChanged) body.email = email.value;
    if ((emailChanged || baru.value) && !lama.value) {
      say('Masukkan kata sandi saat ini untuk mengganti email atau kata sandi.', 'error');
      lama.focus();
      return;
    }
    if (emailChanged) body.kata_sandi_lama = lama.value;
    if (baru.value) {
      body.kata_sandi_baru = baru.value;
      body.kata_sandi_lama = lama.value;
    }
    if (!Object.keys(body).length) {
      say('Tidak ada perubahan untuk disimpan.');
      return;
    }
    try {
      await apiFetch('/me', { method: 'PATCH', body });
      lama.value = '';
      baru.value = '';
      await load();
      say('Profil berhasil diperbarui.', 'ok');
    } catch (err) {
      say(err.message, 'error');
      const field = { nama, email, kata_sandi_lama: lama, kata_sandi_baru: baru }[err.details?.field]
        ?? (err.code === 'WRONG_PASSWORD' ? lama : err.code === 'EMAIL_TAKEN' ? email : null);
      field?.focus();
    }
  });
  return form;
}

// UC-AKUN-04: konfirmasi dengan mengetik "HAPUS" (bisa dilakukan sepenuhnya dengan keyboard & pembaca layar).
function dangerCard() {
  const konfirmasi = el('input', { id: 'd-konfirmasi', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'd-konfirmasi-hint' });
  const sandi = el('input', { id: 'd-sandi', type: 'password', autocomplete: 'current-password' });
  const form = el(
    'form',
    { class: 'card stack', novalidate: true, 'aria-labelledby': 'del-title' },
    el('h2', { id: 'del-title' }, 'Hapus akun'),
    el('p', { id: 'del-desc' }, 'Akun, riwayat, pengaturan, dan laporan Anda akan dihapus permanen, dan Anda keluar dari semua perangkat. Tindakan ini tidak dapat dibatalkan.'),
    el('label', { for: 'd-konfirmasi' }, 'Ketik HAPUS untuk konfirmasi'),
    konfirmasi,
    el('p', { class: 'hint', id: 'd-konfirmasi-hint' }, 'Huruf besar semua: H A P U S.'),
    el('label', { for: 'd-sandi' }, 'Kata sandi'),
    sandi,
    el('div', { class: 'row' }, el('button', { type: 'submit', class: 'danger' }, 'Hapus akun permanen')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (konfirmasi.value.trim() !== 'HAPUS') {
      konfirmasi.setAttribute('aria-invalid', 'true');
      say('Akun tidak dihapus. Ketik HAPUS dengan huruf besar untuk mengonfirmasi.', 'error');
      konfirmasi.focus();
      return;
    }
    konfirmasi.removeAttribute('aria-invalid');
    if (!sandi.value) {
      say('Masukkan kata sandi untuk menghapus akun.', 'error');
      sandi.focus();
      return;
    }
    try {
      await apiFetch('/me', { method: 'DELETE', body: { konfirmasi: konfirmasi.value.trim(), kata_sandi: sandi.value } });
      await logout();
      $('content').replaceChildren(el('p', { class: 'card' }, 'Akun Anda sudah dihapus. Terima kasih telah menggunakan NaraVisi.'));
      say('Akun berhasil dihapus.', 'ok');
    } catch (err) {
      say(err.message, 'error');
      if (err.code === 'WRONG_PASSWORD') sandi.focus();
    }
  });
  return form;
}

async function load() {
  const user = await refreshProfile();
  const out = el('div', { class: 'row' }, el('button', {
    type: 'button',
    onclick: async () => {
      await logout();
      location.reload();
    },
  }, 'Keluar'));
  $('content').replaceChildren(infoCard(user), editCard(user), dangerCard(), out);
}

(async () => {
  if (!(await requireSession())) return;
  try {
    await load();
  } catch (err) {
    sayError(err);
  }
})();
