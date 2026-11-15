// NaraVisi · extension/shared/ocr.js
// Fungsi   : Logika murni teks di gambar (PF-06): menyaring baris hasil Tesseract (keyakinan < 60 dibuang, minimal
//            3 kata bermakna), mengurutkan baris atas→bawah lalu kiri→kanan, memotong maks. 300 karakter, dan menyusun
//            kalimat "Tulisan: "…"." Tanpa API browser, jadi bisa diuji langsung dengan Node.
// Kebutuhan: PF-06
// Terkait  : offscreen/baca-teks.js (Tesseract.js), shared/lapis-lokal.js, background.js

/** Keyakinan minimum (0–100) per baris/kata. */
export const KEYAKINAN_MIN = 60;
/** Jumlah kata bermakna minimum agar teks dibacakan. */
export const KATA_MIN = 3;
/** Panjang teks maksimum yang dibacakan; sisanya "dan teks lainnya". */
export const MAKS_KARAKTER = 300;

// [PF-06] Teks di gambar (OCR) — kata bermakna: ≥ 2 huruf (atau angka ≥ 2 digit), bukan deretan simbol acak
export function kataBermakna(kata) {
  const inti = String(kata ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (inti.length < 2) return false;
  const huruf = (inti.match(/\p{L}/gu) ?? []).length;
  const angka = (inti.match(/\p{N}/gu) ?? []).length;
  if (huruf + angka < inti.length * 0.7) return false; // "a#b%c" dsb.
  if (huruf >= 2) return /[aeiouy]/i.test(inti) || huruf <= 4 || /\p{Lu}{2,}/u.test(inti); // "xkcdqrtz" = derau
  return angka >= 2 && huruf === 0;
}

const tengahY = (b) => (b.y0 + b.y1) / 2;
const tinggi = (b) => Math.max(1, b.y1 - b.y0);

// [PF-06] Teks di gambar (OCR) — urutkan baris: atas→bawah; baris yang sejajar (kolom) dibaca kiri→kanan
/** @param {Array<{text: string, bbox: {x0, y0, x1, y1}}>} baris */
export function urutkanBaris(baris) {
  const sisa = [...(baris ?? [])].filter((b) => b?.bbox).sort((a, b) => tengahY(a.bbox) - tengahY(b.bbox));
  const deret = [];
  for (const b of sisa) {
    const akhir = deret.at(-1);
    // Sebaris bila pusat vertikalnya berjarak < setengah tinggi baris.
    if (akhir && Math.abs(tengahY(akhir[0].bbox) - tengahY(b.bbox)) < Math.min(tinggi(akhir[0].bbox), tinggi(b.bbox)) / 2) {
      akhir.push(b);
    } else deret.push([b]);
  }
  return deret.flatMap((d) => d.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

// [PF-06] Teks di gambar (OCR) — saring keyakinan < 60, butuh ≥ 3 kata bermakna, potong maks. 300 karakter
/**
 * @param {Array<{text: string, confidence: number, bbox: {x0, y0, x1, y1},
 *   words?: Array<{text: string, confidence: number}>}>} baris  baris hasil Tesseract (blocks → paragraphs → lines)
 * @returns {{teks: string, terpotong: boolean, kata: number} | null}  null = tidak ada teks yang layak dibacakan
 */
export function rapikanTeks(baris, { keyakinanMin = KEYAKINAN_MIN, kataMin = KATA_MIN, maks = MAKS_KARAKTER } = {}) {
  const bersih = [];
  let kata = 0;
  for (const b of urutkanBaris(baris)) {
    if (!(Number(b.confidence) >= keyakinanMin)) continue;
    const daftar = Array.isArray(b.words) && b.words.length
      ? b.words.filter((w) => Number(w.confidence) >= keyakinanMin).map((w) => w.text)
      : String(b.text ?? '').split(/\s+/);
    const isi = daftar.join(' ').replace(/\s+/g, ' ').trim();
    const bermakna = isi.split(' ').filter(kataBermakna).length;
    if (!bermakna) continue; // baris derau ("| — ~")
    kata += bermakna;
    bersih.push(isi);
  }
  if (kata < kataMin) return null;
  const teks = bersih.join(' ');
  if (teks.length <= maks) return { teks, terpotong: false, kata };
  const potong = teks.slice(0, maks);
  const spasi = potong.lastIndexOf(' ');
  return { teks: (spasi > maks * 0.6 ? potong.slice(0, spasi) : potong).replace(/[\s,;:.-]+$/, ''), terpotong: true, kata };
}

// [PF-06] Teks di gambar (OCR) — kalimat 'Tulisan: "…".' (terpotong → '… dan teks lainnya.')
export function kalimatTulisan(hasil) {
  if (!hasil?.teks) return null;
  const isi = hasil.teks.replace(/"/g, "'");
  return hasil.terpotong ? `Tulisan: "${isi}" dan teks lainnya.` : `Tulisan: "${isi}".`;
}

// [PF-06] Teks di gambar (OCR) — ratakan hasil Tesseract.js (blocks → paragraphs → lines) menjadi daftar baris
export function barisDariTesseract(data) {
  const out = [];
  for (const blok of data?.blocks ?? []) {
    for (const par of blok?.paragraphs ?? []) {
      for (const l of par?.lines ?? []) {
        out.push({
          text: l.text ?? '',
          confidence: l.confidence ?? 0,
          bbox: l.bbox,
          words: (l.words ?? []).map((w) => ({ text: w.text ?? '', confidence: w.confidence ?? 0 })),
        });
      }
    }
  }
  return out;
}
