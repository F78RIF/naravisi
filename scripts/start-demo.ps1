<#
.SYNOPSIS
  Menjalankan stack demo NaraVisi: layanan AI (FastAPI) dan backend (Express), lalu menunggu /health siap.

.DESCRIPTION
  Setiap layanan dibuka di jendela PowerShell sendiri agar lognya terlihat; tutup jendelanya untuk menghentikan.
  Syarat (sekali saja, lihat README bagian "Menjalankan di laptop"):
    - ai-service/.venv sudah dibuat dan requirements terpasang, ai-service/.env sudah diisi
    - backend: npm install, backend/.env sudah diisi, npm run db:setup (atau DB_DRIVER=sqlite)
  Skrip ini tidak membaca atau menampilkan isi berkas .env.

.PARAMETER Contoh
  Juga menyajikan folder examples/ di http://127.0.0.1:8080/halaman-uji.html (python -m http.server).

.PARAMETER TimeoutDetik
  Batas tunggu /health tiap layanan (bawaan 180 detik; unduhan model BLIP pertama bisa lebih lama).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start-demo.ps1 -Contoh
#>
param(
  [switch]$Contoh,
  [int]$TimeoutDetik = 180
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ai = Join-Path $root 'ai-service'
$backend = Join-Path $root 'backend'
$py = Join-Path $ai '.venv\Scripts\python.exe'

function Periksa([bool]$syarat, [string]$pesan) {
  if (-not $syarat) { Write-Host "GAGAL: $pesan" -ForegroundColor Red; exit 1 }
}
Periksa (Test-Path $py) 'ai-service\.venv belum ada. Lihat README: python -m venv .venv lalu pip install -r requirements.txt'
Periksa (Test-Path (Join-Path $ai '.env')) 'ai-service\.env belum ada. Salin dari .env.example lalu isi.'
Periksa (Test-Path (Join-Path $backend 'node_modules')) 'backend\node_modules belum ada. Jalankan: cd backend; npm install'
Periksa (Test-Path (Join-Path $backend '.env')) 'backend\.env belum ada. Salin dari .env.example lalu isi.'

function Tunggu-Sehat([string]$nama, [string]$url) {
  $batas = (Get-Date).AddSeconds($TimeoutDetik)
  Write-Host "Menunggu $nama ($url) ..." -NoNewline
  while ((Get-Date) -lt $batas) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { Write-Host " siap." -ForegroundColor Green; return $true }
    } catch { }
    Write-Host '.' -NoNewline
    Start-Sleep -Seconds 2
  }
  Write-Host " belum siap setelah $TimeoutDetik detik. Lihat log di jendelanya." -ForegroundColor Yellow
  return $false
}

Write-Host 'Menjalankan layanan AI (port 8000) ...'
Start-Process powershell -WorkingDirectory $ai -ArgumentList @(
  '-NoExit', '-Command', "& '$py' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env"
) | Out-Null
$aiOk = Tunggu-Sehat 'layanan AI' 'http://127.0.0.1:8000/health'

Write-Host 'Menjalankan backend (port 3000) ...'
Start-Process powershell -WorkingDirectory $backend -ArgumentList @('-NoExit', '-Command', 'npm start') | Out-Null
$beOk = Tunggu-Sehat 'backend' 'http://localhost:3000/api/v1/health'

if ($Contoh) {
  Write-Host 'Menyajikan examples/ di port 8080 ...'
  Start-Process powershell -WorkingDirectory (Join-Path $root 'examples') -ArgumentList @(
    '-NoExit', '-Command', "& '$py' -m http.server 8080 --bind 127.0.0.1"
  ) | Out-Null
  $null = Tunggu-Sehat 'halaman contoh' 'http://127.0.0.1:8080/halaman-uji.html'
}

Write-Host ''
Write-Host 'Langkah berikutnya:'
Write-Host '  1. chrome://extensions -> Developer mode -> Load unpacked -> folder extension\ (sekali saja)'
Write-Host '  2. Masuk lewat ikon NaraVisi, buka halaman berisi gambar, tekan Alt+Shift+K'
if ($Contoh) { Write-Host '     Halaman contoh: http://127.0.0.1:8080/halaman-uji.html' }
Write-Host '  Dashboard Admin: http://localhost:3000/admin/'
if (-not ($aiOk -and $beOk)) { exit 1 }
