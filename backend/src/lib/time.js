/** Tanggal "YYYY-MM-DD" pada zona waktu tertentu (default WITA). */
export function dateInTz(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** DATETIME UTC "YYYY-MM-DD HH:MM:SS" untuk disimpan di basis data. */
export function toSqlDateTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Menambah n hari ke tanggal "YYYY-MM-DD". */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** DATETIME UTC dari basis data → ISO 8601 untuk respons API. */
export function sqlToIso(value) {
  if (!value) return null;
  const s = String(value);
  return s.length === 10 ? s : `${s.replace(' ', 'T')}Z`;
}

export function systemClock() {
  return { now: () => new Date() };
}
