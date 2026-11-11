// NaraVisi · extension/shared/guide.js
// Fungsi   : Kalimat pemandu suara bersama & pintasan aktif.
// Kebutuhan: RF-18, PF-01
// Terkait  : background.js, popup/popup.js, pages/pengaturan.js, pages/selamat-datang.js

export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

// [RF-18] Ubah bahasa & pintasan — membaca pintasan yang benar-benar aktif (chrome.commands.getAll)
/** Pintasan yang sedang berlaku untuk sebuah perintah (bawaan: pemindai), mis. "Alt+Shift+K"; '' bila belum diatur. */
export async function currentShortcut(name = 'scan-page') {
  const [cmd] = (await chrome.commands.getAll()).filter((c) => c.name === name);
  return cmd?.shortcut || '';
}

/** Pintasan pemindai dalam bentuk yang enak dibacakan, mis. "Alt Shift K"; null bila belum diatur. */
export async function spokenShortcut() {
  const shortcut = await currentShortcut();
  return shortcut ? shortcut.split('+').join(' ') : null;
}

// [RF-18] Ubah bahasa & pintasan — membuka chrome://extensions/shortcuts untuk mengubah pintasan
/** Chrome hanya mengizinkan pintasan diubah dari halaman pintasannya sendiri. */
export function openShortcutsPage() {
  return chrome.tabs.create({ url: SHORTCUTS_URL });
}

/** "Tekan Alt Shift K untuk …", atau "Pintasan belum diatur" + petunjuk ikon toolbar. */
export function pressHint(shortcut, action, where = '') {
  return shortcut
    ? `Tekan ${shortcut}${where} untuk ${action}.`
    : `Pintasan belum diatur. Klik ikon NaraVisi di toolbar untuk ${action}.`;
}

// [PF-01] Pemandu suara — kalimat sambutan saat pertama dipasang
export function welcomeText(shortcut) {
  return (
    'Selamat datang di NaraVisi. Tekan Tab untuk masuk atau mendaftar. Setelah masuk: ' +
    pressHint(shortcut, 'mendengar deskripsi gambar', ' di halaman mana pun')
  );
}

export function greetingText(user, shortcut) {
  const quota =
    user.kuota && user.kuota.batas != null
      ? `Jatah gratis hari ini ${user.kuota.sisa} gambar.`
      : 'Kuota tanpa batas.';
  return `Berhasil masuk sebagai ${user.nama}. ${quota} ${pressHint(shortcut, 'memindai gambar')}`;
}

// [PF-01] Pemandu suara — kalimat jumlah gambar di halaman
export function imageCountText(count, shortcut) {
  return `Ada ${count} gambar. ${pressHint(shortcut, 'mendengar deskripsinya')}`;
}

/** Dari halaman extension (popup, tab sambutan): minta service worker membacakan teks. */
export function speakGuide(text) {
  return chrome.runtime.sendMessage({ type: 'NV_SPEAK', text }).catch(() => undefined);
}
