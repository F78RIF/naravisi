// Ikon SVG inline NaraVisi (tanpa font ikon / gambar luar). Dibangun dengan DOM, selalu aria-hidden:
// nama aksesibel ada di tombol/tautan yang memuatnya.
const NS = 'http://www.w3.org/2000/svg';

function svg(viewBox, children, { size = 24, className = 'icon', attrs = {} } = {}) {
  const node = document.createElementNS(NS, 'svg');
  const base = {
    viewBox, width: size, height: size, class: className,
    'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    ...attrs,
  };
  for (const [k, v] of Object.entries(base)) node.setAttribute(k, String(v));
  for (const [tag, a] of children) {
    const child = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) child.setAttribute(k, String(v));
    node.append(child);
  }
  return node;
}

const SHAPES = {
  // Mata terbuka: kata sandi sedang tersembunyi → tekan untuk menampilkan
  eye: [
    ['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  // Mata dicoret: kata sandi sedang terlihat → tekan untuk menyembunyikan
  eyeOff: [
    ['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M4 4l16 16' }],
  ],
  history: [
    ['path', { d: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1' }],
    ['path', { d: 'M3.5 4v4.5H8' }],
    ['path', { d: 'M12 7.5V12l3 2' }],
  ],
  settings: [
    ['path', { d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }],
    ['circle', { cx: 15, cy: 6, r: 2 }],
    ['circle', { cx: 9, cy: 12, r: 2 }],
    ['circle', { cx: 17, cy: 18, r: 2 }],
  ],
  bookmark: [['path', { d: 'M6.5 3.5h11v17L12 16.5l-5.5 4Z' }]],
  person: [
    ['circle', { cx: 12, cy: 8, r: 4 }],
    ['path', { d: 'M4.5 20.5c1.4-3.7 4.2-5.5 7.5-5.5s6.1 1.8 7.5 5.5' }],
  ],
  chevron: [['path', { d: 'M9 6l6 6-6 6' }]],
  // Bingkai pindai dengan gelombang suara di tengah
  scan: [
    ['path', { d: 'M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3' }],
    ['path', { d: 'M9 11v2M12 9v6M15 11v2' }],
  ],
};

/** Ikon garis 24×24 yang mengikuti warna teks (stroke="currentColor"). */
export function icon(name, opts) {
  return svg('0 0 24 24', SHAPES[name], opts);
}

/**
 * Logo NaraVisi: mata yang pupilnya gelombang suara ("Nara" pencerita, "Visi" penglihatan).
 * Badan mata marigold, garis luar mengikuti warna teks, gelombang tinta (kontras 7.41:1 di atas marigold).
 */
export function logo(size = 32) {
  return svg('0 0 48 48', [
    ['path', { d: 'M4 24C11 13 37 13 44 24C37 35 11 35 4 24Z', fill: '#E8A33D', 'stroke-width': 3 }],
    ['path', { d: 'M16 23v2M20 21v6M24 18.5v11M28 21v6M32 23v2', stroke: '#14213D', 'stroke-width': 2.75 }],
  ], { size, className: 'logo' });
}
