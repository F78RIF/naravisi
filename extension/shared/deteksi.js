// NaraVisi · extension/shared/deteksi.js
// Fungsi   : Logika murni deteksi objek lokal: saring skor, terjemahkan label COCO, gabungkan jumlah per jenis.
//            Tanpa API browser, jadi bisa diuji langsung dengan Node.
// Kebutuhan: PF-05
// Terkait  : offscreen/deteksi-objek.js (pemanggil), shared/label-id.json (kamus label), background.js

/** Skor minimum agar sebuah objek disebut. */
export const SKOR_MIN = 0.5;
/** Paling banyak jenis objek yang disebut dalam satu ringkasan. */
export const MAKS_JENIS = 5;

// [PF-05] Deteksi objek lokal — menerjemahkan label COCO ke bahasa Indonesia; label tak dikenal tidak disebut
/** Label tidak dikenal (mis. "???" di label map model) → null, supaya tidak pernah dibacakan dalam bahasa Inggris. */
export function terjemahkanLabel(label, kamus) {
  const key = String(label ?? '').trim().toLowerCase();
  return Object.hasOwn(kamus ?? {}, key) ? kamus[key] : null;
}

// [PF-05] Deteksi objek lokal — menyaring skor ≥ 0,5 lalu menggabungkan jumlah per jenis (maks. 5 jenis)
/**
 * @param {Array<{label: string, score: number}>} deteksi  hasil detektor (satu entri per objek)
 * @param {Record<string, string>} kamus                   isi shared/label-id.json
 * @returns {Array<{nama: string, jumlah: number, skor: number}>}  urut: jumlah terbanyak, lalu skor tertinggi
 */
export function gabungkanObjek(deteksi, kamus, { skorMin = SKOR_MIN, maksJenis = MAKS_JENIS } = {}) {
  const perJenis = new Map();
  for (const d of deteksi ?? []) {
    const skor = Number(d?.score);
    if (!Number.isFinite(skor) || skor < skorMin) continue;
    const nama = terjemahkanLabel(d.label, kamus);
    if (!nama) continue;
    const entri = perJenis.get(nama) ?? { nama, jumlah: 0, skor: 0 };
    entri.jumlah += 1;
    entri.skor = Math.max(entri.skor, skor);
    perJenis.set(nama, entri);
  }
  return [...perJenis.values()]
    .sort((a, b) => b.jumlah - a.jumlah || b.skor - a.skor || a.nama.localeCompare(b.nama, 'id'))
    .slice(0, maksJenis);
}

// [PF-05] Deteksi objek lokal — menyusun kalimat "2 orang, 1 sepeda" (hanya jumlah, tanpa menebak identitas)
/** Daftar kosong → string kosong. */
export function kalimatObjek(objek) {
  return (objek ?? []).map((o) => `${o.jumlah} ${o.nama}`).join(', ');
}
