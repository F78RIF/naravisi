// Halaman HTML kecil yang disajikan backend (selesai bayar & simulasi pembayaran).

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, body) {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — NaraVisi</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: #f4f6fa; color: #111; }
  main { max-width: 520px; margin: 40px auto; padding: 28px; background: #fff; border: 2px solid #111; border-radius: 14px; }
  h1 { margin-top: 0; font-size: 24px; }
  .sim-banner { margin: -28px -28px 20px; padding: 8px; background: #8a1c00; color: #fff; font-weight: 700; letter-spacing: .2em; text-align: center; border-radius: 12px 12px 0 0; }
  .note { padding: 10px 14px; background: #fff4d6; border-left: 5px solid #b07800; border-radius: 6px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
  button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 2px solid #111; background: #fff; cursor: pointer; }
  button.primary { background: #0b57d0; border-color: #0b57d0; color: #fff; font-weight: 600; }
  button:focus-visible, a:focus-visible { outline: 3px solid #f2a900; outline-offset: 2px; }
</style></head>
<body><main>${body}</main></body></html>`;
}

const rupiah = (n) => `Rp${Number(n).toLocaleString('id-ID')}`;

/**
 * RF-24: halaman bayar mode simulasi. Kata "SIMULASI" ada di judul tab, judul halaman, kotak peringatan, dan setiap
 * tombol, sehingga pembaca layar mengucapkannya di mana pun pengguna mendarat. Tidak ada uang yang ditagih.
 */
export function simulatePage(trx) {
  const done = trx.status_pembayaran !== 'menunggu';
  return layout(
    'SIMULASI pembayaran',
    `<p class="sim-banner" aria-hidden="true">SIMULASI</p>
     <h1>SIMULASI — pembayaran Premium (bukan pembayaran sungguhan)</h1>
     <p class="note" id="sim-note"><strong>Ini halaman SIMULASI.</strong> Server berjalan tanpa kunci Midtrans,
     jadi halaman ini menggantikan halaman pembayaran untuk keperluan demo. Tidak ada uang yang ditagih.</p>
     <dl>
       <dt>Order</dt><dd>${esc(trx.order_id)}</dd>
       <dt>Paket</dt><dd>Premium ${esc(trx.nama_paket)}</dd>
       <dt>Jumlah</dt><dd>${rupiah(trx.jumlah)} (simulasi, tidak ditagih)</dd>
       <dt>Akun</dt><dd>${esc(trx.email ?? '-')}</dd>
       <dt>Status</dt><dd id="status">${esc(trx.status_pembayaran)}</dd>
     </dl>
     ${
       done
         ? '<p>Transaksi ini sudah diproses. Anda dapat menutup tab ini dan kembali ke NaraVisi.</p>'
         : `<form method="post" class="actions">
              <button class="primary" name="hasil" value="berhasil" type="submit" aria-describedby="sim-note">SIMULASI: bayar berhasil</button>
              <button name="hasil" value="gagal" type="submit" aria-describedby="sim-note">SIMULASI: pembayaran gagal</button>
            </form>`
     }`,
  );
}

export function simulateResultPage(status) {
  const ok = status === 'berhasil';
  const title = ok ? 'SIMULASI: Pembayaran berhasil' : 'SIMULASI: Pembayaran gagal';
  return layout(
    title,
    `<p class="sim-banner" aria-hidden="true">SIMULASI</p>
     <h1 role="status">${title}</h1>
     <p>${
       ok
         ? 'Akun Anda sekarang berstatus Premium (hasil simulasi, tidak ada uang yang ditagih). Tutup tab ini dan kembali ke NaraVisi.'
         : 'Status akun tetap Gratis. Anda dapat mencoba lagi dari menu Premium di NaraVisi.'
     }</p>`,
  );
}

export function finishPage() {
  return layout(
    'Pembayaran diproses',
    `<h1 role="status">Terima kasih</h1>
     <p>Pembayaran Anda sedang diproses. Tutup tab ini lalu buka menu <strong>Premium</strong> di NaraVisi
     untuk melihat status langganan.</p>`,
  );
}

export function errorPage(message) {
  return layout('Tidak ditemukan', `<h1>Tidak ditemukan</h1><p>${esc(message)}</p>`);
}
