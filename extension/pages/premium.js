// Premium & pembayaran: RF-23..RF-26 (UC-PRM-01..04)
import { apiFetch, refreshProfile, refreshTts } from '../shared/config.js';
import { $, el, fmtDate, requireSession, rupiah, say, shell } from './common.js';

shell('premium', 'NaraVisi Premium');

const STATUS_LABEL = { menunggu: 'Menunggu pembayaran', berhasil: 'Berhasil', gagal: 'Gagal', kedaluwarsa: 'Kedaluwarsa' };
let pollTimer = null;

function statusCard(sub) {
  return el(
    'section',
    { class: 'card', 'aria-labelledby': 'st-title' },
    el('h2', { id: 'st-title' }, 'Status langganan'),
    sub.premium
      ? el(
          'dl',
          { class: 'kv' },
          el('dt', {}, 'Status'), el('dd', {}, el('span', { class: 'badge premium' }, 'Premium')),
          el('dt', {}, 'Berlaku hingga'), el('dd', { id: 'berlaku' }, fmtDate(sub.berlaku_hingga)),
        )
      : el('p', {}, el('span', { class: 'badge gratis' }, 'Gratis'), ' — kuota 10 deskripsi per hari dan riwayat 7 hari terakhir.'),
    sub.riwayat?.length
      ? el(
          'details',
          {},
          el('summary', {}, `Riwayat langganan (${sub.riwayat.length})`),
          el('ul', {}, sub.riwayat.map((r) => el('li', {}, `${r.nama_paket}: ${fmtDate(r.tanggal_mulai)} – ${fmtDate(r.tanggal_berakhir)}${r.order_id ? ` (order ${r.order_id})` : ''}`))),
        )
      : null,
  );
}

function planCard(plan, premium, mode) {
  const btn = el('button', { type: 'button', class: 'primary', id: `buy-${plan.paket_id}` }, premium ? `Perpanjang ${plan.durasi_hari} hari` : `Beli Premium ${plan.nama_paket}`);
  btn.addEventListener('click', () => buy(plan, btn));
  return el(
    'section',
    { class: 'card plan', 'aria-labelledby': `plan-${plan.paket_id}` },
    el('h2', { id: `plan-${plan.paket_id}` }, `Paket ${plan.nama_paket}`),
    el('p', { class: 'price' }, rupiah(plan.harga), el('small', {}, ` / ${plan.durasi_hari} hari`)),
    el('ul', { class: 'benefits' }, plan.manfaat.map((m) => el('li', {}, m))),
    mode === 'simulasi'
      ? el('p', { class: 'hint' }, 'Server berjalan dalam mode simulasi pembayaran (demo, tidak ada tagihan).')
      : el('p', { class: 'hint' }, 'Pembayaran diproses Midtrans: QRIS, e-wallet, atau transfer bank.'),
    el('div', { class: 'row' }, btn),
  );
}

async function buy(plan, btn) {
  btn.disabled = true;
  try {
    const pay = await apiFetch('/payments', { method: 'POST', body: { paket_id: plan.paket_id } });
    await chrome.tabs.create({ url: pay.redirect_url });
    showPending(pay);
  } catch (err) {
    say(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function showPending(pay) {
  const check = el('button', { type: 'button', id: 'check-payment', class: 'primary' }, 'Cek status pembayaran');
  const card = el(
    'section',
    { class: 'card', id: 'pending', 'aria-labelledby': 'pending-title' },
    el('h2', { id: 'pending-title' }, 'Menunggu pembayaran'),
    el('p', {}, `Halaman pembayaran untuk order ${pay.order_id} (${rupiah(pay.jumlah)}) sudah dibuka di tab baru. Selesaikan pembayaran di sana, lalu kembali ke halaman ini.`),
    el('p', { id: 'pay-status' }, `Status: ${STATUS_LABEL.menunggu}`),
    el('div', { class: 'row' }, check),
  );
  check.addEventListener('click', () => checkPayment(pay.order_id, true));
  $('content').prepend(card);
  say('Halaman pembayaran dibuka di tab baru.');
  clearInterval(pollTimer);
  const started = Date.now();
  pollTimer = setInterval(() => {
    if (Date.now() - started > 15 * 60 * 1000) clearInterval(pollTimer);
    else checkPayment(pay.order_id, false);
  }, 5000);
}

async function checkPayment(orderId, announce) {
  try {
    const st = await apiFetch(`/payments/${encodeURIComponent(orderId)}`);
    const label = STATUS_LABEL[st.status_pembayaran] ?? st.status_pembayaran;
    const node = $('pay-status');
    if (node) node.textContent = `Status: ${label}`;
    if (st.status_pembayaran === 'berhasil') {
      clearInterval(pollTimer);
      await refreshProfile();
      await refreshTts();
      await load();
      say(`Pembayaran berhasil. Akun Anda Premium hingga ${fmtDate(st.langganan.berlaku_hingga)}.`, 'ok');
    } else if (st.status_pembayaran !== 'menunggu') {
      clearInterval(pollTimer);
      say(`Pembayaran ${label.toLowerCase()}. Status akun tidak berubah.`, 'error');
    } else if (announce) {
      say('Pembayaran belum diterima. Selesaikan pembayaran di tab pembayaran.');
    }
  } catch (err) {
    if (announce) say(err.message, 'error');
  }
}

async function load() {
  const [sub, plans] = await Promise.all([apiFetch('/me/subscription'), apiFetch('/plans', { auth: false })]);
  $('content').replaceChildren(statusCard(sub), ...plans.items.map((p) => planCard(p, sub.premium, plans.mode_pembayaran)));
}

(async () => {
  if (!(await requireSession())) return;
  try {
    await load();
  } catch (err) {
    say(err.message, 'error');
  }
})();

