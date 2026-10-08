// Riwayat deskripsi: RF-14..RF-16, RF-20 (UC-RWY-02..04, UC-LAP-01)
import { apiFetch } from '../shared/config.js';
import { $, el, fmtDateTime, requireSession, say, shell, speak, stopSpeaking } from './common.js';

shell('riwayat', 'Riwayat deskripsi');
const state = { page: 1, limit: 10 };

function reportForm(item, holder) {
  const id = `alasan-${item.riwayat_id}`;
  const area = el('textarea', { id, rows: 3, maxlength: 1000 });
  const form = el(
    'form',
    { class: 'stack' },
    el('label', { for: id }, 'Apa yang tidak akurat dari deskripsi ini?'),
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
    if (!area.value.trim()) {
      say('Alasan pelaporan wajib diisi.', 'error');
      area.focus();
      return;
    }
    try {
      await apiFetch('/reports', { method: 'POST', body: { riwayat_id: item.riwayat_id, alasan: area.value } });
      form.remove();
      say('Terima kasih. Laporan Anda sudah dikirim dan akan ditinjau Admin.', 'ok');
    } catch (err) {
      say(err.message, 'error');
    }
  });
  holder.append(form);
  area.focus();
}

function renderItem(item, index, total) {
  const holder = el('div');
  const headingId = `h-${item.riwayat_id}`;
  const art = el(
    'li',
    { class: 'item' },
    el(
      'article',
      { 'aria-labelledby': headingId },
      el('h2', { id: headingId }, `Deskripsi ${index} dari ${total} · ${fmtDateTime(item.waktu_dibuat)}`),
      el('p', { class: 'text' }, item.teks_deskripsi),
      el(
        'p',
        { class: 'meta' },
        'Halaman: ',
        item.url_halaman ? el('a', { href: item.url_halaman, target: '_blank', rel: 'noopener' }, item.url_halaman) : '-',
      ),
      el(
        'div',
        { class: 'row' },
        el('button', { type: 'button', onclick: () => speak(item.teks_deskripsi) }, 'Putar ulang'),
        el('button', { type: 'button', onclick: stopSpeaking }, 'Berhenti'),
        el('button', { type: 'button', onclick: () => reportForm(item, holder) }, 'Laporkan'),
        el('button', { type: 'button', onclick: () => remove(item) }, 'Hapus'),
      ),
      holder,
    ),
  );
  return art;
}

async function remove(item) {
  // UC-RWY-04: konfirmasi sebelum menghapus
  if (!window.confirm(`Hapus deskripsi "${item.teks_deskripsi}" dari riwayat?`)) {
    say('Penghapusan dibatalkan.');
    return;
  }
  try {
    await apiFetch(`/history/${item.riwayat_id}`, { method: 'DELETE' });
    say('Riwayat berhasil dihapus.', 'ok');
    await load();
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
    say(err.message, 'error');
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

(async () => {
  if (!(await requireSession())) return;
  await load();
})();
