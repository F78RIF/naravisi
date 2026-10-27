"""Alat anotasi lokal (hanya 127.0.0.1) — tersimpan otomatis ke CSV.

    python -m eval.annotate                 # http://127.0.0.1:8765/
    python -m eval.annotate --annotator rifat --port 8765

Fase "acuan": tulis 1–2 deskripsi ideal + jenis gambar TANPA melihat keluaran model.
Fase "nilai": nilai keluaran model sebuah run: 1 = Akurat, 2 = Sebagian, 3 = Salah.
Bisa dipakai penuh dengan keyboard (Alt+N / Alt+P berpindah gambar).
"""

from __future__ import annotations

import argparse
import html
import json
import sys
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from eval.common import (
    DEFAULT_DATA, JENIS, NILAI, RATING_FIELDS, REFERENCE_FIELDS, Paths, read_csv, read_jsonl, upsert_csv, utf8_console,
)

MAX_TEXT = 1000

PAGE = """<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Anotasi NaraVisi</title>
<style>
:root {{ color-scheme: light dark; --ink:#1b1b1f; --bg:#fbfaf7; --line:#8a8780; --accent:#7a3b00; --focus:#f2a900; }}
@media (prefers-color-scheme: dark) {{ :root {{ --ink:#f2f0ea; --bg:#17171a; --line:#8d8a83; --accent:#ffc46b; }} }}
body {{ font: 17px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--bg); margin: 0 auto; max-width: 1100px; padding: 16px; }}
a {{ color: var(--accent); }}
:focus-visible {{ outline: 3px solid var(--focus); outline-offset: 2px; }}
.grid {{ display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px; }}
@media (max-width: 800px) {{ .grid {{ grid-template-columns: 1fr; }} }}
img {{ max-width: 100%; height: auto; border: 1px solid var(--line); }}
label {{ display: block; font-weight: 600; margin-top: 12px; }}
textarea, select, input {{ font: inherit; width: 100%; box-sizing: border-box; padding: 8px; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 6px; }}
textarea {{ min-height: 90px; }}
button {{ font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }}
button[aria-pressed="true"] {{ background: var(--accent); color: var(--bg); }}
.row {{ display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }}
.hint {{ font-size: 15px; opacity: .85; }}
.out {{ border-left: 4px solid var(--accent); padding: 4px 12px; }}
nav ul {{ list-style: none; padding: 0; display: flex; gap: 16px; flex-wrap: wrap; }}
</style></head>
<body><main>
<h1>{title}</h1>
<p id="status" role="status" aria-live="polite" class="hint">{status}</p>
{body}
</main>
<script>{script}</script>
</body></html>"""

SCRIPT = r"""
const meta = JSON.parse(document.getElementById('meta')?.textContent || '{}');
const say = (t) => { const s = document.getElementById('status'); s.textContent = ''; setTimeout(() => { s.textContent = t; }, 50); };
async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NaraVisi-Anotasi': '1' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Gagal menyimpan.');
  return data;
}
const go = (d) => { const to = meta[d]; if (to) location.href = to; };
document.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); go('next'); }
  if (e.altKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); go('prev'); }
});
const form = document.getElementById('acuan');
if (form) {
  let timer;
  const save = async () => {
    const body = Object.fromEntries(new FormData(form));
    body.id = meta.id;
    try { await post('/api/acuan', body); say('Tersimpan otomatis.'); } catch (err) { say(err.message); }
  };
  form.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 600); });
  form.addEventListener('change', () => { clearTimeout(timer); save(); });
  form.addEventListener('submit', async (e) => { e.preventDefault(); clearTimeout(timer); await save(); go('next'); });
}
const rate = document.getElementById('nilai');
if (rate) {
  const choose = async (nilai) => {
    try {
      await post('/api/nilai', { id: meta.id, run: meta.run, nilai });
      rate.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.nilai === nilai)));
      say(`Tersimpan: ${nilai}.`);
      setTimeout(() => go('next'), 400);
    } catch (err) { say(err.message); }
  };
  rate.addEventListener('click', (e) => { const b = e.target.closest('button[data-nilai]'); if (b) choose(b.dataset.nilai); });
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.matches('textarea, input, select')) return;
    const map = { '1': 'akurat', '2': 'sebagian', '3': 'salah' };
    if (map[e.key]) { e.preventDefault(); choose(map[e.key]); }
  });
}
"""


def esc(x) -> str:
    return html.escape(str(x or ""), quote=True)


def script_json(data: dict) -> str:
    """JSON aman di dalam <script>: "<" di-escape agar tidak bisa menutup tag."""
    return json.dumps(data).replace("<", "\\u003c")


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class App:
    def __init__(self, paths: Paths, annotator: str = ""):
        self.paths = paths
        self.annotator = annotator

    # --- data
    def manifest(self) -> list[dict]:
        return read_csv(self.paths.manifest)

    def runs(self) -> list[str]:
        return sorted(p.stem for p in self.paths.predictions.glob("*.jsonl")) if self.paths.predictions.is_dir() else []

    def save_reference(self, body: dict) -> dict:
        ids = {r["id"] for r in self.manifest()}
        if body.get("id") not in ids:
            raise ValueError("Gambar tidak ditemukan.")
        jenis = body.get("jenis", "")
        if jenis and jenis not in JENIS:
            raise ValueError("Jenis gambar tidak dikenal.")
        row = {"id": body["id"], "jenis": jenis, "annotator": self.annotator, "updated_at": now()}
        for k in ("acuan_1", "acuan_2", "teks_dalam_gambar"):
            v = body.get(k, "")
            if not isinstance(v, str):
                raise ValueError(f"{k} harus berupa teks.")
            if len(v) > MAX_TEXT:
                raise ValueError(f"{k} maksimal {MAX_TEXT} karakter.")
            row[k] = " ".join(v.split()) if k != "teks_dalam_gambar" else v.strip()
        upsert_csv(self.paths.references, REFERENCE_FIELDS, row, ("id",))
        return {"ok": True}

    def save_rating(self, body: dict) -> dict:
        if body.get("run") not in self.runs():
            raise ValueError("Run tidak ditemukan.")
        if body.get("nilai") not in NILAI:
            raise ValueError("Nilai harus akurat, sebagian, atau salah.")
        if body.get("id") not in {r["id"] for r in self.manifest()}:
            raise ValueError("Gambar tidak ditemukan.")
        upsert_csv(self.paths.ratings, RATING_FIELDS,
                   {"run": body["run"], "id": body["id"], "nilai": body["nilai"], "annotator": self.annotator, "updated_at": now()},
                   ("run", "id"))
        return {"ok": True}

    # --- halaman
    def page(self, title: str, body: str, status: str = "") -> str:
        return PAGE.format(title=esc(title), body=body, status=esc(status), script=SCRIPT)

    def index(self) -> str:
        rows = self.manifest()
        refs = {r["id"] for r in read_csv(self.paths.references) if r.get("acuan_1", "").strip()}
        ratings = read_csv(self.paths.ratings)
        runs = "".join(
            f'<li><a href="/nilai?run={urllib.parse.quote(r)}">Nilai run <b>{esc(r)}</b></a> '
            f'({sum(1 for x in ratings if x["run"] == r)} dinilai)</li>' for r in self.runs()
        ) or "<li>Belum ada prediksi. Jalankan <code>python -m eval.run_eval predict …</code></li>"
        body = (
            f"<p>{len(rows)} gambar di manifest · {len(refs)} sudah punya acuan.</p>"
            '<h2>Fase 1 — acuan</h2><p><a href="/acuan">Tulis deskripsi acuan</a> (keluaran model tidak ditampilkan).</p>'
            f"<h2>Fase 2 — nilai</h2><ul>{runs}</ul>"
        )
        return self.page("Anotasi dataset NaraVisi", body)

    def _nav(self, rows, i, base) -> dict:
        prev = f"{base}i={i - 1}" if i > 0 else None
        nxt = f"{base}i={i + 1}" if i + 1 < len(rows) else None
        return {"prev": prev, "next": nxt}

    def _context(self, row) -> str:
        items = [("Judul halaman", row.get("page_title")), ("Keterangan", row.get("caption")), ("Alt asli", row.get("alt"))]
        dl = "".join(f"<dt>{k}</dt><dd>{esc(v)}</dd>" for k, v in items if v)
        src = f'<p class="hint">Sumber: <a href="{esc(row["page_url"])}" rel="noreferrer noopener" target="_blank">{esc(row["site"])}</a></p>' if row.get("page_url") else ""
        return (f"<dl>{dl}</dl>" if dl else "") + src

    def acuan(self, i: int) -> str:
        rows = self.manifest()
        if not rows:
            return self.page("Acuan", "<p>Manifest kosong. Jalankan <code>python -m eval.collect</code> dulu.</p>")
        i = max(0, min(i, len(rows) - 1))
        row = rows[i]
        ref = next((r for r in read_csv(self.paths.references) if r["id"] == row["id"]), {})
        options = '<option value="">Pilih jenis…</option>' + "".join(
            f'<option value="{j}"{" selected" if ref.get("jenis") == j else ""}>{j.replace("_", " ")}</option>' for j in JENIS)
        meta = {"id": row["id"], **self._nav(rows, i, "/acuan?")}
        body = f"""
<script type="application/json" id="meta">{script_json(meta)}</script>
<p class="hint">Gambar {i + 1} dari {len(rows)} · <code>{esc(row['id'])}</code> · <a href="/">Beranda</a></p>
<div class="grid">
  <figure><img src="/img/{esc(row['id'])}" alt="Gambar dataset {esc(row['id'])} yang sedang dianotasi"></figure>
  <div>
    {self._context(row)}
    <form id="acuan">
      <label for="jenis">Jenis gambar</label>
      <select id="jenis" name="jenis">{options}</select>
      <label for="acuan_1">Deskripsi acuan 1 (wajib)</label>
      <p class="hint" id="acuan_1-hint">Kalimat pertama = ringkasan ≤ 20 kata (subjek, kegiatan, latar). Lalu 1–2 kalimat detail. Tanpa "Gambar ini menunjukkan", tanpa menebak nama orang.</p>
      <textarea id="acuan_1" name="acuan_1" maxlength="{MAX_TEXT}" aria-describedby="acuan_1-hint">{esc(ref.get('acuan_1'))}</textarea>
      <label for="acuan_2">Deskripsi acuan 2 (opsional, penulis kedua)</label>
      <textarea id="acuan_2" name="acuan_2" maxlength="{MAX_TEXT}">{esc(ref.get('acuan_2'))}</textarea>
      <label for="teks_dalam_gambar">Teks di dalam gambar (opsional, satu baris per baris)</label>
      <textarea id="teks_dalam_gambar" name="teks_dalam_gambar" maxlength="{MAX_TEXT}">{esc(ref.get('teks_dalam_gambar'))}</textarea>
      <div class="row"><button type="submit">Simpan &amp; lanjut (Alt+N)</button>
      {f'<a href="{meta["prev"]}">Sebelumnya (Alt+P)</a>' if meta["prev"] else ''}</div>
    </form>
  </div>
</div>"""
        return self.page(f"Acuan {row['id']}", body)

    def nilai(self, run: str, i: int) -> str:
        if run not in self.runs():
            return self.page("Nilai", "<p>Run tidak ditemukan. <a href=\"/\">Kembali</a></p>")
        preds = {}
        for p in read_jsonl(self.paths.prediction_file(run)):
            if not p.get("error"):
                preds[p["id"]] = p
        rows = [r for r in self.manifest() if r["id"] in preds]
        if not rows:
            return self.page("Nilai", "<p>Run ini belum punya keluaran yang berhasil.</p>")
        i = max(0, min(i, len(rows) - 1))
        row, pred = rows[i], preds[rows[i]["id"]]
        ref = next((r for r in read_csv(self.paths.references) if r["id"] == row["id"]), {})
        current = next((r["nilai"] for r in read_csv(self.paths.ratings) if r["run"] == run and r["id"] == row["id"]), "")
        meta = {"id": row["id"], "run": run, **self._nav(rows, i, f"/nilai?run={urllib.parse.quote(run)}&")}
        buttons = "".join(
            f'<button type="button" data-nilai="{v}" aria-pressed="{str(current == v).lower()}">{k} · {v.capitalize()}</button>'
            for k, v in (("1", "akurat"), ("2", "sebagian"), ("3", "salah")))
        acuan = esc(ref.get("acuan_1")) or "<i>belum ada acuan</i>"
        body = f"""
<script type="application/json" id="meta">{script_json(meta)}</script>
<p class="hint">Run <b>{esc(run)}</b> · gambar {i + 1} dari {len(rows)} · <code>{esc(row['id'])}</code> · <a href="/">Beranda</a></p>
<div class="grid">
  <figure><img src="/img/{esc(row['id'])}" alt="Gambar dataset {esc(row['id'])} yang sedang dinilai"></figure>
  <div>
    <h2>Keluaran model</h2>
    <p class="out" id="keluaran">{esc(pred.get('text'))}</p>
    <p class="hint">Jenis dari model: {esc(pred.get('jenis') or '–')} · acuan: {esc(ref.get('jenis') or '–')} · {esc(pred.get('latency_ms'))} ms</p>
    <h2>Acuan</h2><p>{acuan}</p>
    <div class="row" id="nilai" role="group" aria-label="Nilai keluaran model (tekan 1, 2, atau 3)">{buttons}</div>
    <p class="hint">Akurat = benar & cukup lengkap. Sebagian = inti benar tetapi ada yang kurang/keliru kecil. Salah = objek utama salah atau menyesatkan.</p>
    <div class="row">{f'<a href="{meta["prev"]}">Sebelumnya (Alt+P)</a>' if meta["prev"] else ''} {f'<a href="{meta["next"]}">Berikutnya (Alt+N)</a>' if meta["next"] else ''}</div>
  </div>
</div>"""
        return self.page(f"Nilai {row['id']}", body)


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "NaraVisiAnotasi/1.0"

        def log_message(self, fmt, *args):  # tenang; hanya galat
            pass

        def _send(self, status: int, body: bytes, ctype: str):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _html(self, text: str, status: int = 200):
            self._send(status, text.encode("utf-8"), "text/html; charset=utf-8")

        def _json(self, data: dict, status: int = 200):
            self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

        def _host_ok(self) -> bool:
            # Tolak DNS rebinding: hanya Host 127.0.0.1/localhost.
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            return host in ("127.0.0.1", "localhost")

        def do_GET(self):
            if not self._host_ok():
                return self._html("Host tidak diizinkan.", 403)
            url = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(url.query)
            idx = int(q.get("i", ["0"])[0]) if q.get("i", ["0"])[0].isdigit() else 0
            if url.path == "/":
                return self._html(app.index())
            if url.path == "/acuan":
                return self._html(app.acuan(idx))
            if url.path == "/nilai":
                return self._html(app.nilai(q.get("run", [""])[0], idx))
            if url.path.startswith("/img/"):
                image_id = url.path[5:]
                row = next((r for r in app.manifest() if r["id"] == image_id), None)  # hanya ID di manifest (anti path traversal)
                file = app.paths.images / row["file"] if row else None
                if file and file.is_file() and file.resolve().parent == app.paths.images.resolve():
                    return self._send(200, file.read_bytes(), "image/jpeg")
            return self._html("Tidak ditemukan.", 404)

        def do_POST(self):
            # Hanya dari halaman ini: Host lokal + header khusus (formulir situs lain tidak bisa mengirimnya tanpa CORS).
            if not self._host_ok() or self.headers.get("X-NaraVisi-Anotasi") != "1":
                return self._json({"error": "Permintaan ditolak."}, 403)
            length = int(self.headers.get("Content-Length") or 0)
            if length > 64 * 1024:
                return self._json({"error": "Permintaan terlalu besar."}, 413)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(body, dict):
                    raise ValueError("Format tidak valid.")
                if self.path == "/api/acuan":
                    return self._json(app.save_reference(body))
                if self.path == "/api/nilai":
                    return self._json(app.save_rating(body))
            except ValueError as err:
                return self._json({"error": str(err)}, 400)
            return self._json({"error": "Tidak ditemukan."}, 404)

    return Handler


def serve(paths: Paths, port: int = 8765, annotator: str = "") -> ThreadingHTTPServer:
    return ThreadingHTTPServer(("127.0.0.1", port), make_handler(App(paths, annotator)))


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--annotator", default="", help="nama/inisial penilai (dicatat di CSV)")
    args = ap.parse_args(argv)
    server = serve(Paths(args.data), args.port, args.annotator)
    print(f"Alat anotasi berjalan di http://127.0.0.1:{args.port}/ (Ctrl+C untuk berhenti)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
