# Pemberitahuan Pihak Ketiga

Kode NaraVisi berlisensi MIT (`LICENSE.txt`). Komponen di bawah ini milik pihak lain dan tetap memakai
lisensinya sendiri. Lisensi model dan pustaka diambil dari kartu model / metadata paket saat dokumen ini ditulis
(November 2026). Periksa ulang tautannya sebelum mendistribusikan ulang.

## Disertakan di repo

| Komponen | Lokasi | Pemilik | Lisensi |
|---|---|---|---|
| Huruf Atkinson Hyperlegible (400, 700) | `extension/fonts/*.woff2` | Braille Institute of America | SIL Open Font License 1.1, teks lengkap di `extension/fonts/OFL.txt` |
| MediaPipe Tasks Vision 0.10.21 (`vision_bundle.mjs`, `vision_wasm_internal.js/.wasm`) | `extension/vendor/mediapipe/` | Google LLC | Apache License 2.0 — https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE |
| Model EfficientDet-Lite0 int8 (deteksi objek, label COCO) | `extension/vendor/models/efficientdet_lite0_int8.tflite` | Google LLC | Apache License 2.0 — kartu model: https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector#models ; sumber unduhan: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite |
| jsQR 1.4.0 (`jsQR.js`, pembaca kode QR, PF-07) | `extension/vendor/jsqr/` | Cosmo Wolfe | Apache License 2.0 — teks lengkap di `extension/vendor/jsqr/LICENSE`; sumber: https://github.com/cozmo/jsQR |
| Tesseract.js 7.0.0 (`tesseract.esm.min.js`, `worker.min.js`, OCR PF-06) | `extension/vendor/tesseract/` | Jerome Wu dan kontributor Tesseract.js | Apache License 2.0 — teks lengkap di `extension/vendor/tesseract/LICENSE.md`; sumber: https://github.com/naptha/tesseract.js |
| tesseract.js-core 7.0.0 (`tesseract-core-simd-lstm.js/.wasm`: mesin Tesseract OCR + Leptonica dalam WebAssembly) | `extension/vendor/tesseract/` | kontributor Tesseract.js; Tesseract OCR (Google LLC dkk.); Leptonica (Dan Bloomberg) | Apache License 2.0 (`extension/vendor/tesseract/LICENSE-tesseract.js-core`); Tesseract OCR: Apache-2.0 — https://github.com/tesseract-ocr/tesseract ; Leptonica: lisensi gaya BSD 2 klausul — http://leptonica.org/about-the-license.html |
| Data bahasa `ind` & `eng` (tessdata_fast 4.1.0, dikompres gzip tanpa diubah isinya) | `extension/vendor/tessdata/` | Google LLC / proyek Tesseract OCR | Apache License 2.0 — https://github.com/tesseract-ocr/tessdata_fast |
| Transformers.js 4.3.2 (`transformers.min.js`, PF-10) | `extension/vendor/transformers/` | Hugging Face, Inc. | Apache License 2.0 — teks lengkap di `extension/vendor/transformers/LICENSE`; sumber: https://github.com/huggingface/transformers.js |
| ONNX Runtime Web 1.31.0-dev (`ort-wasm-simd-threaded.asyncify.mjs/.wasm`, PF-10) | `extension/vendor/transformers/` | Microsoft Corporation | MIT — teks lengkap di `extension/vendor/transformers/LICENSE-onnxruntime.txt`; sumber: https://github.com/microsoft/onnxruntime |

MediaPipe dan modelnya disertakan tanpa diubah (PF-05). jsQR (PF-07), Tesseract.js, intinya, dan data bahasanya (PF-06) juga
disertakan tanpa diubah (data bahasa hanya dikompres gzip). jsQR dipakai hanya bila
`BarcodeDetector` bawaan Chrome tidak tersedia. Kamus nama warna (`extension/shared/warna-id.json`, PF-08) dan
kuantisasi warnanya adalah karya NaraVisi (MIT). Terjemahan label COCO ke bahasa Indonesia
(`extension/shared/label-id.json`) adalah karya NaraVisi (MIT). Teks lengkap Apache License 2.0:
https://www.apache.org/licenses/LICENSE-2.0 . Salin ulang / periksa dengan `node scripts/salin-mediapipe.mjs` dan
`node scripts/salin-lapis-lokal.mjs`.

## Diunduh saat dijalankan (tidak ada di repo)

| Model | Dipakai untuk | Lisensi | Sumber |
|---|---|---|---|
| `Salesforce/blip-image-captioning-base` | caption cadangan (lokal) | BSD-3-Clause | https://huggingface.co/Salesforce/blip-image-captioning-base |
| `Helsinki-NLP/opus-mt-en-id` (MarianMT) | terjemahan caption en → id | lisensi tercantum di kartu model (OPUS-MT dirilis dengan lisensi terbuka CC-BY 4.0 / Apache-2.0) | https://huggingface.co/Helsinki-NLP/opus-mt-en-id |

| `onnx-community/Florence-2-base-ft` (ONNX q8, PF-10) | deskripsi offline di extension | MIT (Microsoft) | https://huggingface.co/onnx-community/Florence-2-base-ft |
| `Xenova/opus-mt-en-id` (ONNX q8, PF-10) | terjemahan keterangan Florence-2 en → id di extension | sama dengan `Helsinki-NLP/opus-mt-en-id` | https://huggingface.co/Xenova/opus-mt-en-id |

Model BLIP & MarianMT diunduh dari Hugging Face ke cache pengguna saat layanan AI pertama kali start. Dua model PF-10
hanya diunduh oleh extension setelah pengguna menyetujuinya di Pengaturan (revisi dipatok, disimpan di Cache API
extension, bisa dihapus). Repo NaraVisi tidak
mendistribusikan bobot modelnya (`*.safetensors` ada di `.gitignore`).

## Layanan eksternal (bukan perangkat lunak yang didistribusikan)

| Layanan | Ketentuan |
|---|---|
| Google Gemini API (Google AI Studio) | Gemini API Additional Terms of Service. Pada tingkat gratis, data yang dikirim dapat dipakai Google untuk meningkatkan produknya (lihat README, bagian Privasi). |
| Midtrans Snap (Sandbox) | Syarat & ketentuan Midtrans. Dipakai hanya untuk mode Sandbox dan simulasi. |

## Pustaka utama (dipasang lewat npm / pip)

| Pustaka | Bagian | Lisensi |
|---|---|---|
| express, mysql2 | backend | MIT |
| playwright, sharp | e2e (dev) | Apache-2.0 |
| axe-core | e2e (dev) | MPL-2.0 |
| qrcode (membuat gambar QR untuk tes & halaman uji) | e2e (dev) | MIT |
| fastapi, pydantic, sacremoses, pytest | ai-service | MIT |
| starlette, uvicorn, httpx, torch | ai-service | BSD-3-Clause |
| pillow | ai-service | MIT-CMU (HPND) |
| google-genai, transformers, sentencepiece | ai-service | Apache-2.0 |
| matplotlib | plotting (dev) | Matplotlib License (berbasis PSF) |
| nbclient, nbformat, ipykernel | notebooks (dev) | BSD-3-Clause |

Daftar lengkap dependensi tidak langsung bisa dilihat dengan `npm ls --all` (folder `backend/`, `e2e/`) dan
`pip list` (venv `ai-service/`).

## Dataset evaluasi

Gambar dataset evaluasi (`ai-service/eval/data/images/`) diambil dari situs berita untuk keperluan evaluasi saja,
tetap milik pemegang hak ciptanya, dan **tidak** dimasukkan ke repo (lihat `docs/DATASET.md`). Yang di-commit hanya
metadata (URL, alt) dan acuan deskripsi buatan sendiri.

Gambar di `examples/` dibuat sendiri dengan kode (SVG dan PNG hasil `examples/buat_gambar_contoh.py`) dan termasuk
dalam lisensi MIT proyek ini.
