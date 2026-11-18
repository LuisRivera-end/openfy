$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$native = Join-Path $projectRoot 'desktop\Openfy.Windows\bin\Release\net10.0-windows10.0.26100.0\win-x64\Openfy.exe'
if (Test-Path -LiteralPath $native) {
  $owned = Get-Process Openfy -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $native }
  if ($owned) {
    Start-Process -FilePath $native -ArgumentList '--shutdown' -WindowStyle Hidden -Wait
    foreach ($process in $owned) { try { Wait-Process -Id $process.Id -Timeout 8 -ErrorAction Stop } catch { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue } }
  }
}
$pidFile = Join-Path $projectRoot '.openfy.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No hay un servidor iniciado por Openfy.'; exit 0 }
$serverInfo = (Get-Content -LiteralPath $pidFile -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json
$expectedEntry = Join-Path $projectRoot 'scripts\serve.mjs'
if ($serverInfo.entry -ne $expectedEntry) { throw 'El registro de proceso no pertenece a este proyecto.' }
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($serverInfo.pid)" -ErrorAction SilentlyContinue
if ($processInfo) {
  if (-not $processInfo.CommandLine.Contains($expectedEntry)) { throw 'El PID pertenece a otro proceso; no se detendrá.' }
  # Stop the owned process tree too, so an interrupted FFmpeg job cannot keep
  # writing after the server has stopped. The next start requeues running jobs.
  & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $serverInfo.pid /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener el proceso de Openfy.' }
}
Remove-Item -LiteralPath $pidFile
Write-Host 'Openfy se ha detenido.'
