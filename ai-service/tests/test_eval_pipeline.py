"""run_eval (provider mock, gambar sintetis), make_fewshot, dan alat anotasi."""

import io
import json
import os
import random
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from PIL import Image

from app.prompts import build_system_instruction, load_fewshot
from eval import annotate, make_fewshot, run_eval
from eval.collect import Dataset
from eval.common import RATING_FIELDS, REFERENCE_FIELDS, Paths, load_dotenv, read_csv, read_jsonl, write_csv

COLORS = {"merah": (220, 40, 40), "biru": (40, 80, 220), "hijau": (40, 160, 60), "kuning": (240, 220, 50)}


def synthetic(color, size, seed) -> bytes:
    """Warna dasar + pola kecerahan acak per blok (seed berbeda → dHash berbeda, warna dominan tetap)."""
    rng = random.Random(seed)
    small = Image.new("RGB", (9, 8))
    for x in range(9):
        for y in range(8):
            f = rng.uniform(0.75, 1.0)
            small.putpixel((x, y), tuple(int(c * f) for c in color))
    buf = io.BytesIO()
    small.resize(size, Image.Resampling.NEAREST).save(buf, "PNG")
    return buf.getvalue()


class TestPipeline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.paths = Paths(Path(self.tmp.name))
        ds = Dataset(self.paths)
        sizes = [(600, 300), (300, 600), (400, 400), (640, 320)]
        for i, ((name, rgb), size) in enumerate(zip(COLORS.items(), sizes)):
            ds.add(synthetic(rgb, size, 13 + i * 9), image_url=f"lokal:{name}.png", caption=f"Kotak {name}")
        refs = [
            {"id": "img-0001", "jenis": "foto", "acuan_1": "Gambar melebar yang sebagian besar berwarna merah polos.", "acuan_2": "Bidang merah melebar dengan garis tipis."},
            {"id": "img-0002", "jenis": "ilustrasi", "acuan_1": "Gambar memanjang ke atas yang sebagian besar berwarna biru.", "acuan_2": ""},
            {"id": "img-0003", "jenis": "grafik", "acuan_1": "Sebuah kotak persegi berwarna hijau dengan garis hitam putih.", "teks_dalam_gambar": "Hijau"},
            {"id": "img-0004", "jenis": "foto", "acuan_1": "", "acuan_2": ""},  # belum diberi acuan
        ]
        write_csv(self.paths.references, REFERENCE_FIELDS, refs)

    def tearDown(self):
        self.tmp.cleanup()

    def runner(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            return run_eval.LocalRunner("mock", env_file=None)

    def test_predict_mock_lalu_score(self):
        rows = run_eval.select_rows(self.paths, None, None, only_referenced=True)
        self.assertEqual([r["id"] for r in rows], ["img-0001", "img-0002", "img-0003"])
        ticks = iter(x / 10 for x in range(100))  # tiap gambar "makan" 100 ms
        out = run_eval.predict(self.paths, "mock-1", self.runner(), rows, provider="mock", log=lambda *_: None, clock=lambda: next(ticks))
        preds = read_jsonl(out)
        self.assertEqual(len(preds), 3)
        self.assertEqual(preds[0]["text"], "Gambar melebar yang sebagian besar berwarna merah.")
        self.assertEqual(preds[0]["latency_ms"], 100)
        self.assertEqual(preds[0]["provider"], "mock")

        # Dilanjutkan: yang sudah berhasil tidak diminta ulang
        again = run_eval.predict(self.paths, "mock-1", self.runner(), rows, provider="mock", log=lambda *_: None)
        self.assertEqual(len(read_jsonl(again)), 3)

        write_csv(self.paths.ratings, RATING_FIELDS, [
            {"run": "mock-1", "id": "img-0001", "nilai": "akurat"},
            {"run": "mock-1", "id": "img-0002", "nilai": "akurat"},
            {"run": "mock-1", "id": "img-0003", "nilai": "sebagian"},
        ])
        r = run_eval.score_run(self.paths, "mock-1")
        self.assertEqual((r["n_ok"], r["n_scored"], r["n_rated"], r["akurat"], r["akurat_sebagian"]), (3, 3, 3, 2, 3))
        self.assertAlmostEqual(r["acc"], 2 / 3)
        self.assertEqual(r["jenis_n"], 0)  # mock tidak memberi jenis
        self.assertEqual((r["p50"], r["p95"], r["fast"]), (100, 100, 1.0))
        self.assertGreater(r["bleu1"], 0.5)
        self.assertGreater(r["cider"], 0)

        path = run_eval.score(self.paths, ["mock-1"])
        report = path.read_text(encoding="utf-8")
        self.assertEqual(path, self.paths.reports / "laporan.md")
        self.assertIn("| mock-1 | mock + mock | 0 | 3/3 | 3 | 66.7% [", report)
        self.assertIn("BLEU-4", report)
        self.assertIn("`img-0001` (100 ms", report)

    def test_galat_dicatat_dan_berhenti_bila_kuota_habis(self):
        class Busy:
            model, fewshot, secret = "gemini-palsu", 0, "KUNCI-RAHASIA-123"

            def __call__(self, *_):
                return {"error": "MODEL_BUSY", "error_message": "kuota habis untuk KUNCI-RAHASIA-123"}

        rows = run_eval.select_rows(self.paths, None, None, only_referenced=False)
        logs = []
        out = run_eval.predict(self.paths, "gemini-x", Busy(), rows + rows, log=logs.append)
        preds = read_jsonl(out)
        self.assertEqual(len(preds), 3)  # berhenti setelah 3 MODEL_BUSY berturut-turut
        self.assertTrue(any("kuota" in line for line in logs))
        self.assertNotIn("KUNCI-RAHASIA-123", out.read_text(encoding="utf-8"))
        r = run_eval.score_run(self.paths, "gemini-x")
        self.assertEqual((r["n_ok"], r["errors"]), (0, {"MODEL_BUSY": 3}))
        report = run_eval.render_report([r], set(), 4, 3)
        self.assertIn("MODEL_BUSY × 3", report)

    def test_perbandingan_antar_run(self):
        self.paths.predictions.mkdir(exist_ok=True)
        ratings = []
        for run, jenis, nilai in (("a", "foto", ["akurat", "akurat", "salah"]), ("b", "ilustrasi", ["sebagian", "akurat", "akurat"])):
            lines = [json.dumps({"id": f"img-000{i}", "run": run, "model": run, "latency_ms": 1000 * i, "text": "x", "ringkasan": "gambar berwarna", "jenis": jenis})
                     for i in range(1, 4)]
            self.paths.prediction_file(run).write_text("".join(line + "\n" for line in lines), encoding="utf-8")
            ratings += [{"run": run, "id": f"img-000{i}", "nilai": v} for i, v in enumerate(nilai, 1)]
        write_csv(self.paths.ratings, RATING_FIELDS, ratings)
        a, b = run_eval.score_run(self.paths, "a"), run_eval.score_run(self.paths, "b")
        self.assertAlmostEqual(a["jenis_acc"], 1 / 3)  # acuan: foto, ilustrasi, grafik
        self.assertAlmostEqual(b["jenis_acc"], 1 / 3)
        self.assertEqual(run_eval.compare(a, b), {"n": 3, "menang": 1, "seri": 1, "kalah": 1})
        self.assertEqual((a["p50"], a["p95"]), (2000, 2900))
        self.assertIn("| a vs b | 3 | 1 | 1 | 1 |", run_eval.render_report([a, b], set(), 4, 3))

    def test_fewshot_dipakai_prompt_dan_tidak_ikut_dinilai(self):
        data = make_fewshot.build(self.paths, n=3)
        self.assertEqual(data["ids"], ["img-0001", "img-0003", "img-0002"])  # acuan_2 & teks dulu, jenis beragam
        self.assertEqual(data["contoh"][0]["jawaban"]["ringkasan"], "Gambar melebar yang sebagian besar berwarna merah polos.")
        self.assertEqual(data["contoh"][1]["jawaban"]["teks_dalam_gambar"], "Hijau")
        self.paths.fewshot.write_text(json.dumps(data), encoding="utf-8")
        loaded = load_fewshot(self.paths.fewshot)
        self.assertEqual(len(loaded), 3)
        self.assertIn("Contoh 1 — gambar: foto dari artikel berita berketerangan \"Kotak merah\"", build_system_instruction(loaded))

        rows = run_eval.select_rows(self.paths, None, None, only_referenced=True)
        run_eval.predict(self.paths, "m", self.runner(), rows, log=lambda *_: None)
        report = run_eval.score(self.paths, ["m"]).read_text(encoding="utf-8")
        self.assertIn("3 gambar yang dipakai sebagai contoh few-shot **tidak ikut dinilai**", report)
        self.assertIn("| m | 0 |", report)  # semua gambar acuan jadi contoh → tidak ada yang dinilai

    def test_split_reference(self):
        self.assertEqual(make_fewshot.split_reference("Kalimat satu. Kalimat dua! Tiga."), ("Kalimat satu.", "Kalimat dua! Tiga."))

    def test_load_dotenv_tidak_menimpa(self):
        p = Path(self.tmp.name) / ".env"
        p.write_text('NV_UJI_A=satu # komentar\nNV_UJI_B="dua # bukan komentar"\n# NV_UJI_C=x\n', encoding="utf-8")
        with mock.patch.dict(os.environ, {"NV_UJI_A": "lama"}):
            load_dotenv(p)
            self.assertEqual((os.environ["NV_UJI_A"], os.environ["NV_UJI_B"]), ("lama", "dua # bukan komentar"))
            self.assertNotIn("NV_UJI_C", os.environ)

    def test_http_runner(self):
        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        seen = {}

        def opener(req, timeout=None):
            seen["body"] = json.loads(req.data)
            return Resp(json.dumps({"text": "Foto: Kucing.", "jenis": "foto", "ringkasan": "Kucing.", "model": "gemini-x"}).encode())

        r = run_eval.HttpRunner("http://127.0.0.1:8000/caption", opener=opener)("QUJD", "id", {"alt": "kucing"})
        self.assertEqual((r["jenis"], r["model"]), ("foto", "gemini-x"))
        self.assertEqual(seen["body"]["context"], {"alt": "kucing"})

        def failing(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 429, "busy", {}, io.BytesIO(b'{"detail": {"code": "MODEL_BUSY", "message": "sibuk"}}'))

        self.assertEqual(run_eval.HttpRunner("http://x", opener=failing)("QUJD", "id", None)["error"], "MODEL_BUSY")


class TestAnnotate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.paths = Paths(Path(cls.tmp.name))
        Dataset(cls.paths).add(synthetic((200, 50, 50), (300, 200), 11), image_url="lokal:a.png", caption="<b>Keterangan</b>")
        cls.paths.predictions.mkdir()
        cls.paths.prediction_file("run-1").write_text(json.dumps({"id": "img-0001", "text": "Gambar <script>x</script>", "latency_ms": 5}) + "\n", encoding="utf-8")
        cls.server = annotate.serve(cls.paths, port=0, annotator="uji")
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def get(self, path, headers=None):
        req = urllib.request.Request(self.base + path, headers=headers or {})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def post(self, path, body, headers=None):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "X-NaraVisi-Anotasi": "1", **(headers or {})})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_fase_acuan_tanpa_keluaran_model(self):
        status, html = self.get("/acuan")
        self.assertEqual(status, 200)
        self.assertIn('<label for="acuan_1">', html)
        self.assertIn('role="status" aria-live="polite"', html)
        self.assertNotIn("Gambar <script>", html)  # keluaran model tidak ditampilkan
        self.assertNotIn("<b>Keterangan</b>", html)  # teks di-escape
        self.assertIn("&lt;b&gt;Keterangan&lt;/b&gt;", html)

    def test_simpan_acuan_dan_nilai_ke_csv(self):
        self.assertEqual(self.post("/api/acuan", {"id": "img-0001", "jenis": "foto", "acuan_1": " Seekor  kucing. "})[0], 200)
        self.assertEqual(self.post("/api/acuan", {"id": "img-0001", "jenis": "foto", "acuan_1": "Seekor kucing tidur."})[0], 200)
        refs = read_csv(self.paths.references)
        self.assertEqual([(r["acuan_1"], r["annotator"]) for r in refs], [("Seekor kucing tidur.", "uji")])  # upsert, bukan baris ganda

        status, html = self.get("/nilai?run=run-1")
        self.assertIn("Gambar &lt;script&gt;x&lt;/script&gt;", html)  # keluaran tampil di fase nilai, di-escape
        self.assertIn("1 · Akurat", html)
        self.assertEqual(self.post("/api/nilai", {"id": "img-0001", "run": "run-1", "nilai": "sebagian"})[0], 200)
        self.assertEqual(self.post("/api/nilai", {"id": "img-0001", "run": "run-1", "nilai": "akurat"})[0], 200)
        self.assertEqual([(r["run"], r["nilai"]) for r in read_csv(self.paths.ratings)], [("run-1", "akurat")])

    def test_validasi_dan_perlindungan(self):
        self.assertEqual(self.post("/api/nilai", {"id": "img-0001", "run": "run-1", "nilai": "bagus"})[0], 400)
        self.assertEqual(self.post("/api/nilai", {"id": "img-0001", "run": "../etc", "nilai": "akurat"})[0], 400)
        self.assertEqual(self.post("/api/acuan", {"id": "img-9999", "acuan_1": "x"})[0], 400)
        self.assertEqual(self.post("/api/acuan", {"id": "img-0001", "jenis": "hantu"})[0], 400)
        self.assertEqual(self.post("/api/acuan", {"id": "img-0001", "acuan_1": "x" * 1001})[0], 400)
        # tanpa header khusus (formulir dari situs lain) → ditolak
        req = urllib.request.Request(self.base + "/api/acuan", data=b"{}", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 403)
        # DNS rebinding: Host asing ditolak
        self.assertEqual(self.get("/", headers={"Host": "jahat.example"})[0], 403)
        # gambar hanya lewat ID manifest
        self.assertEqual(self.get("/img/img-0001")[0], 200)
        self.assertEqual(self.get("/img/..%2F..%2Fmanifest.csv")[0], 404)

    def test_hanya_listen_di_localhost(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
