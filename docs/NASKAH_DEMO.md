# Naskah Demo & Checklist Gladi — NaraVisi v1.0

Durasi target: **8–10 menit** demo langsung + tanya jawab. Video cadangan: `e2e/demo/naravisi-demo.mp4` (82 detik, tanpa suara, model AI disimulasikan) — putar bila demo langsung bermasalah.

## A. Persiapan (H-1 dan 30 menit sebelum)

### Perangkat
- [ ] Laptop dicas penuh + charger; speaker/headphone untuk suara TTS (sambungkan ke pengeras ruangan bila ada)
- [ ] Chrome versi terbaru; **tutup** extension lain yang memakai Alt+Shift+N
- [ ] Windows: paket bahasa Indonesia terpasang (Settings → Time & Language → Speech) agar suara Indonesia tersedia
- [ ] NVDA terpasang (untuk segmen pembaca layar, opsional)

### Server (jalankan 15 menit sebelum — model AI butuh waktu dimuat)
- [ ] Terminal 1: `cd ai-service && .venv\Scripts\activate && uvicorn app.main:app --port 8000 --env-file .env` → tunggu **"Layanan AI siap"**
- [ ] Terminal 2: `cd backend && npm start` → cek log: basis data MySQL, pembayaran `simulasi` (atau `sandbox`)
- [ ] Buka `http://localhost:3000/api/v1/health` → `"ai": {"ok": true}`
- [ ] Popup NaraVisi → Status server → hijau
- [ ] **Pemanasan model**: deskripsikan 1 gambar apa saja (permintaan pertama lebih lambat)

### Data demo
- [ ] Akun demo baru belum terdaftar (mis. `demo@naravisi.id`) — atau hapus dulu lewat Dashboard Admin
- [ ] Akun Admin dari `.env` bisa masuk ke `/admin/`
- [ ] 2 tab situs berita sudah dibuka dan **sudah dicoba** (pilih artikel dengan 3–5 foto jelas: orang, hewan, pemandangan; hindari infografis)
- [ ] Simpan tangkapan layar hasil percobaan sebagai cadangan

### Cadangan bila gagal
| Masalah | Tindakan |
|---|---|
| Layanan AI lambat / mati | Putar video cadangan; jelaskan arsitektur dengan slide |
| Internet mati | Gunakan halaman uji lokal (`e2e` server) — gambar dari localhost tetap bisa dideskripsikan |
| Midtrans Sandbox gagal | Kosongkan `MIDTRANS_SERVER_KEY`, restart backend → mode simulasi |
| Suara tidak keluar | Tunjukkan teks deskripsi di panel; cek volume & suara di Pengaturan → "Coba suara" |

## B. Alur demo (dengan kalimat pengantar)

| # | Menit | Tindakan | Yang diucapkan |
|---|---|---|---|
| 1 | 0:00 | Slide judul → masalah | "Banyak gambar di web tidak punya teks alternatif, sehingga pengguna pembaca layar kehilangan informasi. NaraVisi menjawab itu dengan AI." |
| 2 | 0:45 | Popup → **Daftar** akun demo | "Akun baru otomatis Gratis: 10 deskripsi per hari." (UC-AKUN-01) |
| 3 | 1:30 | Buka artikel berita, tekan **Alt+Shift+N** | "NaraVisi memindai gambar, mengabaikan ikon kecil, dan menandai gambar yang bisa dideskripsikan." (UC-GBR-01/02) |
| 4 | 2:00 | **↓** ke gambar 2, **Enter** | Biarkan suara membacakan. "Gambar diunduh dan dinormalkan oleh extension, dikirim ke layanan AI BLIP, diterjemahkan ke bahasa Indonesia, lalu dibacakan." (UC-GBR-03..07) |
| 5 | 3:00 | **Spasi** (jeda), **Spasi** (lanjut), **R** (ulang), **S** (berhenti) | "Semua kontrol bisa dengan keyboard." (RNF-03) |
| 6 | 3:30 | (opsional) nyalakan NVDA, ulangi langkah 3–4 | "Status diumumkan pembaca layar; deskripsi dibacakan TTS tanpa tabrakan." (RNF-02) |
| 7 | 4:00 | **L** → isi alasan → Kirim | "Pengguna bisa melaporkan deskripsi yang keliru." (UC-LAP-01) |
| 8 | 4:30 | Popup → **Riwayat** → Putar ulang | "Gratis menyimpan 7 hari; data lama disembunyikan, bukan dihapus." (UC-RWY-02/03) |
| 9 | 5:00 | **Pengaturan** → kecepatan 1,4× → Simpan → Coba suara | "Kecepatan untuk semua; nada & jenis suara khusus Premium." (UC-AKS-03) |
| 10 | 5:45 | **Premium** → Beli → bayar (simulasi/QRIS Sandbox) → Cek status | "Status Premium dihitung dari tabel langganan, jadi otomatis kembali Gratis saat habis." (UC-PRM-01..04) |
| 11 | 7:00 | Pengaturan → nada & jenis suara kini aktif | "Fitur Premium terbuka tanpa login ulang." |
| 12 | 7:30 | `localhost:3000/admin/` → Pengguna (status Premium) → Laporan → Tinjau | "Admin mengelola pengguna dan menindaklanjuti laporan." (UC-ADM, UC-LAP-02/03) |
| 13 | 8:30 | Slide hasil pengujian & keterbatasan | "30/30 RF, 85 tes backend, 63 skenario E2E; keterbatasan: mutu BLIP dan kecepatan model di CPU." |

## C. Persiapan tanya jawab

| Kemungkinan pertanyaan | Jawaban singkat |
|---|---|
| Kenapa BLIP, bukan GPT-4o/Gemini? | Gratis & berjalan lokal (keputusan ADR-02). Arsitektur memakai provider yang bisa diganti; API vision cukup mengganti `CAPTION_PROVIDER`. |
| Apakah gambar pengguna disimpan? | Tidak. Hanya URL dan teks deskripsi (RNF-13). Gambar dikirim sekali untuk diproses lalu dibuang. |
| Bagaimana jika AI gagal — kuota berkurang? | Tidak. Kuota dipesan sebelum memanggil AI dan dikembalikan bila gagal (ADR-17). |
| Bagaimana mencegah kuota diakali dengan permintaan serentak? | Penambahan kuota satu perintah SQL bersyarat; diuji 15 permintaan serentak → tepat 10 lolos. |
| Kenapa hasil tampil di panel, bukan popup? | Popup Chrome tertutup saat kehilangan fokus sehingga suara terputus (ADR-05). |
| Bagaimana pembayaran diverifikasi? | Tanda tangan SHA-512 dari Midtrans + aktivasi idempoten; tanpa webhook (localhost) status dicek langsung ke Midtrans. |
| Di mana Agentic SDLC-nya? | Setiap fase: agen requirement/design → coding → testing → review → persetujuan manusia. Bukti: `docs/AGENTIC_SDLC_LOG.md`, ADR, dan riwayat Git. |
| Sudah diuji pengguna tunanetra? | Tunjukkan hasil M-05 (isi sebelum demo). |

## D. Setelah demo
- [ ] Hapus akun demo bila perlu; matikan server
- [ ] Catat pertanyaan & masukan penguji ke `EVALUASI.md` bagian 7
