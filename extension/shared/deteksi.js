// NaraVisi · extension/shared/deteksi.js
// Fungsi   : Logika murni deteksi objek lokal: saring skor, terjemahkan label COCO, gabungkan jumlah per jenis,
//            penyaring gambar hampir polos, kalimat kilat & kalimat cadangan (tanpa AI).
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

/** Simpangan baku warna rata-rata (0–255) di bawah ini = gambar hampir polos. Diukur pada gambar 64×64 px. */
export const AMBANG_POLOS = 12;

// [PF-05] Deteksi objek lokal — mengukur keragaman warna (simpangan baku R, G, B rata-rata) untuk penyaring
/** @param {Uint8ClampedArray|number[]} rgba  piksel RGBA (mis. ImageData.data); piksel transparan diabaikan */
export function variansiWarna(rgba) {
  const jumlah = [0, 0, 0];
  const kuadrat = [0, 0, 0];
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      jumlah[c] += rgba[i + c];
      kuadrat[c] += rgba[i + c] * rgba[i + c];
    }
    n += 1;
  }
  if (!n) return 0;
  const sb = [0, 1, 2].map((c) => Math.sqrt(Math.max(0, kuadrat[c] / n - (jumlah[c] / n) ** 2)));
  return (sb[0] + sb[1] + sb[2]) / 3;
}

// [PF-05] Deteksi objek lokal — penyaring: tanpa objek DAN hampir polos → dilewati Mode Baca Berurutan
/** Hanya dipakai mode otomatis; pemilihan manual selalu dikirim ke AI. */
export function layakDilewati(hasil) {
  return Boolean(hasil && Array.isArray(hasil.objek) && hasil.objek.length === 0 && hasil.polos === true);
}

// [PF-05] Deteksi objek lokal — kalimat deskripsi kilat yang dibacakan sambil menunggu AI
/** Tanpa objek → null (tidak ada yang dibacakan). */
export function kalimatKilat(hasil) {
  return hasil?.kalimat ? `Kemungkinan berisi: ${hasil.kalimat}.` : null;
}

// [PF-05] Deteksi objek lokal — kalimat cadangan saat server/AI gagal, kuota habis, atau offline
/** Hasil deteksi tidak ada (detektor gagal) → null, sehingga pesan galat biasa yang dipakai. */
export function kalimatSederhana(hasil) {
  if (!hasil) return null;
  let isi;
  if (hasil.kalimat) isi = `kemungkinan berisi ${hasil.kalimat}.`;
  else if (hasil.polos) isi = 'gambar hampir polos, tidak ada benda yang dikenali.';
  else isi = 'tidak ada benda yang dikenali.';
  return `Deskripsi sederhana (tanpa AI): ${isi}`;
}
