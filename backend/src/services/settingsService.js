import { Errors } from '../lib/errors.js';
import * as v from '../lib/validate.js';

/**
 * Pengaturan aksesibilitas & TTS: RF-17..RF-19 (UC-AKS-01..03).
 * ADR-10: Gratis → suara default, kecepatan bisa diatur.
 *         Premium → semua suara di perangkat + pengaturan nada.
 */

// Pintasan yang dipakai browser Chrome atau pembaca layar umum (NVDA/JAWS) — UC-AKS-02 alur alternatif.
const RESERVED_SHORTCUTS = new Set(
  [
    'Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W', 'Ctrl+L', 'Ctrl+D',
    'Ctrl+H', 'Ctrl+J', 'Ctrl+P', 'Ctrl+S', 'Ctrl+F', 'Ctrl+R', 'Ctrl+O', 'Ctrl+U', 'Ctrl+Shift+B',
    'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C', 'Ctrl+Shift+Delete', 'Ctrl+Shift+O', 'Ctrl+Shift+Q',
    'Alt+F', 'Alt+E', 'Alt+D', 'Alt+Home', 'Alt+Left', 'Alt+Right', 'Ctrl+Alt+N', 'Ctrl+Alt+Z',
    'Command+T', 'Command+W', 'Command+N', 'Command+L', 'Command+Q', 'Command+R',
  ].map((s) => s.toUpperCase()),
);
const SHORTCUT_RE = /^(Ctrl|Alt|Command|MacCtrl)(\+(Shift|Alt|Ctrl))?(\+(Shift))?\+([A-Z0-9])$/i;

export function normalizeShortcut(value) {
  const parts = String(value).split('+').map((p) => p.trim());
  const key = parts.pop().toUpperCase();
  const order = ['Ctrl', 'Command', 'MacCtrl', 'Alt', 'Shift'];
  const mods = [...new Set(parts.map((p) => order.find((o) => o.toLowerCase() === p.toLowerCase()) ?? p))];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, key].join('+');
}

export function createSettingsService({ db }) {
  const mapRow = (r, premium) => ({
    bahasa_deskripsi: r.bahasa_deskripsi,
    pintasan_keyboard: r.pintasan_keyboard,
    kecepatan_suara: Number(r.kecepatan_suara),
    nada_suara: premium ? Number(r.nada_suara) : 1.0,
    jenis_suara: premium ? r.jenis_suara : null,
    fitur_premium: premium,
  });

  async function ensureRow(userId) {
    let row = await db.get('SELECT * FROM pengaturan_aksesibilitas WHERE user_id = ?', [userId]);
    if (!row) {
      try {
        await db.run('INSERT INTO pengaturan_aksesibilitas (user_id) VALUES (?)', [userId]);
      } catch (err) {
        if (!err.isDuplicate) throw err;
      }
      row = await db.get('SELECT * FROM pengaturan_aksesibilitas WHERE user_id = ?', [userId]);
    }
    return row;
  }

  // UC-AKS-01
  async function get(userId, premium) {
    return mapRow(await ensureRow(userId), premium);
  }

  // UC-AKS-02 & UC-AKS-03
  async function update(userId, premium, body) {
    await ensureRow(userId);
    const changes = {};

    const bahasa = v.oneOf(body, 'bahasa_deskripsi', ['id', 'en'], { label: 'Bahasa deskripsi', optional: true });
    if (bahasa !== undefined) changes.bahasa_deskripsi = bahasa;

    if (body?.pintasan_keyboard !== undefined) {
      const raw = v.str(body, 'pintasan_keyboard', { label: 'Pintasan keyboard', max: 50 });
      if (!SHORTCUT_RE.test(normalizeShortcut(raw))) {
        throw Errors.validation(
          'pintasan_keyboard',
          'Format pintasan tidak valid. Contoh yang benar: Alt+Shift+K atau Ctrl+Shift+Y.',
        );
      }
      const shortcut = normalizeShortcut(raw);
      if (RESERVED_SHORTCUTS.has(shortcut.toUpperCase())) throw Errors.shortcutConflict(shortcut);
      changes.pintasan_keyboard = shortcut;
    }

    const kecepatan = v.num(body, 'kecepatan_suara', { label: 'Kecepatan suara', min: 0.5, max: 2.0, optional: true });
    if (kecepatan !== undefined) changes.kecepatan_suara = kecepatan;

    const nada = v.num(body, 'nada_suara', { label: 'Nada suara', min: 0.5, max: 2.0, optional: true });
    if (nada !== undefined) {
      if (!premium && nada !== 1.0) throw Errors.premiumRequired('Pengaturan nada suara');
      changes.nada_suara = nada;
    }

    if (body && 'jenis_suara' in body) {
      const suara = body.jenis_suara === null || body.jenis_suara === ''
        ? null
        : v.str(body, 'jenis_suara', { label: 'Jenis suara', max: 100 });
      if (!premium && suara !== null) throw Errors.premiumRequired('Pilihan jenis suara');
      changes.jenis_suara = suara;
    }

    const fields = Object.keys(changes);
    if (fields.length) {
      await db.run(
        `UPDATE pengaturan_aksesibilitas SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE user_id = ?`,
        [...fields.map((f) => changes[f]), userId],
      );
    }
    return get(userId, premium);
  }

  return { get, update };
}
