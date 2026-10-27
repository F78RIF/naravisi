"""Metrik evaluasi caption — implementasi sendiri (pustaka standar), mengikuti definisi aslinya.

- BLEU-1..4: Papineni dkk. 2002, tingkat korpus, n-gram terpotong (clipped), brevity penalty,
  multi-acuan (panjang acuan terdekat).
- ROUGE-L: Lin 2004, berbasis LCS; seperti COCO caption eval: presisi & recall maksimum
  di antara acuan, F dengan beta = 1.2.
- CIDEr-D: Vedantam dkk. 2015 (varian D di pycocoevalcap): TF-IDF n-gram 1..4, nilai kandidat
  dipotong ke nilai acuan, penalti panjang Gauss (sigma = 6), dikali 10.
- Wilson: interval kepercayaan proporsi (lebih tepat dari ±1,96·SE untuk n kecil).

Token: huruf kecil, hanya kata/angka (tanda baca dibuang). Semua skor dihitung dengan cara
yang sama untuk setiap run sehingga perbandingan antar-run adil.
"""

from __future__ import annotations

import math
import re
from collections import Counter

_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def ngrams(tokens: list[str], n: int) -> Counter:
    return Counter(tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1))


# ---------------------------------------------------------------------------
# BLEU
# ---------------------------------------------------------------------------
def corpus_bleu(candidates: list[str], references: list[list[str]], max_n: int = 4) -> dict[str, float]:
    """{"bleu1": …, …, "bleu4": …} untuk seluruh korpus."""
    if len(candidates) != len(references):
        raise ValueError("jumlah kandidat dan acuan berbeda")
    matches = [0] * max_n
    totals = [0] * max_n
    cand_len = 0
    ref_len = 0
    for cand, refs in zip(candidates, references):
        c = tokenize(cand)
        rs = [tokenize(r) for r in refs if r and r.strip()]
        if not rs:
            continue
        cand_len += len(c)
        # Panjang acuan terdekat; bila seri, ambil yang lebih pendek (seperti Papineni/NLTK).
        ref_len += min((abs(len(r) - len(c)), len(r)) for r in rs)[1]
        for n in range(1, max_n + 1):
            cn = ngrams(c, n)
            max_ref = Counter()
            for r in rs:
                max_ref |= ngrams(r, n)
            matches[n - 1] += sum(min(cnt, max_ref[g]) for g, cnt in cn.items())
            totals[n - 1] += max(0, len(c) - n + 1)

    out = {}
    if cand_len == 0:
        return {f"bleu{n}": 0.0 for n in range(1, max_n + 1)}
    bp = 1.0 if cand_len > ref_len else math.exp(1 - ref_len / cand_len)
    log_sum = 0.0
    for n in range(1, max_n + 1):
        p = matches[n - 1] / totals[n - 1] if totals[n - 1] else 0.0
        if p == 0:
            out.update({f"bleu{k}": 0.0 for k in range(n, max_n + 1)})
            break
        log_sum += math.log(p)
        out[f"bleu{n}"] = bp * math.exp(log_sum / n)
    return out


# ---------------------------------------------------------------------------
# ROUGE-L
# ---------------------------------------------------------------------------
def lcs_length(a: list[str], b: list[str]) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b, 1):
            cur.append(prev[j - 1] + 1 if x == y else max(prev[j], cur[j - 1]))
        prev = cur
    return prev[-1]


def rouge_l(candidate: str, refs: list[str], beta: float = 1.2) -> float:
    c = tokenize(candidate)
    rs = [tokenize(r) for r in refs if r and r.strip()]
    if not c or not rs:
        return 0.0
    precs, recs = [], []
    for r in rs:
        lcs = lcs_length(c, r)
        precs.append(lcs / len(c))
        recs.append(lcs / len(r) if r else 0.0)
    p, r = max(precs), max(recs)
    if p == 0 or r == 0:
        return 0.0
    return ((1 + beta**2) * p * r) / (r + beta**2 * p)


def corpus_rouge_l(candidates: list[str], references: list[list[str]]) -> float:
    scores = [rouge_l(c, r) for c, r in zip(candidates, references)]
    return sum(scores) / len(scores) if scores else 0.0


# ---------------------------------------------------------------------------
# CIDEr-D
# ---------------------------------------------------------------------------
def cider_d(candidates: list[str], references: list[list[str]], n: int = 4, sigma: float = 6.0) -> float:
    """Rata-rata CIDEr-D korpus. IDF dihitung dari acuan korpus ini (seperti pycocoevalcap)."""
    if len(candidates) != len(references):
        raise ValueError("jumlah kandidat dan acuan berbeda")
    if not candidates:
        return 0.0
    cands = [tokenize(c) for c in candidates]
    refs = [[tokenize(r) for r in rs if r and r.strip()] for rs in references]

    doc_freq: Counter = Counter()
    for rs in refs:
        seen = set()
        for r in rs:
            for k in range(1, n + 1):
                seen.update(ngrams(r, k))
        doc_freq.update(seen)
    log_n = math.log(float(len(candidates)))

    def vec(tokens: list[str]):
        v = [dict() for _ in range(n)]
        norms = [0.0] * n
        for k in range(1, n + 1):
            for g, tf in ngrams(tokens, k).items():
                w = float(tf) * (log_n - math.log(max(1.0, float(doc_freq[g]))))
                v[k - 1][g] = w
                norms[k - 1] += w * w
        return v, [math.sqrt(x) for x in norms], len(tokens)

    def sim(vh, vr, nh, nr, lh, lr):
        delta = float(lh - lr)
        val = [0.0] * n
        for k in range(n):
            for g, w in vh[k].items():
                if g in vr[k]:
                    val[k] += min(w, vr[k][g]) * vr[k][g]
            if nh[k] != 0 and nr[k] != 0:
                val[k] /= nh[k] * nr[k]
            val[k] *= math.e ** (-(delta**2) / (2 * sigma**2))
        return val

    scores = []
    for c, rs in zip(cands, refs):
        if not rs:
            scores.append(0.0)
            continue
        vh, nh, lh = vec(c)
        total = [0.0] * n
        for r in rs:
            vr, nr, lr = vec(r)
            for k, s in enumerate(sim(vh, vr, nh, nr, lh, lr)):
                total[k] += s
        scores.append(sum(total) / n / len(rs) * 10.0)
    return sum(scores) / len(scores)


# ---------------------------------------------------------------------------
# Statistik
# ---------------------------------------------------------------------------
def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    """Interval Wilson 95% untuk proporsi k/n; n = 0 → (0, 0)."""
    if n <= 0:
        return 0.0, 0.0
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, center - half), min(1.0, center + half)


def percentile(values: list[float], q: float) -> float:
    """Persentil dengan interpolasi linear (sama dengan numpy bawaan); q dalam 0..100."""
    if not values:
        return float("nan")
    xs = sorted(values)
    pos = (len(xs) - 1) * q / 100.0
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)
