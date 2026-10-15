// Kalimat pemandu suara bersama (dibacakan service worker lewat chrome.tts).

/** Pintasan pemindai dalam bentuk yang enak dibacakan, mis. "Alt Shift N"; null bila belum diatur. */
export async function spokenShortcut() {
  const [cmd] = (await chrome.commands.getAll()).filter((c) => c.name === 'scan-page');
  return cmd?.shortcut ? cmd.shortcut.split('+').join(' ') : null;
}

/** "tekan Alt Shift N untuk …", atau petunjuk ikon toolbar bila pintasan belum diatur. */
export function pressHint(shortcut, action, where = '') {
  return shortcut
    ? `tekan ${shortcut}${where} untuk ${action}.`
    : `klik ikon NaraVisi di toolbar untuk ${action}.`;
}

export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function welcomeText(shortcut) {
  return (
    'Selamat datang di NaraVisi. Tekan Tab untuk masuk atau mendaftar. Setelah masuk, ' +
    pressHint(shortcut, 'mendengar deskripsi gambar', ' di halaman mana pun')
  );
}

export function greetingText(user, shortcut) {
  const quota =
    user.kuota && user.kuota.batas != null
      ? `Jatah gratis hari ini ${user.kuota.sisa} gambar.`
      : 'Kuota tanpa batas.';
  return `Berhasil masuk sebagai ${user.nama}. ${quota} ${capitalize(pressHint(shortcut, 'memindai gambar'))}`;
}

export function imageCountText(count, shortcut) {
  return `Ada ${count} gambar. ${capitalize(pressHint(shortcut, 'mendengar deskripsinya'))}`;
}

/** Dari halaman extension (popup, tab sambutan): minta service worker membacakan teks. */
export function speakGuide(text) {
  return chrome.runtime.sendMessage({ type: 'NV_SPEAK', text }).catch(() => undefined);
}
