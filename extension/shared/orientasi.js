// NaraVisi · extension/shared/orientasi.js
// Fungsi   : Logika murni orientasi gambar (PF-09): mendatar / tegak / persegi dari rasio lebar ÷ tinggi, dan kalimatnya.
//            Tanpa API browser, jadi bisa diuji langsung dengan Node.
// Kebutuhan: PF-09
// Terkait  : offscreen/deteksi-objek.js (lebar & tinggi), shared/lapis-lokal.js (kalimat benda & cadangan)

/** Rasio ≥ 1,15 = mendatar; ≤ 1/1,15 = tegak; di antaranya = persegi (toleransi potongan kecil). */
export const BATAS_RASIO = 1.15;

// [PF-09] Orientasi — rasio lebar ÷ tinggi → 'mendatar' | 'tegak' | 'persegi' (ukuran tidak sah → null)
export function orientasi(lebar, tinggi) {
  const w = Number(lebar);
  const h = Number(tinggi);
  if (!(w > 0) || !(h > 0)) return null;
  const r = w / h;
  if (r >= BATAS_RASIO) return 'mendatar';
  if (r <= 1 / BATAS_RASIO) return 'tegak';
  return 'persegi';
}

// [PF-09] Orientasi — kalimat "Gambar mendatar." (tanpa orientasi → null)
export function kalimatOrientasi(o) {
  return ['mendatar', 'tegak', 'persegi'].includes(o) ? `Gambar ${o}.` : null;
}
