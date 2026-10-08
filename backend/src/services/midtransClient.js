import { createHash } from 'node:crypto';
import { Errors } from '../lib/errors.js';

/**
 * Klien Midtrans Snap (SRS 3.4 no.3). Tanpa server key → mode simulasi untuk demo lokal.
 * Dok: https://docs.midtrans.com (Snap API, HTTP Notification, Status API).
 */
export function createMidtransClient({ serverKey, isProduction, fetchImpl = globalThis.fetch }) {
  const enabled = Boolean(serverKey);
  const snapBase = isProduction ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
  const apiBase = isProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
  const authHeader = `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;

  async function call(url, init = {}) {
    let res;
    try {
      res = await fetchImpl(url, {
        ...init,
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: authHeader },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw Errors.paymentGateway();
    }
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  async function createTransaction({ orderId, amount, itemName, itemId, customer, finishUrl }) {
    const { status, body } = await call(`${snapBase}/snap/v1/transactions`, {
      method: 'POST',
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: amount },
        item_details: [{ id: String(itemId), price: amount, quantity: 1, name: itemName.slice(0, 50) }],
        customer_details: { first_name: customer.nama.slice(0, 255), email: customer.email },
        callbacks: { finish: finishUrl },
      }),
    });
    if (status !== 201 || !body?.redirect_url) throw Errors.paymentGateway();
    return { token: body.token, redirectUrl: body.redirect_url };
  }

  async function getStatus(orderId) {
    const { status, body } = await call(`${apiBase}/v2/${encodeURIComponent(orderId)}/status`);
    if (status === 404 || body?.status_code === '404') return null; // belum dibayar / belum dibuat
    if (status >= 400 || !body) throw Errors.paymentGateway();
    return body;
  }

  /** signature_key = SHA512(order_id + status_code + gross_amount + server_key) */
  function verifySignature(n) {
    if (!n?.signature_key) return false;
    const expected = createHash('sha512')
      .update(`${n.order_id}${n.status_code}${n.gross_amount}${serverKey}`)
      .digest('hex');
    return expected === n.signature_key;
  }

  return { enabled, createTransaction, getStatus, verifySignature };
}

/** Status Midtrans → status_pembayaran NaraVisi. */
export function mapMidtransStatus(n) {
  switch (n?.transaction_status) {
    case 'settlement':
      return 'berhasil';
    case 'capture':
      return !n.fraud_status || n.fraud_status === 'accept' ? 'berhasil' : 'menunggu';
    case 'pending':
      return 'menunggu';
    case 'expire':
      return 'kedaluwarsa';
    case 'deny':
    case 'cancel':
    case 'failure':
      return 'gagal';
    default:
      return null;
  }
}
