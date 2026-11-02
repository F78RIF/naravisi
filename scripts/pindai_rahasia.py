"""Pemindai rahasia sederhana untuk repo NaraVisi (tanpa dependensi).

Memindai:
  1. semua berkas yang dilacak git saat ini,
  2. seluruh riwayat git (setiap baris yang pernah ditambahkan di commit mana pun),
  3. berkas .env yang pernah masuk riwayat, beserta ukurannya.

Nilai rahasia TIDAK pernah dicetak: hanya jenis, lokasi, dan panjangnya.
Keluar dengan kode 1 bila ada temuan, 0 bila bersih.

Pemakaian (dari folder repo):  python -I scripts/pindai_rahasia.py
"""
import pathlib
import re
import subprocess
import sys

REPO = str(pathlib.Path(__file__).resolve().parent.parent)

PATTERNS = {
    "Google API key": re.compile(r"AIza[0-9A-Za-z_\-]{35}"),
    "Midtrans key": re.compile(r"(?:SB-)?Mid-(?:server|client)-[A-Za-z0-9_\-]{8,}"),
    "Private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "GitHub token": re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"),
    "Slack token": re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"),
    "JWT": re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
    "Hugging Face token": re.compile(r"hf_[A-Za-z0-9]{30,}"),
    # KUNCI=nilai di berkas konfigurasi/kode (nilai harfiah ≥ 8 karakter)
    "Penugasan rahasia": re.compile(
        r"^\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|PASSWORD|API_KEY|SERVER_KEY|TOKEN|PRIVATE)[A-Z0-9_]*\s*[=:]\s*['\"]?([^\s'\"#,;]{8,})",
        re.M,
    ),
}

# Nilai yang jelas bukan rahasia: placeholder dokumen/.env.example, nilai uji, atau ekspresi kode.
NOT_SECRET = re.compile(
    r"(ganti|change|contoh|example|isi[-_]|xxx|your|dummy|rahasia-uji|placeholder|test|uji|"
    r"\$\{|<|process\.env|os\.getenv|^re\.|\(|^\w+\.\w+\()",
    re.I,
)
SKIP_PATH = re.compile(
    r"(^|/)(node_modules|\.venv|dist)/|package-lock\.json$|"
    r"\.(png|jpe?g|gif|avif|webp|ico|pdf|docx|zip|woff2?|ttf|mp4|webm)$",
    re.I,
)
ENV_FILE = re.compile(r"(^|/)[^/]*\.env($|\.)")


def git(*args):
    res = subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return res.stdout


def scan(text):
    for kind, rx in PATTERNS.items():
        for m in rx.finditer(text):
            value = m.group(1) if kind == "Penugasan rahasia" else m.group(0)
            if kind == "Penugasan rahasia" and NOT_SECRET.search(value):
                continue
            yield kind, len(value)


def main():
    findings = []

    tracked = [p for p in git("ls-files").splitlines() if p and not SKIP_PATH.search(p)]
    env_tracked = [p for p in tracked if ENV_FILE.search(p) and not p.endswith(".example")]
    for path in tracked:
        try:
            text = pathlib.Path(REPO, path).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for kind, n in scan(line):
                findings.append(f"SEKARANG  {path}:{lineno}  {kind} ({n} karakter)")

    commit, path = "?", "?"
    for line in git("log", "--all", "-p", "--no-color", "--unified=0", "--format=@@COMMIT %h").splitlines():
        if line.startswith("@@COMMIT "):
            commit = line.split()[1]
        elif line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else "?"
        elif line.startswith("+") and not SKIP_PATH.search(path):
            for kind, n in scan(line[1:]):
                findings.append(f"RIWAYAT {commit}  {path}  {kind} ({n} karakter)")

    env_history = []
    cur = "?"
    for line in git("log", "--all", "--name-status", "--format=@@ %h").splitlines():
        if line.startswith("@@ "):
            cur = line[3:]
        elif "\t" in line:
            status, name = line.split("\t")[0], line.split("\t")[-1]
            if ENV_FILE.search(name) and not name.endswith(".example") and status != "D":
                size = git("cat-file", "-s", f"{cur}:{name}").strip() or "?"
                env_history.append(f"{cur} {status} {name} ({size} byte)")
                if size not in ("0", "?"):
                    findings.append(f"RIWAYAT {cur}  {name}  berkas .env berisi ({size} byte)")

    print(f"Berkas dilacak dipindai : {len(tracked)}")
    print(f"Commit di riwayat       : {git('rev-list', '--all', '--count').strip()}")
    print(f"Berkas .env dilacak     : {', '.join(env_tracked) or 'tidak ada'}")
    print(f"Berkas .env di riwayat  : {'; '.join(env_history) or 'tidak ada'}")
    print(f"Temuan                  : {len(findings)}")
    for f in findings:
        print("  " + f)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
