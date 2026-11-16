// NaraVisi · extension/shared/paket-model.js
// Fungsi   : Data paket model offline (id Hugging Face, revisi yang dipatok, dtype, perkiraan ukuran unduhan). Murni data,
//            tanpa efek samping, agar halaman Pengaturan bisa menampilkan ukuran tanpa memuat pengelola model offscreen.
// Kebutuhan: PF-10, PF-12
// Terkait  : offscreen/model-offline.js, offscreen/florence.js, pages/pengaturan.js

// [PF-10] Florence-2 offline — paket model: id Hugging Face, revisi dipatok, dtype, perkiraan ukuran unduhan
export const PAKET = {
  florence: {
    judul: 'Deskripsi offline lengkap (Florence-2)',
    model: [
      { id: 'onnx-community/Florence-2-base-ft', revisi: 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f', dtype: 'q8', mb: 280 },
      { id: 'Xenova/opus-mt-en-id', revisi: 'b3b41f654c2fb3286d007dee1da7b0f47fd27d82', dtype: 'q8', mb: 104 },
    ],
  },
  // [PF-12] Perintah suara — Whisper tiny (pengenalan ucapan offline, bahasa Indonesia)
  whisper: {
    judul: 'Perintah suara offline (Whisper tiny)',
    model: [{ id: 'onnx-community/whisper-tiny', revisi: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7', dtype: 'q8', mb: 41 }],
  },
};

export const ukuranPaketMb = (nama) => PAKET[nama].model.reduce((n, m) => n + m.mb, 0);
