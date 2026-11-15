// NaraVisi · extension/shared/warna.js
// Fungsi   : Logika murni warna dominan (PF-08): kuantisasi median-cut buatan sendiri pada gambar kecil ±64×64,
//            pemberian nama warna Indonesia (contoh terdekat di ruang CIELAB), dan kalimat "Warna dominan: …".
//            Tanpa API browser, jadi bisa diuji langsung dengan Node. Tidak ada gambar yang dikirim ke server.
// Kebutuhan: PF-08
// Terkait  : offscreen/deteksi-objek.js (pemanggil), shared/warna-id.json (kamus warna), shared/lapis-lokal.js

/** Porsi minimum (bagian dari piksel) agar sebuah warna disebut. */
export const PORSI_MIN = 0.15;
/** Paling banyak warna yang disebut. */
export const MAKS_WARNA = 2;
/** Jumlah kotak median-cut (palet sementara sebelum diberi nama). */
export const JUMLAH_KOTAK = 8;

// [PF-08] Warna dominan — sRGB → CIELAB (D65), agar "terdekat" sesuai penglihatan manusia, bukan jarak RGB mentah
export function keLab([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// [PF-08] Warna dominan — kuantisasi median-cut: belah kotak warna terlebar di median sampai `k` kotak
/**
 * @param {Uint8ClampedArray|number[]} rgba  piksel RGBA (mis. ImageData.data 64×64); piksel hampir transparan diabaikan
 * @returns {Array<{rgb: number[], porsi: number}>}  warna rata-rata tiap kotak dan porsinya (0–1), urut porsi terbesar
 */
export function kuantisasi(rgba, k = JUMLAH_KOTAK) {
  const piksel = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    piksel.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (!piksel.length) return [];
  const rentang = (kotak) => {
    let terlebar = 0;
    let kanal = 0;
    for (let c = 0; c < 3; c++) {
      let min = 255;
      let max = 0;
      for (const p of kotak) {
        if (p[c] < min) min = p[c];
        if (p[c] > max) max = p[c];
      }
      if (max - min > terlebar) [terlebar, kanal] = [max - min, c];
    }
    return { terlebar, kanal };
  };
  let kotak = [piksel];
  while (kotak.length < k) {
    // Kotak yang dibelah: rentang warna × jumlah piksel terbesar (kotak polos tidak dibelah).
    let pilih = -1;
    let nilai = 0;
    let kanalPilih = 0;
    kotak.forEach((kt, i) => {
      if (kt.length < 2) return;
      const { terlebar, kanal } = rentang(kt);
      const n = terlebar * kt.length;
      if (terlebar > 0 && n > nilai) [pilih, nilai, kanalPilih] = [i, n, kanal];
    });
    if (pilih < 0) break;
    const urut = kotak[pilih].sort((a, b) => a[kanalPilih] - b[kanalPilih]);
    const tengah = Math.floor(urut.length / 2);
    kotak.splice(pilih, 1, urut.slice(0, tengah), urut.slice(tengah));
  }
  kotak = kotak.filter((kt) => kt.length);
  return kotak
    .map((kt) => {
      const jumlah = [0, 0, 0];
      for (const p of kt) for (let c = 0; c < 3; c++) jumlah[c] += p[c];
      return { rgb: jumlah.map((v) => Math.round(v / kt.length)), porsi: kt.length / piksel.length };
    })
    .sort((a, b) => b.porsi - a.porsi);
}

// [PF-08] Warna dominan — nama warna Indonesia dari contoh terdekat (jarak CIELAB) di shared/warna-id.json
export function namaWarna(rgb, kamus) {
  const lab = keLab(rgb);
  let terbaik = null;
  let jarak = Infinity;
  for (const [nama, contoh] of Object.entries(kamus ?? {})) {
    if (!Array.isArray(contoh)) continue; // lewati "_keterangan"
    for (const c of contoh) {
      const l = keLab(c);
      const d = (l[0] - lab[0]) ** 2 + (l[1] - lab[1]) ** 2 + (l[2] - lab[2]) ** 2;
      if (d < jarak) [terbaik, jarak] = [nama, d];
    }
  }
  return terbaik;
}

// [PF-08] Warna dominan — gabungkan kotak bernama sama, ambil maks. 2 warna dengan porsi ≥ 15%
/** @returns {Array<{nama: string, porsi: number}>} */
export function warnaDominan(rgba, kamus, { porsiMin = PORSI_MIN, maks = MAKS_WARNA } = {}) {
  const perNama = new Map();
  for (const { rgb, porsi } of kuantisasi(rgba)) {
    const nama = namaWarna(rgb, kamus);
    if (nama) perNama.set(nama, (perNama.get(nama) ?? 0) + porsi);
  }
  return [...perNama]
    .map(([nama, porsi]) => ({ nama, porsi: Math.round(porsi * 1000) / 1000 }))
    .filter((w) => w.porsi >= porsiMin)
    .sort((a, b) => b.porsi - a.porsi || a.nama.localeCompare(b.nama, 'id'))
    .slice(0, maks);
}

// [PF-08] Warna dominan — kalimat "Warna dominan: biru dan putih." (tanpa warna → null)
/** @param {Array<{nama: string}|string>} warna */
export function kalimatWarna(warna) {
  const nama = (warna ?? []).map((w) => (typeof w === 'string' ? w : w?.nama)).filter(Boolean);
  if (!nama.length) return null;
  return `Warna dominan: ${nama.join(' dan ')}.`;
}
