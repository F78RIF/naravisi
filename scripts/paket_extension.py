"""Membuat paket ZIP extension NaraVisi untuk dipasang / diunggah ke Chrome Web Store.

Hasil: dist/naravisi-extension-<versi manifest>.zip
- manifest.json berada di akar ZIP (syarat Chrome Web Store),
- jalur memakai garis miring "/" (Compress-Archive bawaan Windows PowerShell 5.1 memakai "\\" yang ditolak),
- hanya berkas yang dipakai extension; berkas sumber ikon (*.svg di icons/ selain yang dirujuk) tetap ikut karena kecil.
Setelah dibuat, isi ZIP diperiksa: setiap berkas yang dirujuk manifest harus ada.

Pemakaian (dari folder repo):  python -I scripts/paket_extension.py
"""
import hashlib
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
DIST = ROOT / "dist"
SKIP_NAMES = {".DS_Store", "Thumbs.db"}
SKIP_SUFFIXES = {".map", ".tmp"}


def referenced_files(manifest):
    refs = {manifest["background"]["service_worker"], manifest["action"]["default_popup"]}
    refs.update(manifest.get("icons", {}).values())
    refs.update(manifest["action"].get("default_icon", {}).values())
    if manifest.get("options_page"):
        refs.add(manifest["options_page"])
    return refs


def main():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    DIST.mkdir(exist_ok=True)
    out = DIST / f"naravisi-extension-{version}.zip"

    files = sorted(
        p for p in EXT.rglob("*")
        if p.is_file() and p.name not in SKIP_NAMES and p.suffix not in SKIP_SUFFIXES
    )
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in files:
            zf.write(p, p.relative_to(EXT).as_posix())

    with zipfile.ZipFile(out) as zf:
        names = set(zf.namelist())
        bad = [n for n in names if "\\" in n]
        missing = sorted(r for r in referenced_files(manifest) if r not in names)
        if "manifest.json" not in names or bad or missing:
            print(f"GAGAL: manifest di akar={('manifest.json' in names)}, jalur '\\'={bad}, hilang={missing}")
            return 1
        packed = json.loads(zf.read("manifest.json"))

    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"Paket   : {out.relative_to(ROOT).as_posix()}")
    print(f"Versi   : {packed['version']}")
    print(f"Berkas  : {len(names)}")
    print(f"Ukuran  : {out.stat().st_size / 1024:.1f} KB")
    print(f"SHA-256 : {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
