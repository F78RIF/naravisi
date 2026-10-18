// Kalimat pemandu suara bersama (dibacakan service worker lewat chrome.tts).

export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

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

export function imageCountText(count, shortcut) {
  return `Ada ${count} gambar. ${pressHint(shortcut, 'mendengar deskripsinya')}`;
}

/** Dari halaman extension (popup, tab sambutan): minta service worker membacakan teks. */
export function speakGuide(text) {
  return chrome.runtime.sendMessage({ type: 'NV_SPEAK', text }).catch(() => undefined);
}
