"""Metrik evaluasi dengan nilai yang diketahui (dihitung tangan)."""

import math
import unittest

from eval import metrics


class TestTokenize(unittest.TestCase):
    def test_huruf_kecil_tanpa_tanda_baca(self):
        self.assertEqual(metrics.tokenize("Foto: Dua anak, bermain bola!"), ["foto", "dua", "anak", "bermain", "bola"])
        self.assertEqual(metrics.tokenize("Tahun 2026_baru"), ["tahun", "2026", "baru"])


class TestBleu(unittest.TestCase):
    def test_kandidat_sama_dengan_acuan_bernilai_1(self):
        s = metrics.corpus_bleu(["seorang pria membaca koran di taman kota"], [["seorang pria membaca koran di taman kota"]])
        for n in range(1, 5):
            self.assertAlmostEqual(s[f"bleu{n}"], 1.0)

    def test_contoh_klasik(self):
        # unigram cocok 5/6 (the×2, cat, on, mat); bigram cocok 3/5 (the cat, on the, the mat); BP = 1
        s = metrics.corpus_bleu(["the cat sat on the mat"], [["the cat is on the mat"]])
        self.assertAlmostEqual(s["bleu1"], 5 / 6)
        self.assertAlmostEqual(s["bleu2"], math.sqrt(5 / 6 * 3 / 5))
        # trigram cocok 1/4 (on the mat); 4-gram 0/3 → BLEU-4 = 0
        self.assertAlmostEqual(s["bleu3"], (5 / 6 * 3 / 5 * 1 / 4) ** (1 / 3))
        self.assertEqual(s["bleu4"], 0.0)

    def test_hitungan_dipotong_dan_brevity_penalty(self):
        # "the the the" vs "the cat": the dipotong ke 1 → p1 = 1/3; c=3 > r=2 → BP = 1
        self.assertAlmostEqual(metrics.corpus_bleu(["the the the"], [["the cat"]])["bleu1"], 1 / 3)
        # kandidat lebih pendek: c=2, r=4 → BP = e^(1-2) ; p1 = 1
        self.assertAlmostEqual(metrics.corpus_bleu(["kucing hitam"], [["kucing hitam tidur pulas"]])["bleu1"], math.exp(-1))

    def test_multi_acuan_memakai_maksimum(self):
        s = metrics.corpus_bleu(["anjing berlari"], [["kucing tidur", "anjing berlari"]])
        self.assertAlmostEqual(s["bleu2"], 1.0)


class TestRougeL(unittest.TestCase):
    def test_lcs(self):
        self.assertEqual(metrics.lcs_length("a b c d".split(), "a c d".split()), 3)
        self.assertEqual(metrics.lcs_length([], ["a"]), 0)

    def test_nilai_diketahui(self):
        # LCS = the cat on the mat (5); P = R = 5/6 → F = 5/6 untuk beta berapa pun
        self.assertAlmostEqual(metrics.rouge_l("the cat sat on the mat", ["the cat is on the mat"]), 5 / 6)
        self.assertAlmostEqual(metrics.rouge_l("sama persis", ["sama persis"]), 1.0)
        self.assertEqual(metrics.rouge_l("tidak ada", ["kata lain"]), 0.0)

    def test_beta_1_2(self):
        # P = 1 (2/2), R = 0.5 (2/4) → F = (1+1.44)·1·0.5 / (0.5 + 1.44·1)
        self.assertAlmostEqual(metrics.rouge_l("kucing hitam", ["kucing hitam tidur pulas"]), 2.44 * 0.5 / 1.94)


class TestCider(unittest.TestCase):
    def test_kandidat_sama_dengan_acuan_bernilai_10(self):
        cands = ["seekor kucing tidur di sofa", "dua anak bermain bola di lapangan"]
        refs = [["seekor kucing tidur di sofa"], ["dua anak bermain bola di lapangan"]]
        self.assertAlmostEqual(metrics.cider_d(cands, refs), 10.0)

    def test_tidak_ada_kata_sama_bernilai_0(self):
        self.assertEqual(metrics.cider_d(["merah biru", "hijau kuning"], [["kucing tidur"], ["anak bermain"]]), 0.0)

    def test_penalti_panjang(self):
        refs = [["seekor kucing tidur di sofa"], ["dua anak bermain bola"]]
        full = metrics.cider_d(["seekor kucing tidur di sofa", "dua anak bermain bola"], refs)
        longer = metrics.cider_d(["seekor kucing tidur di sofa empuk berwarna merah tua sekali", "dua anak bermain bola"], refs)
        self.assertLess(longer, full)


class TestStatistik(unittest.TestCase):
    def test_wilson(self):
        lo, hi = metrics.wilson(8, 10)
        self.assertAlmostEqual(lo, 0.4902, places=4)
        self.assertAlmostEqual(hi, 0.9433, places=4)
        self.assertEqual(metrics.wilson(0, 0), (0.0, 0.0))
        lo, hi = metrics.wilson(10, 10)
        self.assertAlmostEqual(hi, 1.0)
        self.assertAlmostEqual(lo, 0.7225, places=4)

    def test_percentile(self):
        xs = list(range(1, 11))
        self.assertAlmostEqual(metrics.percentile(xs, 50), 5.5)
        self.assertAlmostEqual(metrics.percentile(xs, 95), 9.55)
        self.assertEqual(metrics.percentile([7], 95), 7)
        self.assertTrue(math.isnan(metrics.percentile([], 50)))


if __name__ == "__main__":
    unittest.main()
