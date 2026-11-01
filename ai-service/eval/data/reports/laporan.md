# Laporan evaluasi deskripsi gambar NaraVisi

Dibuat 2026-11-01 23:20 oleh `eval/run_eval.py score`. Dataset: 9 gambar di manifest, 9 punya acuan.

Angka di bawah dihitung otomatis dari berkas prediksi dan penilaian; tidak ada yang diisi tangan.

## Ringkasan per run

| Run | Model | Few-shot | Berhasil | Dinilai manusia | Akurat (Wilson 95%) | Akurat+Sebagian (Wilson 95%) | Jenis benar | p50 | p95 | ≤ 5 dtk |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini-1 | gemini-3.5-flash | 0 | 2/9 | 0 | – [0.0%–0.0%] | – [0.0%–0.0%] | 100.0% (n=1) | 9769 ms | 12044 ms | 0.0% |
| gemini-2 | gemini-3.5-flash | 0 | 6/9 | 0 | – [0.0%–0.0%] | – [0.0%–0.0%] | 100.0% (n=6) | 10227 ms | 20340 ms | 0.0% |
| blip-1 | Salesforce/blip-image-captioning-base + Helsinki-NLP/opus-mt-en-id | 0 | 9/9 | 0 | – [0.0%–0.0%] | – [0.0%–0.0%] | – (tidak memberi jenis) | 2796 ms | 4091 ms | 100.0% |

## Metrik otomatis (dibanding acuan manusia)

| Run | n | BLEU-1 | BLEU-2 | BLEU-3 | BLEU-4 | ROUGE-L | CIDEr-D |
|---|---|---|---|---|---|---|---|
| gemini-1 | 2 | 0.337 | 0.233 | 0.160 | 0.113 | 0.384 | 0.011 |
| gemini-2 | 6 | 0.347 | 0.193 | 0.125 | 0.078 | 0.340 | 0.355 |
| blip-1 | 9 | 0.003 | 0.002 | 0.001 | 0.001 | 0.110 | 0.010 |

Kandidat = ringkasan + detail (tanpa label jenis dan tanpa teks di gambar). Dengan acuan sedikit dan kalimat bebas,
BLEU/CIDEr cenderung rendah walau deskripsinya benar; penilaian manusia adalah ukuran utama.

## Galat

- **gemini-1**: MODEL_BAD_OUTPUT × 7
- **gemini-2**: MODEL_BUSY × 3

## Perbandingan berpasangan (penilaian manusia)

| A vs B | Gambar sama | A lebih baik | Seri | B lebih baik |
|---|---|---|---|---|
| gemini-1 vs gemini-2 | 0 | 0 | 0 | 0 |
| gemini-1 vs blip-1 | 0 | 0 | 0 | 0 |
| gemini-2 vs blip-1 | 0 | 0 | 0 | 0 |

## Contoh keluaran

**gemini-1**

- `img-0004` (12297 ms, jenis: foto): Foto: Seekor komodo besar berjalan ke arah depan di atas jalan tanah di antara rumput tinggi. Sisik komodo berwarna abu-abu kecokelatan dengan tekstur kasar serta lidahnya tampak sedikit menjulur. Suasana tampak alami di bawah sinar matahari dengan rumput hijau dan kecokelatan di sekelilingnya.
- `img-0008` (7241 ms, jenis: foto): Foto: Beberapa stupa batu Candi Borobudur berdiri di pelataran atas dengan latar pemandangan pepohonan hijau dan pegunungan. Stupa-stupa batu berwarna abu-abu ini memiliki dinding berlubang belah ketupat. Di kejauhan, terhampar perbukitan hijau yang membentang di bawah langit cerah berawan.

**gemini-2**

- `img-0001` (23201 ms, jenis: infografis): Infografis: Bertema Sumpah Pemuda yang memuat penjelasan sejarah, lokasi rapat, isi ikrar, dan tokoh kepanitiaan kongres. Latar belakang infografis berwarna merah dan putih dengan siluet tangan-tangan mengepal. Di bagian bawah terdapat jajaran foto hitam-putih para tokoh panitia Kongres Pemuda Kedua. Tulisan di gambar: Sumpah Pemuda Pemuda Pemudi Bergerak, Indonesia Bersatu rri RADIO REPUBLIK INDONESIA Sumpah Pemuda adalah ikrar kebangsaan dari keputusan Kongres Pemuda Kedua di Jakarta, pada 27-28 Oktober 1928. Kongres Pemuda Kedua digagas oleh Perhimpunan Pelajar Pelajar Indonesia (PPPI). RAPAT PERTAMA - Sabtu, 27 Oktober 1928 GEDUNG KATHOLIEKE JONGENLINGEN BOND RAPAT KEDUA - Minggu, 28 Oktober 1928 (Pagi Hari) GEDUNG OOST-JAVA BIOSCOOP RAPAT KETIGA - Minggu, 28 Oktober 1928 (Sore Hari) GEDUNG INDONESISCHE CLUBGEBOUW KAMI PUTERA DAN PUTRI INDONESIA, MENGAKU BERTUMPAH DARAH YANG SATU, TANAH INDONESIA. KAMI PUTRA DAN PUTRI INDONESIA, MENGAKU BERBANGSA YANG SATU, BANGSA INDONESIA. KAMI PUTRA DAN PUTRI INDONESIA, MENJUNJUNG BAHASA PERSATUAN, BAHASA INDONESIA. Kongres ditutup dengan lagu "Indonesia Raya" oleh Wage Rudolf Supratman melalui lantunan biola. Keputusan dibacakan oleh Sugondo Djojopuspito dan dirumuskan oleh Mohammad Yamin. Tokoh-Tokoh Berdasarkan Pembentukan Kepanitiaan Kongres KETUA Sugondo Djojopuspito (PPPI) WAKIL KETUA R.M. Djoko Marsaid (Jong Java) SEKRETARIS Mohammad Yamin (Jong Sumatranen Bond) BENDAHARA Amir Sjarifuddin (Batak Bond) PEMBANTU I Johan Mahmud Tjaja (Jong Islamieten Bond) PEMBANTU II R. Katja Soengkana (Pemoeda Indonesia) PEMBANTU III R.C.L. Senduk (Jong Celebes) PEMBANTU IV Johannes Leimena (Jong Ambon) PEMBANTU V Mohammad Rochjani Su'ud (Pemoeda Kaoem Betawi).
- `img-0002` (11740 ms, jenis: infografis): Infografis: Cuaca panas di Indonesia menyajikan data suhu tinggi, penyebab fenomena, tips perlindungan diri, serta risiko kesehatan. Desain bergaya terang bernuansa krem dan oranye, dilengkapi peta wilayah Indonesia serta foto narasumber dari BMKG di sudut kiri bawah. Visual pendukung seperti gambar payung, topi, dan tabir surya turut menghiasi poin-poin imbauan kesehatan. Tulisan di gambar: Di Bawah Pedang Surya. Bekal Diri Saat Cuaca Menyengat. RRI Radio Republik Indonesia. Data: Hana Syarif. Grafis: Devandra Lukito/Hana Syarif. Cuaca panas melanda sebagian besar wilayah Indonesia. Penyebab: Posisi gerak semu matahari pada bulan Oktober berada di selatan ekuator. Penguatan angin timuran atau Monsun Australia membawa massa udara kering dan hangat. Fenomena ini diprediksi berlanjut hingga akhir Oktober atau awal November 2025. Sumber: BMKG. Suhu Maksimum Harian di Indonesia, 13-20 Oktober 2025. Sumber: BMKG. Kertajati, Jawa Barat 36,4°C. Karanganyar, Jawa Tengah 38,2°C. Surabaya, Jawa Timur 37,4°C. Tips Hadapi Cuaca Panas: Cukupi kebutuhan air tubuh, tidak menunggu rasa haus. Hindari kontak matahari secara langsung, gunakan topi atau payung. Gunakan tabir surya (sunscreen) minimal SPF 30. Lakukan aktivitas fisik/olahraga di dalam ruangan bila memungkinkan. Jangan meninggalkan siapapun di dalam kendaraan yang terparkir, baik dengan kaca terbuka maupun tertutup. Penyakit Akibat Cuaca Panas: Migrain, Panas Dalam, Dehidrasi & Iritasi Kulit, Demam Tinggi (Heatstroke). Sumber: Kemenkes. Deputi Bidang Meteorologi BMKG Guswanto: Posisi ini membuat wilayah Indonesia bagian tengah dan selatan, seperti Jawa, Nusa Tenggara, Kalimantan, dan Papua, menerima penyinaran matahari yang lebih intens sehingga cuaca terasa lebih panas.
- `img-0003` (11758 ms, jenis: infografis): Infografis: Hari Kesehatan Mental Sedunia menyajikan data statistik gangguan jiwa, grafik lokasi kasus, serta panduan mengelola stres. Desain didominasi warna hijau muda dan latar krem terang dengan gambar pita hijau transparan di bagian tengah. Infografis ini memuat grafik kasus per wilayah, data kesehatan mental remaja, tips penanganan stres, serta daftar kontak konseling darurat. Tulisan di gambar: Hari Kesehatan Mental Sedunia. rri RADIO REPUBLIK INDONESIA. 1.101 Kasus Bunuh Diri Jan s/d Sept 2023. Sumber: Pusiknas Polri. secara global SATU dari TUJUH remaja usia 10-19 tahun alami gangguan mental. DEPRESI, KECEMASAN, dan GANGGUAN PERILAKU termasuk penyebab utama penyakit pada remaja. Sumber: WHO. 15,5 juta atau 34,9% remaja Indonesia alami masalah kesehatan mental. Sumber: Indonesia-National Adolescent Mental Health Survey tahun 2022. It's okay not to be okay. Kita harus memiliki kesadaran bahwa kita tidak apa-apa enggak oke supaya enggak stres. Manusia ada kelebihan dan kekurangannya, kita harus bisa menerima hal ini. Imran Pambudi, Direktur Kesehatan Jiwa Kementerian Kesehatan. Layanan Hotline Kesehatan Mental dan Bunuh Diri Kementerian Kesehatan: 119 HEALING119.ID. Cara Kelola Emosi dan Stres: Kenali Penyebab Masalah, Olahraga, Melakukan Hobi, Journaling, Self Care. LAYANAN KONSELING: Alpas @curhatalpas www.alpas.id, Ibunda.id @ibunda.id www.ibunda.id, Pijar Psikologi https://pijarpsikologi.org/konsulgratis/, Pulih Counseling http://yayasanpulih.org/konsultasi-online/. KOMUNITAS DUKUNGAN KESEHATAN MENTAL: Lentera Sintas Indonesia @lentera_id, Ruang Jiwa @sehatjiwa.id bit.ly/GabungRuangJiwa, Ubah Stigma www.ubahstigma.org. Data: Hani Syarif, Grafis: Devendra Luqman/Hani Syarif.
- `img-0004` (5315 ms, jenis: foto): Foto: Seekor komodo besar berjalan perlahan melintasi jalan tanah di antara semak-semak rumput yang rimbun. Reptil ini memiliki kulit bersisik abu-abu kecokelatan dan lidah merah muda yang sedikit terjulur. Suasana di sekitarnya tampak alami dan cerah terpapar sinar matahari.
- `img-0005` (8714 ms, jenis: diagram): Diagram: Peta sebaran habitat komodo di wilayah Nusa Tenggara, Indonesia, yang menunjukkan area keberadaan saat ini dan yang punah. Peta utama memperlihatkan kepulauan Indonesia dan sekitarnya, sedangkan kotak pembesar memperjelas pulau Komodo, Rinca, Padar, Gili Motang, serta Flores Barat. Warna hijau menandakan lokasi populasi komodo saat ini, dan warna merah menunjukkan lokasi yang telah punah. Tulisan di gambar: INDOCHINA, SEMENANJUNG MALAYA, KALIMANTAN, SUMATRA, JAWA, PULAU PAPUA, AUSTRALIA. Inset: Pulau Komodo, Padar, Rinca, Gili Dasami, Gili Motang, Flores (barat). Legenda: Hijau = Sekarang, Merah = Diberantas.

**blip-1**

- `img-0001` (4194 ms, jenis: –): Poster untuk acara.
- `img-0002` (2333 ms, jenis: –): Poster untuk acara.
- `img-0003` (3308 ms, jenis: –): Peta menunjukkan berbagai jenis restoran.
- `img-0004` (2796 ms, jenis: –): Kadal monitor berjalan di jalan tanah.
- `img-0005` (2794 ms, jenis: –): Peta yang menunjukkan lokasi pulau itu.
