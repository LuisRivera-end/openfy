$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'resolve-node.ps1')
$entry = Join-Path $projectRoot 'scripts\serve.mjs'
$pidFile = Join-Path $projectRoot '.openfy.pid'
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.output\server\index.mjs'))) { throw 'Primero ejecuta .\scripts\setup.ps1' }
if (Test-Path -LiteralPath $pidFile) {
  $previous = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($previous.pid)" -ErrorAction SilentlyContinue
  if ($processInfo -and $processInfo.CommandLine.Contains($entry)) { Write-Host 'Openfy ya está iniciado.'; exit 0 }
}
$logDirectory = Join-Path $env:LOCALAPPDATA 'Openfy\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$serverProcess = Start-Process -FilePath $openfyNode -WorkingDirectory $projectRoot -ArgumentList @('--env-file-if-exists=.env', "`"$entry`"") -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'error.log')
@{ pid = $serverProcess.Id; entry = $entry; startedAt = $serverProcess.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding utf8
Start-Sleep -Seconds 2
if ($serverProcess.HasExited) {
  Remove-Item -LiteralPath $pidFile
  throw "El servidor no pudo arrancar. Revisa $logDirectory\error.log; comprueba también que el puerto esté libre."
}
$addressLine = Get-Content -LiteralPath (Join-Path $logDirectory 'server.log') | Where-Object { $_ -like 'Listening on *' } | Select-Object -Last 1
Write-Host "Openfy está en ejecución. $addressLine"
