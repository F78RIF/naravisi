"""Jalankan model pada dataset evaluasi lalu hitung skornya.

    python -m eval.run_eval predict --provider gemini --run gemini-1 --limit 10
    python -m eval.run_eval predict --provider blip   --run blip-1   --limit 10
    python -m eval.run_eval predict --provider http --url http://127.0.0.1:8000/caption --run layanan-1
    python -m eval.run_eval score --runs gemini-1 blip-1

`predict` menulis data/predictions/<run>.jsonl (satu baris per gambar, galat ikut dicatat).
`score` menulis data/reports/laporan.md: akurasi penilaian manusia + interval Wilson,
akurasi jenis gambar, latensi p50/p95, % ≤ 5 dtk, BLEU-1..4, ROUGE-L, CIDEr-D, dan
perbandingan antar-run. Kunci API dibaca dari ai-service/.env dan tidak pernah dicetak.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eval import metrics
from eval.common import DEFAULT_DATA, Paths, read_csv, read_jsonl, utf8_console

AI_SERVICE = Path(__file__).resolve().parent.parent
FAST_MS = 5000  # target RNF: deskripsi ≤ 5 detik


# ---------------------------------------------------------------------------
# predict
# ---------------------------------------------------------------------------
class LocalRunner:
    """Memakai kode layanan AI yang sama dengan produksi (app.main.build_service), tanpa cadangan."""

    def __init__(self, provider: str, env_file: Path | None = AI_SERVICE / ".env"):
        import os

        from eval.common import load_dotenv

        if env_file:
            load_dotenv(env_file)
        os.environ["CAPTION_PROVIDER"] = provider
        from app.config import load_settings
        from app.main import build_service, install_redaction

        settings = replace(load_settings(), provider=provider, fallback_provider="none")
        install_redaction([settings.gemini_api_key])  # kunci disamarkan di semua log
        self.max_side = settings.max_image_side
        self.router = build_service(settings)
        self.model = self.router.model_name
        self.fewshot = getattr(self.router.primary.captioner, "fewshot_count", 0)
        self.secret = settings.gemini_api_key

    def __call__(self, image_b64: str, lang: str, context: dict | None) -> dict:
        from app.image_utils import ImageError, decode_base64_image
        from app.providers import ProviderError

        try:
            image = decode_base64_image(image_b64, max_side=self.max_side)
        except ImageError as err:
            return {"error": err.code, "error_message": err.message}
        try:
            r = self.router.describe(image, lang, context)
        except ProviderError as err:
            return {"error": err.code, "error_message": err.message}
        except ValueError as err:
            return {"error": "NO_CAPTION", "error_message": str(err)}
        return {"text": r.text, "jenis": r.jenis, "ringkasan": r.ringkasan, "detail": r.detail,
                "teks_dalam_gambar": r.teks_dalam_gambar, "keyakinan": r.keyakinan, "model": r.model}


class HttpRunner:
    """Memanggil endpoint /caption layanan yang sedang berjalan."""

    def __init__(self, url: str, opener=None):
        self.url = url
        self.model = url
        self.fewshot = None
        self.secret = ""
        self._open = opener or urllib.request.urlopen

    def __call__(self, image_b64: str, lang: str, context: dict | None) -> dict:
        body = json.dumps({"image_base64": image_b64, "lang": lang, "context": context}).encode()
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with self._open(req, timeout=60) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read()).get("detail", {})
            except ValueError:
                detail = {}
            return {"error": detail.get("code", f"HTTP_{err.code}"), "error_message": detail.get("message", "")}
        except (urllib.error.URLError, OSError) as err:
            return {"error": "UNREACHABLE", "error_message": str(err)}
        self.model = data.get("model", self.model)
        return {k: data.get(k) for k in ("text", "jenis", "ringkasan", "detail", "teks_dalam_gambar", "keyakinan", "model")}


def context_of(row: dict) -> dict | None:
    ctx = {k: row.get(k, "")[:300] for k in ("alt", "caption", "page_title") if row.get(k, "").strip()}
    return ctx or None


def select_rows(paths: Paths, ids: list[str] | None, limit: int | None, only_referenced: bool) -> list[dict]:
    rows = read_csv(paths.manifest)
    if only_referenced:
        refs = {r["id"] for r in read_csv(paths.references) if r.get("acuan_1", "").strip()}
        rows = [r for r in rows if r["id"] in refs]
    if ids:
        wanted = set(ids)
        rows = [r for r in rows if r["id"] in wanted]
    return rows[:limit] if limit else rows


def predict(paths: Paths, run: str, runner, rows: list[dict], *, lang: str = "id", use_context: bool = True,
            delay: float = 0.0, provider: str = "", log=print, sleep=time.sleep, clock=time.perf_counter) -> Path:
    out = paths.prediction_file(run)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = {p["id"] for p in read_jsonl(out) if not p.get("error")}
    busy_streak = 0
    with out.open("a", encoding="utf-8") as f:
        for i, row in enumerate(rows):
            if row["id"] in done:
                continue  # dilanjutkan: yang sudah berhasil tidak diulang (hemat kuota)
            if i and delay:
                sleep(delay)
            image_b64 = base64.b64encode((paths.images / row["file"]).read_bytes()).decode()
            started = clock()
            result = runner(image_b64, lang, context_of(row) if use_context else None)
            latency = round((clock() - started) * 1000)
            rec = {"run": run, "id": row["id"], "provider": provider, "model": result.pop("model", None) or runner.model,
                   "fewshot": runner.fewshot, "latency_ms": latency, "lang": lang,
                   "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **result}
            if runner.secret:  # jaga-jaga: kunci tidak pernah tertulis ke berkas
                rec = json.loads(json.dumps(rec, ensure_ascii=False).replace(runner.secret, "[DISAMARKAN]"))
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            if rec.get("error"):
                log(f"[galat] {row['id']}: {rec['error']} {rec.get('error_message', '')}")
                busy_streak = busy_streak + 1 if rec["error"] == "MODEL_BUSY" else 0
                if busy_streak >= 3:
                    log("Berhenti: 3 kali berturut-turut MODEL_BUSY (kuota habis/terbatas). Catat ini di laporan.")
                    break
            else:
                busy_streak = 0
                log(f"[ok] {row['id']} {latency} ms · {rec.get('jenis') or '-'} · {rec.get('text', '')[:90]}")
    return out


# ---------------------------------------------------------------------------
# score
# ---------------------------------------------------------------------------
def candidate_text(pred: dict) -> str:
    """Yang dibandingkan dengan acuan: ringkasan + detail (tanpa label jenis & teks di gambar)."""
    joined = " ".join(x for x in (pred.get("ringkasan"), pred.get("detail")) if x)
    return joined or pred.get("text") or ""


def latest_by_id(preds: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for p in preds:
        if p["id"] not in out or not p.get("error") or out[p["id"]].get("error"):
            out[p["id"]] = p  # baris berhasil terakhir menang
    return out


def score_run(paths: Paths, run: str, exclude: set[str] = frozenset()) -> dict:
    refs = {r["id"]: r for r in read_csv(paths.references) if r.get("acuan_1", "").strip() and r["id"] not in exclude}
    preds = latest_by_id(read_jsonl(paths.prediction_file(run)))
    ratings = {r["id"]: r["nilai"] for r in read_csv(paths.ratings) if r["run"] == run and r["id"] not in exclude}

    attempted = [p for i, p in preds.items() if i not in exclude]
    ok = [p for p in attempted if not p.get("error")]
    errors: dict[str, int] = {}
    for p in attempted:
        if p.get("error"):
            errors[p["error"]] = errors.get(p["error"], 0) + 1

    lat = [p["latency_ms"] for p in ok]
    scored = [p for p in ok if p["id"] in refs]
    cands = [candidate_text(p) for p in scored]
    references = [[refs[p["id"]]["acuan_1"], refs[p["id"]].get("acuan_2", "")] for p in scored]

    jenis_pairs = [(p.get("jenis"), refs[p["id"]].get("jenis")) for p in scored if refs[p["id"]].get("jenis")]
    jenis_known = [(a, b) for a, b in jenis_pairs if a]
    n_rated = len(ratings)
    akurat = sum(1 for v in ratings.values() if v == "akurat")
    lunak = sum(1 for v in ratings.values() if v in ("akurat", "sebagian"))

    res = {
        "run": run,
        "model": ok[0]["model"] if ok else (attempted[0]["model"] if attempted else ""),
        "provider": (ok or attempted or [{}])[0].get("provider", ""),
        "fewshot": (ok or attempted or [{}])[0].get("fewshot"),
        "n_attempted": len(attempted), "n_ok": len(ok), "errors": errors, "n_scored": len(scored),
        "n_rated": n_rated, "akurat": akurat, "akurat_sebagian": lunak,
        "acc": akurat / n_rated if n_rated else None, "acc_ci": metrics.wilson(akurat, n_rated),
        "acc_lunak": lunak / n_rated if n_rated else None, "acc_lunak_ci": metrics.wilson(lunak, n_rated),
        "rating_counts": {v: sum(1 for x in ratings.values() if x == v) for v in ("akurat", "sebagian", "salah")},
        "jenis_n": len(jenis_known),
        "jenis_acc": (sum(1 for a, b in jenis_known if a == b) / len(jenis_known)) if jenis_known else None,
        "p50": metrics.percentile(lat, 50) if lat else None,
        "p95": metrics.percentile(lat, 95) if lat else None,
        "fast": (sum(1 for x in lat if x <= FAST_MS) / len(lat)) if lat else None,
        **(metrics.corpus_bleu(cands, references) if scored else {f"bleu{n}": None for n in range(1, 5)}),
        "rougeL": metrics.corpus_rouge_l(cands, references) if scored else None,
        "cider": metrics.cider_d(cands, references) if scored else None,
        "ratings": ratings,
        "examples": [p for p in ok[:5]],
    }
    return res


def compare(a: dict, b: dict) -> dict:
    """Perbandingan berpasangan penilaian manusia pada gambar yang dinilai di kedua run."""
    order = {"salah": 0, "sebagian": 1, "akurat": 2}
    common = sorted(set(a["ratings"]) & set(b["ratings"]))
    wins = sum(1 for i in common if order[a["ratings"][i]] > order[b["ratings"][i]])
    losses = sum(1 for i in common if order[a["ratings"][i]] < order[b["ratings"][i]])
    return {"n": len(common), "menang": wins, "seri": len(common) - wins - losses, "kalah": losses}


def _f(x, pct=False, digits=3):
    if x is None:
        return "–"
    return f"{x * 100:.1f}%" if pct else f"{x:.{digits}f}"


def render_report(results: list[dict], exclude: set[str], manifest_n: int, refs_n: int) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        "# Laporan evaluasi deskripsi gambar NaraVisi",
        "",
        f"Dibuat {now} oleh `eval/run_eval.py score`. Dataset: {manifest_n} gambar di manifest, {refs_n} punya acuan."
        + (f" {len(exclude)} gambar yang dipakai sebagai contoh few-shot **tidak ikut dinilai**." if exclude else ""),
        "",
        "Angka di bawah dihitung otomatis dari berkas prediksi dan penilaian; tidak ada yang diisi tangan.",
        "",
        "## Ringkasan per run",
        "",
        "| Run | Model | Few-shot | Berhasil | Dinilai manusia | Akurat (Wilson 95%) | Akurat+Sebagian (Wilson 95%) | Jenis benar | p50 | p95 | ≤ 5 dtk |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        ci = r["acc_ci"]
        ci2 = r["acc_lunak_ci"]
        jen = f"{_f(r['jenis_acc'], True)} (n={r['jenis_n']})" if r["jenis_n"] else "– (tidak memberi jenis)"
        lines.append(
            f"| {r['run']} | {r['model']} | {r['fewshot'] if r['fewshot'] is not None else '–'} | {r['n_ok']}/{r['n_attempted']} | {r['n_rated']} | "
            f"{_f(r['acc'], True)} [{_f(ci[0], True)}–{_f(ci[1], True)}] | {_f(r['acc_lunak'], True)} [{_f(ci2[0], True)}–{_f(ci2[1], True)}] | "
            f"{jen} | {_f(r['p50'], digits=0)} ms | {_f(r['p95'], digits=0)} ms | {_f(r['fast'], True)} |"
        )
    lines += [
        "",
        "## Metrik otomatis (dibanding acuan manusia)",
        "",
        "| Run | n | BLEU-1 | BLEU-2 | BLEU-3 | BLEU-4 | ROUGE-L | CIDEr-D |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        lines.append(f"| {r['run']} | {r['n_scored']} | {_f(r['bleu1'])} | {_f(r['bleu2'])} | {_f(r['bleu3'])} | {_f(r['bleu4'])} | {_f(r['rougeL'])} | {_f(r['cider'])} |")
    lines += [
        "",
        "Kandidat = ringkasan + detail (tanpa label jenis dan tanpa teks di gambar). Dengan acuan sedikit dan kalimat bebas,",
        "BLEU/CIDEr cenderung rendah walau deskripsinya benar; penilaian manusia adalah ukuran utama.",
    ]
    errs = [(r["run"], r["errors"]) for r in results if r["errors"]]
    if errs:
        lines += ["", "## Galat", ""]
        for run, e in errs:
            lines.append(f"- **{run}**: " + ", ".join(f"{k} × {v}" for k, v in sorted(e.items())))
    if len(results) >= 2:
        lines += ["", "## Perbandingan berpasangan (penilaian manusia)", "", "| A vs B | Gambar sama | A lebih baik | Seri | B lebih baik |", "|---|---|---|---|---|"]
        for i, a in enumerate(results):
            for b in results[i + 1:]:
                c = compare(a, b)
                lines.append(f"| {a['run']} vs {b['run']} | {c['n']} | {c['menang']} | {c['seri']} | {c['kalah']} |")
    lines += ["", "## Contoh keluaran", ""]
    for r in results:
        lines.append(f"**{r['run']}**")
        lines.append("")
        for p in r["examples"]:
            lines.append(f"- `{p['id']}` ({p['latency_ms']} ms, jenis: {p.get('jenis') or '–'}): {p.get('text', '')}")
        if not r["examples"]:
            lines.append("- (tidak ada keluaran yang berhasil)")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def score(paths: Paths, runs: list[str], include_fewshot: bool = False, out: Path | None = None) -> Path:
    exclude: set[str] = set()
    if not include_fewshot and paths.fewshot.is_file():
        exclude = set(json.loads(paths.fewshot.read_text(encoding="utf-8")).get("ids", []))
    results = [score_run(paths, run, exclude) for run in runs]
    refs_n = sum(1 for r in read_csv(paths.references) if r.get("acuan_1", "").strip())
    report = render_report(results, exclude, len(read_csv(paths.manifest)), refs_n)
    out = out or paths.reports / "laporan.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("predict", help="jalankan model pada gambar dataset")
    p.add_argument("--provider", choices=["gemini", "blip", "mock", "http"], required=True)
    p.add_argument("--run", required=True, help="nama run, mis. gemini-2026-10-27")
    p.add_argument("--url", default="http://127.0.0.1:8000/caption", help="untuk --provider http")
    p.add_argument("--limit", type=int)
    p.add_argument("--ids", nargs="*")
    p.add_argument("--all", action="store_true", help="juga gambar yang belum punya acuan")
    p.add_argument("--lang", choices=["id", "en"], default="id")
    p.add_argument("--no-context", action="store_true", help="jangan kirim alt/keterangan/judul halaman")
    p.add_argument("--delay", type=float, help="jeda antar-gambar (dtk); bawaan 4 untuk gemini (batas RPM gratis), 0 lainnya")

    s = sub.add_parser("score", help="hitung skor & tulis laporan.md")
    s.add_argument("--runs", nargs="+", required=True)
    s.add_argument("--include-fewshot", action="store_true", help="ikut nilai gambar yang dipakai sebagai few-shot")
    s.add_argument("--out", type=Path)

    args = ap.parse_args(argv)
    paths = Paths(args.data)
    if args.cmd == "predict":
        rows = select_rows(paths, args.ids, args.limit, only_referenced=not args.all)
        if not rows:
            print("Tidak ada gambar yang cocok. Isi acuan dulu (annotate.py) atau pakai --all.")
            return 1
        runner = HttpRunner(args.url) if args.provider == "http" else LocalRunner(args.provider)
        delay = args.delay if args.delay is not None else (4.0 if args.provider == "gemini" else 0.0)
        out = predict(paths, args.run, runner, rows, lang=args.lang, use_context=not args.no_context, delay=delay, provider=args.provider)
        print(f"Prediksi ditulis ke {out}")
    else:
        out = score(paths, args.runs, include_fewshot=args.include_fewshot, out=args.out)
        print(f"Laporan ditulis ke {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
