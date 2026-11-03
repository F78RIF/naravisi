<#
.SYNOPSIS
  Menjalankan semua tes otomatis NaraVisi: backend (node --test), ai-service (pytest), e2e (Playwright).

.DESCRIPTION
  Tidak butuh MySQL, internet, atau kunci Gemini: backend memakai SQLite di memori, AI dipalsukan.
  Keluar dengan kode 1 bila ada bagian yang gagal. Setiap bagian tetap dijalankan walau bagian sebelumnya gagal.

.PARAMETER TanpaE2E
  Lewati uji end-to-end (paling lama, butuh Chromium Playwright).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\run-all-tests.ps1
#>
param([switch]$TanpaE2E)

$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'ai-service\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }

$hasil = [ordered]@{}
function Jalankan([string]$nama, [string]$folder, [scriptblock]$perintah) {
  Write-Host "`n=== $nama ===" -ForegroundColor Cyan
  Push-Location (Join-Path $root $folder)
  try {
    & $perintah
    $hasil[$nama] = ($LASTEXITCODE -eq 0)
  } catch {
    Write-Host $_ -ForegroundColor Red
    $hasil[$nama] = $false
  } finally {
    Pop-Location
  }
}

Jalankan 'backend (node --test)' 'backend' { npm test }
Jalankan 'ai-service (pytest)' 'ai-service' { & $py -m pytest -q }
if (-not $TanpaE2E) { Jalankan 'e2e (Playwright)' 'e2e' { npm test } }

Write-Host "`n=== Ringkasan ===" -ForegroundColor Cyan
foreach ($k in $hasil.Keys) {
  if ($hasil[$k]) { Write-Host "  LULUS  $k" -ForegroundColor Green } else { Write-Host "  GAGAL  $k" -ForegroundColor Red }
}
if ($hasil.Values -contains $false) { exit 1 }
exit 0
