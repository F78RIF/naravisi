// Riwayat deskripsi: RF-14..RF-16, RF-20 (UC-RWY-02..04, UC-LAP-01)
// Daftar (Gratis 7 hari, Premium semua; berhalaman) · detail ?id=N · putar ulang · hapus satu & semua.
import { apiFetch } from '../shared/config.js';
import { $, el, fmtDateTime, jenisLabel, providerLabel, REPORT_CATEGORIES, requireSession, say, sayError, shell, speak, stopSpeaking } from './common.js';

const detailId = new URLSearchParams(location.search).get('id');
shell('riwayat', detailId ? 'Detail riwayat' : 'Riwayat deskripsi');
const state = { page: 1, limit: 10 };

// UC-LAP-01 / RF-20: pilih alasan + catatan (wajib untuk "Lainnya").
function reportForm(item, holder) {
  if (holder.querySelector('form')) {
    holder.querySelector('select').focus();
    return;
  }
  const id = `alasan-${item.riwayat_id}`;
  const kategori = el('select', { id: `kategori-${item.riwayat_id}` },
    el('option', { value: '' }, 'Pilih alasan…'), REPORT_CATEGORIES.map(([v, l]) => el('option', { value: v }, l)));
  const area = el('textarea', { id, rows: 3, maxlength: 1000 });
  const form = el(
    'form',
    { class: 'stack', novalidate: true },
    el('label', { for: kategori.id }, 'Apa yang salah dari deskripsi ini?'),
    kategori,
    el('label', { for: id }, 'Catatan (opsional; wajib bila memilih Lainnya)'),
    area,
    el(
      'div',
      { class: 'row' },
      el('button', { type: 'submit', class: 'primary' }, 'Kirim laporan'),
      el('button', { type: 'button', onclick: () => form.remove() }, 'Batal'),
    ),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!kategori.value) {
      say('Pilih alasan pelaporan terlebih dahulu.', 'error');
      kategori.focus();
      return;
    }
    if (kategori.value === 'lainnya' && area.value.trim().length < 3) {
      say('Untuk alasan "Lainnya", tuliskan apa yang salah di catatan.', 'error');
      area.focus();
      return;
    }
    try {
      await apiFetch('/reports', {
        method: 'POST',
        body: { riwayat_id: item.riwayat_id, kategori: kategori.value, catatan: area.value.trim() || undefined },
      });
      form.remove();
      say('Terima kasih. Laporan Anda sudah dikirim dan akan ditinjau Admin.', 'ok');
    } catch (err) {
      say(err.message, 'error');
    }
  });
  holder.append(form);
  kategori.focus();
}

/** Tombol bersama di daftar & detail. */
function actions(item, holder, { inDetail = false, headingId } = {}) {
  return el(
    'div',
    { class: 'row' },
    el('button', { type: 'button', class: 'replay', onclick: () => speak(item.teks_deskripsi) }, 'Putar ulang'),
    el('button', { type: 'button', onclick: stopSpeaking }, 'Berhenti'),
    // aria-describedby: di daftar tautan NVDA, "Detail" tetap jelas milik deskripsi yang mana.
    inDetail ? null : el('a', { class: 'btn', href: `riwayat.html?id=${item.riwayat_id}`, 'aria-describedby': headingId }, 'Detail'),
    el('button', { type: 'button', onclick: () => reportForm(item, holder) }, 'Laporkan'),
    el('button', { type: 'button', onclick: () => remove(item, inDetail) }, 'Hapus'),
  );
}

function renderItem(item, index, total) {
  const holder = el('div');
  const headingId = `h-${item.riwayat_id}`;
  return el(
    'li',
    { class: 'item' },
    el(
      'article',
      { 'aria-labelledby': headingId },
      el('h2', { id: headingId }, `Deskripsi ${index} dari ${total} · ${fmtDateTime(item.waktu_dibuat)}`),
      item.jenis_gambar ? el('p', { class: 'meta jenis' }, `Jenis gambar: ${jenisLabel(item.jenis_gambar)}`) : null,
      el('p', { class: 'text' }, item.teks_deskripsi),
      el(
        'p',
        { class: 'meta' },
        'Halaman: ',
        item.url_halaman ? el('a', { href: item.url_halaman, target: '_blank', rel: 'noopener' }, item.url_halaman) : '-',
      ),
      actions(item, holder, { headingId }),
      holder,
    ),
  );
}

async function remove(item, inDetail) {
  // UC-RWY-04: konfirmasi sebelum menghapus
  if (!window.confirm(`Hapus deskripsi "${item.teks_deskripsi}" dari riwayat?`)) {
    say('Penghapusan dibatalkan.');
    return;
  }
  try {
    await apiFetch(`/history/${item.riwayat_id}`, { method: 'DELETE' });
    if (inDetail) {
      $('content').replaceChildren(el('p', { class: 'card' }, 'Riwayat ini sudah dihapus. ', el('a', { href: 'riwayat.html' }, 'Kembali ke daftar riwayat')));
    } else {
      await load();
    }
    say('Riwayat berhasil dihapus.', 'ok');
  } catch (err) {
    say(err.message, 'error');
  }
}

async function removeAll(total) {
  if (!window.confirm(`Hapus SEMUA riwayat (${total} deskripsi)? Tindakan ini tidak dapat dibatalkan.`)) {
    say('Penghapusan dibatalkan. Riwayat tetap tersimpan.');
    return;
  }
  try {
    const res = await apiFetch('/history', { method: 'DELETE', body: { semua: true } });
    state.page = 1;
    await load();
    say(`Semua riwayat dihapus (${res.dihapus} deskripsi).`, 'ok');
  } catch (err) {
    say(err.message, 'error');
  }
}

async function load() {
  const content = $('content');
  let data;
  try {
    data = await apiFetch(`/history?page=${state.page}&limit=${state.limit}`);
  } catch (err) {
    sayError(err, load);
    return;
  }
  // Halaman terakhir kosong setelah menghapus → mundur satu halaman.
  if (!data.items.length && state.page > 1) {
    state.page -= 1;
    await load();
    return;
  }

  const parts = [];
  if (data.batas_hari) {
    parts.push(
      el(
        'p',
        { class: 'notice' },
        `Akun Gratis menampilkan riwayat ${data.batas_hari} hari terakhir.`,
        data.tersembunyi ? ` ${data.tersembunyi} riwayat lama disembunyikan dan akan tampil lagi setelah upgrade. ` : ' ',
        el('a', { href: 'premium.html' }, 'Lihat Premium'),
      ),
    );
  }

  if (!data.items.length) {
    parts.push(el('p', { class: 'card' }, 'Riwayat masih kosong. Deskripsikan gambar di halaman web untuk mengisinya.'));
  } else {
    const all = data.total + (data.tersembunyi || 0);
    parts.push(el('div', { class: 'row' }, el('button', { type: 'button', id: 'hapus-semua', class: 'danger', onclick: () => removeAll(all) }, 'Hapus semua riwayat')));
    const offset = (data.page - 1) * data.limit;
    parts.push(
      el('ul', { class: 'list', 'aria-label': `${data.total} riwayat deskripsi` }, data.items.map((it, i) => renderItem(it, offset + i + 1, data.total))),
    );
    const pages = Math.max(1, Math.ceil(data.total / data.limit));
    if (pages > 1) {
      parts.push(
        el(
          'nav',
          { class: 'pager', 'aria-label': 'Halaman riwayat' },
          el('button', { type: 'button', disabled: state.page <= 1, onclick: () => go(-1) }, 'Sebelumnya'),
          el('span', {}, `Halaman ${state.page} dari ${pages}`),
          el('button', { type: 'button', disabled: state.page >= pages, onclick: () => go(1) }, 'Berikutnya'),
        ),
      );
    }
  }
  content.replaceChildren(...parts);
}

function go(delta) {
  state.page += delta;
  load().then(() => $('main').focus());
}

// UC-RWY-03: detail satu riwayat + putar ulang suara.
async function loadDetail(id) {
  let item;
  try {
    item = await apiFetch(`/history/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status === 404) {
      $('content').replaceChildren(el('p', { class: 'card' }, 'Riwayat tidak ditemukan. Mungkin sudah dihapus atau lebih dari 7 hari (akun Gratis). ', el('a', { href: 'riwayat.html' }, 'Kembali ke daftar riwayat')));
      say(err.message, 'error');
    } else {
      sayError(err, () => loadDetail(id));
    }
    return;
  }
  const holder = el('div');
  const link = (url) => (url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, url) : '-');
  $('content').replaceChildren(
    el(
      'article',
      { class: 'card stack', 'aria-labelledby': 'detail-title' },
      el('h2', { id: 'detail-title' }, `Deskripsi · ${fmtDateTime(item.waktu_dibuat)}`),
      el('p', { class: 'text', id: 'detail-text' }, item.teks_deskripsi),
      el(
        'dl',
        { class: 'kv' },
        el('dt', {}, 'Jenis gambar'), el('dd', { id: 'detail-jenis' }, jenisLabel(item.jenis_gambar)),
        el('dt', {}, 'Dibuat oleh'), el('dd', {}, providerLabel(item.provider)),
        el('dt', {}, 'Waktu'), el('dd', {}, fmtDateTime(item.waktu_dibuat)),
        el('dt', {}, 'Halaman'), el('dd', {}, link(item.url_halaman)),
        el('dt', {}, 'Alamat gambar'), el('dd', {}, link(item.url_gambar)),
      ),
      actions(item, holder, { inDetail: true }),
      holder,
    ),
    el('p', {}, el('a', { href: 'riwayat.html' }, 'Kembali ke daftar riwayat')),
  );
  document.querySelector('.replay').focus();
}

(async () => {
  if (!(await requireSession())) return;
  if (detailId) await loadDetail(detailId);
  else await load();
})();
