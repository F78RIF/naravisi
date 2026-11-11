<#
.SYNOPSIS
  Menjalankan NaraVisi agar bisa dipakai orang lain lewat internet dari laptop ini (gratis, Cloudflare Tunnel).

.DESCRIPTION
  Urutan: MySQL -> layanan AI (port 8000) -> Cloudflare Tunnel (alamat https acak) -> backend (port 3000)
  dengan PUBLIC_URL diisi otomatis dari alamat tunnel. Backend dijalankan SETELAH tunnel karena PUBLIC_URL
  harus sudah diketahui saat backend start (dipakai untuk halaman kembali dari Midtrans).

  Setiap layanan dibuka di jendela PowerShell sendiri agar lognya terlihat; tutup jendelanya untuk menghentikan.
  PUBLIC_URL dan APP_ENV hanya diberikan ke proses yang dijalankan skrip ini (variabel lingkungan proses).
  Berkas .env TIDAK diubah, dibaca, atau ditampilkan isinya (kecuali baris DB_DRIVER untuk tahu perlu MySQL atau tidak).

  Syarat sekali saja:
    - cloudflared terpasang:  winget install --id Cloudflare.cloudflared   (lihat deploy/CLOUDFLARE_TUNNEL.md)
    - ai-service\.venv + ai-service\.env, backend\node_modules + backend\.env (lihat README "Menjalankan di laptop")
    - Mode production (bawaan) butuh kunci lengkap di kedua .env, lihat README bagian "Mode production".

  Batasan: alamat https berganti SETIAP kali skrip dijalankan, dan laptop harus tetap menyala & terhubung internet.

.PARAMETER Mode
  production (bawaan, untuk orang lain) atau development (hanya untuk mencoba tunnel; JANGAN dibagikan).

.PARAMETER MysqldPath
  Lokasi mysqld.exe bila tidak terdeteksi otomatis (service Windows, Laragon, XAMPP).

.PARAMETER TimeoutDetik
  Batas tunggu tiap layanan siap (bawaan 180 detik).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start-online.ps1
#>
param(
  [ValidateSet('production', 'development')]
  [string]$Mode = 'production',
  [string]$MysqldPath = '',
  [int]$TimeoutDetik = 180
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ai = Join-Path $root 'ai-service'
$backend = Join-Path $root 'backend'
$py = Join-Path $ai '.venv\Scripts\python.exe'
$logDir = Join-Path $env:TEMP 'naravisi-online'
$tunnelLog = Join-Path $logDir 'cloudflared.log'

function Gagal([string]$pesan) { Write-Host "GAGAL: $pesan" -ForegroundColor Red; exit 1 }
function Periksa([bool]$syarat, [string]$pesan) { if (-not $syarat) { Gagal $pesan } }
function Port-Terpakai([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Tunggu-Sehat([string]$nama, [string]$url) {
  $batas = (Get-Date).AddSeconds($TimeoutDetik)
  Write-Host "Menunggu $nama ($url) ..." -NoNewline
  while ((Get-Date) -lt $batas) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { Write-Host ' siap.' -ForegroundColor Green; return $true }
    } catch { }
    Write-Host '.' -NoNewline
    Start-Sleep -Seconds 2
  }
  Write-Host " belum siap setelah $TimeoutDetik detik. Lihat log di jendelanya." -ForegroundColor Yellow
  return $false
}

# --- 0. Syarat ---------------------------------------------------------------
Periksa (Test-Path $py) 'ai-service\.venv belum ada. Lihat README: python -m venv .venv lalu pip install -r requirements.txt'
Periksa (Test-Path (Join-Path $ai '.env')) 'ai-service\.env belum ada. Salin dari .env.example lalu isi.'
Periksa (Test-Path (Join-Path $backend 'node_modules')) 'backend\node_modules belum ada. Jalankan: cd backend; npm install'
Periksa (Test-Path (Join-Path $backend '.env')) 'backend\.env belum ada. Salin dari .env.example lalu isi.'

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  foreach ($c in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) {
    if (Test-Path $c) { $cloudflared = $c; break }
  }
}
Periksa ([bool]$cloudflared) 'cloudflared belum terpasang. Jalankan: winget install --id Cloudflare.cloudflared  lalu buka PowerShell baru.'

foreach ($p in 3000, 8000) {
  Periksa (-not (Port-Terpakai $p)) "Port $p sudah dipakai (NaraVisi lama masih jalan?). Tutup jendela layanannya dulu."
}

if ($Mode -eq 'development') {
  Write-Host 'PERINGATAN: mode development lewat internet hanya untuk mencoba tunnel. Jangan bagikan alamatnya.' -ForegroundColor Yellow
}

# --- 1. MySQL ----------------------------------------------------------------
$dbLine = Select-String -Path (Join-Path $backend '.env') -Pattern '^\s*DB_DRIVER\s*=' | Select-Object -First 1
$driver = if ($dbLine) { ($dbLine.Line -split '=', 2)[1].Trim().Trim('"').ToLower() } else { 'mysql' }

if ($driver -ne 'mysql') {
  Write-Host "Basis data: $driver (MySQL tidak diperlukan)."
} elseif (Port-Terpakai 3306) {
  Write-Host 'MySQL sudah berjalan (port 3306).' -ForegroundColor Green
} else {
  $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'mysql|maria' } | Select-Object -First 1
  if (-not $MysqldPath -and $svc) {
    Write-Host "Menyalakan service $($svc.Name) ..."
    try { Start-Service $svc.Name } catch { Gagal "service $($svc.Name) tidak bisa dinyalakan (butuh PowerShell Administrator?)." }
  } else {
    if (-not $MysqldPath) {
      # Laragon: pakai versi aktif dari usr\laragon.ini; XAMPP: lokasi bawaannya.
      $ver = $null
      $ini = 'C:\laragon\usr\laragon.ini'
      if (Test-Path $ini) {
        $v = Select-String -Path $ini -Pattern '^Version=(mysql-.+)$' | Select-Object -First 1
        if ($v) { $ver = $v.Matches[0].Groups[1].Value.Trim() }
      }
      $calon = @()
      if ($ver) { $calon += "C:\laragon\bin\mysql\$ver\bin\mysqld.exe" }
      $calon += @(Get-ChildItem 'C:\laragon\bin\mysql\*\bin\mysqld.exe' -ErrorAction SilentlyContinue | ForEach-Object FullName)
      $calon += 'C:\xampp\mysql\bin\mysqld.exe'
      $MysqldPath = $calon | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    }
    Periksa ([bool]$MysqldPath) 'MySQL tidak ditemukan. Nyalakan MySQL sendiri (mis. Laragon: Start All) atau isi -MysqldPath.'
    $myIni = Join-Path (Split-Path -Parent (Split-Path -Parent $MysqldPath)) 'my.ini'
    Write-Host "Menyalakan MySQL: $MysqldPath"
    if (Test-Path $myIni) {
      Start-Process -FilePath $MysqldPath -ArgumentList "--defaults-file=`"$myIni`"" -WindowStyle Minimized | Out-Null
    } else {
      Start-Process -FilePath $MysqldPath -WindowStyle Minimized | Out-Null
    }
  }
  $batas = (Get-Date).AddSeconds(60)
  while (-not (Port-Terpakai 3306) -and (Get-Date) -lt $batas) { Start-Sleep -Seconds 1 }
  Periksa (Port-Terpakai 3306) 'MySQL tidak menyala dalam 60 detik.'
  Write-Host 'MySQL siap (port 3306).' -ForegroundColor Green
}

# --- 2. Layanan AI -----------------------------------------------------------
Write-Host 'Menjalankan layanan AI (port 8000) ...'
Start-Process powershell -WorkingDirectory $ai -ArgumentList @(
  '-NoExit', '-Command', "`$env:APP_ENV='$Mode'; & '$py' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env"
) | Out-Null
if (-not (Tunggu-Sehat 'layanan AI' 'http://127.0.0.1:8000/health')) { Gagal 'layanan AI tidak siap. Baca pesan di jendela layanan AI.' }

# --- 3. Cloudflare Tunnel ----------------------------------------------------
New-Item -ItemType Directory -Force $logDir | Out-Null
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
Write-Host 'Membuka Cloudflare Tunnel ke http://localhost:3000 ...'
# cloudflared menulis lognya ke stderr; Tee-Object menyimpannya agar alamat https bisa dibaca skrip ini.
# -EncodedCommand: perintah dikirim utuh (tanda kutip tidak hilang seperti pada -Command lewat Start-Process).
$tunnelCmd = "& '$cloudflared' tunnel --no-autoupdate --url http://localhost:3000 2>&1 | ForEach-Object { `"`$_`" } | Tee-Object -FilePath '$tunnelLog'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($tunnelCmd))
Start-Process powershell -ArgumentList @('-NoExit', '-EncodedCommand', $encoded) | Out-Null

$url = $null
$batas = (Get-Date).AddSeconds(60)
Write-Host 'Menunggu alamat https dari Cloudflare ...' -NoNewline
while (-not $url -and (Get-Date) -lt $batas) {
  Start-Sleep -Seconds 1
  Write-Host '.' -NoNewline
  if (Test-Path $tunnelLog) {
    $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) { Write-Host ''; Gagal "alamat tunnel tidak muncul dalam 60 detik. Lihat jendela cloudflared atau $tunnelLog" }
Write-Host " $url" -ForegroundColor Green

# --- 4. Backend dengan PUBLIC_URL otomatis -----------------------------------
Write-Host "Menjalankan backend (port 3000, APP_ENV=$Mode, PUBLIC_URL=$url) ..."
# Variabel proses menang atas backend\.env (node --env-file tidak menimpa variabel yang sudah ada).
Start-Process powershell -WorkingDirectory $backend -ArgumentList @(
  '-NoExit', '-Command', "`$env:APP_ENV='$Mode'; `$env:PUBLIC_URL='$url'; npm start"
) | Out-Null
if (-not (Tunggu-Sehat 'backend' 'http://localhost:3000/api/v1/health')) {
  Gagal 'backend tidak siap. Di mode production, baca daftar yang belum lengkap di jendela backend.'
}
# Alamat trycloudflare baru kadang butuh beberapa detik sebelum bisa dijangkau dari internet.
$publikOk = Tunggu-Sehat 'alamat publik' "$url/api/v1/health"

try { Set-Clipboard -Value "$url/api/v1" } catch { }
Write-Host ''
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host " NaraVisi online: $url" -ForegroundColor Cyan
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host "  Alamat API untuk extension : $url/api/v1   (sudah disalin ke clipboard)"
Write-Host "  Dashboard Admin            : $url/admin/"
Write-Host "  Webhook Midtrans Sandbox   : $url/api/v1/payments/notification"
Write-Host ''
Write-Host 'Langkah berikutnya:'
Write-Host '  1. Extension: Pengaturan > Koneksi server > tempel alamat API > Simpan alamat'
Write-Host '  2. (Opsional) dashboard.sandbox.midtrans.com > Settings > Payment > Notification URL: isi alamat webhook di atas'
Write-Host '     Tanpa webhook pun status bayar tetap diperiksa saat pengguna membuka halaman Premium.'
Write-Host '  Alamat ini BERGANTI setiap skrip dijalankan; laptop harus tetap menyala.'
Write-Host '  Berhenti: tutup jendela backend, cloudflared, dan layanan AI.'
if (-not $publikOk) { exit 1 }
