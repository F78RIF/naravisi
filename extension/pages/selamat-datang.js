// Tab sambutan: form Masuk/Daftar yang sama dengan popup (shared/auth-forms.js).
import { mountAuthForms } from '../shared/auth-forms.js';
import { getSession } from '../shared/config.js';
import { currentShortcut, openShortcutsPage } from '../shared/guide.js';
import { $, say } from './common.js';

function showMember(text) {
  $('guest').hidden = true;
  $('member').hidden = false;
  $('member-text').textContent = text;
  $('member-title').focus();
}

$('set-shortcut').addEventListener('click', () => openShortcutsPage());

mountAuthForms($('auth'), { say, headingLevel: 3, onSuccess: (_user, greeting) => showMember(greeting) });

(async () => {
  const shortcut = await currentShortcut();
  $('shortcut').textContent = shortcut || 'pintasan NaraVisi (belum diatur)';
  $('shortcut-missing').hidden = Boolean(shortcut);

  const session = await getSession();
  if (session?.token && session.user) {
    showMember(`Anda sudah masuk sebagai ${session.user.nama}.`);
  } else if (location.hash === '#masuk') {
    $('login-email').focus(); // dibuka karena belum/tidak lagi masuk
  } else {
    $('title').focus(); // pertama kali dipasang; Tab berikutnya langsung ke kolom Email
  }
})();
