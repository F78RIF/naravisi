# Pemberitahuan Pihak Ketiga

Kode NaraVisi berlisensi MIT (`LICENSE.txt`). Komponen di bawah ini milik pihak lain dan tetap memakai
lisensinya sendiri. Lisensi model dan pustaka diambil dari kartu model / metadata paket saat dokumen ini ditulis
(November 2026). Periksa ulang tautannya sebelum mendistribusikan ulang.

## Disertakan di repo

| Komponen | Lokasi | Pemilik | Lisensi |
|---|---|---|---|
| Huruf Atkinson Hyperlegible (400, 700) | `extension/fonts/*.woff2` | Braille Institute of America | SIL Open Font License 1.1, teks lengkap di `extension/fonts/OFL.txt` |

## Diunduh saat dijalankan (tidak ada di repo)

| Model | Dipakai untuk | Lisensi | Sumber |
|---|---|---|---|
| `Salesforce/blip-image-captioning-base` | caption cadangan (lokal) | BSD-3-Clause | https://huggingface.co/Salesforce/blip-image-captioning-base |
| `Helsinki-NLP/opus-mt-en-id` (MarianMT) | terjemahan caption en → id | lisensi tercantum di kartu model (OPUS-MT dirilis dengan lisensi terbuka CC-BY 4.0 / Apache-2.0) | https://huggingface.co/Helsinki-NLP/opus-mt-en-id |

Model diunduh dari Hugging Face ke cache pengguna saat layanan AI pertama kali start. Repo NaraVisi tidak
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
