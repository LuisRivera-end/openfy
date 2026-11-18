param([Parameter(Mandatory)][string]$OlderInstaller, [Parameter(Mandatory)][string]$NewerInstaller, [Parameter(Mandatory)][long]$BuildNumber)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-maintenance.ps1')
$sandbox = Join-Path $env:TEMP ('openfy-build-update-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $sandbox 'Openfy') -Force | Out-Null
New-Item -ItemType File -Path (Join-Path $sandbox '.openfy-qa') | Out-Null
$reservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$reservation.Start(); $port = $reservation.LocalEndpoint.Port; $reservation.Stop()
$previousRoot = $env:OPENFY_INSTALL_TEST_ROOT
$previousPort = $env:NITRO_PORT
$previousData = $env:OPENFY_DATA_DIR
$previousState = $env:OPENFY_STATE_DIR
$env:OPENFY_INSTALL_TEST_ROOT = $sandbox
$env:NITRO_PORT = "$port"
$env:OPENFY_DATA_DIR = Join-Path $sandbox 'Openfy\data'
$env:OPENFY_STATE_DIR = Join-Path $sandbox 'Openfy\desktop'
$state = Join-Path $sandbox 'Openfy\desktop'
$exe = Join-Path $sandbox 'Programs\Openfy\Openfy.exe'
$oldApp = $null
try {
  $setup = Start-Process -FilePath $OlderInstaller -ArgumentList '--silent' -WindowStyle Hidden -PassThru
  try { if (-not $setup.WaitForExit(120000) -or $setup.ExitCode -ne 0) { throw 'No se pudo preparar la versión anterior aislada.' } } finally { $setup.Dispose() }
  $oldApp = Start-Process -FilePath $exe -ArgumentList @('--state-dir', "`"$state`"", '--data-dir', "`"$(Join-Path $sandbox 'Openfy\data')`"", '--port', $port) -WindowStyle Hidden -PassThru
  $ready = $false
  for ($i = 0; $i -lt 100; $i++) {
    try { $ready = (Invoke-RestMethod "http://127.0.0.1:$port/api/status" -TimeoutSec 1).online; if ($ready) { break } } catch { }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw 'La aplicación anterior no inició.' }
  Set-Content -LiteralPath (Join-Path $state 'preserved-test.json') -Value '{"kept":true}'
  $song = @{ song=@{ videoId='updatetest1'; title='Conservar favorita'; artists=@('Openfy'); album=$null; artwork=$null; duration=180 }; favorite=$true }
  Invoke-RestMethod "http://127.0.0.1:$port/api/music/saved" -Method Put -ContentType 'application/json' -Body ($song | ConvertTo-Json -Depth 5) | Out-Null
  Install-OpenfyBuild $NewerInstaller $BuildNumber
  $library = Invoke-RestMethod "http://127.0.0.1:$port/api/library"
  if (-not ($library.youtubeSongs | Where-Object { $_.song.videoId -eq 'updatetest1' -and $_.favorite })) { throw 'La actualización perdió la favorita de prueba.' }
  if (-not (Get-Content -LiteralPath (Join-Path $state 'preserved-test.json') -Raw | ConvertFrom-Json).kept) { throw 'La actualización perdió el estado de prueba.' }
  if (-not $oldApp.HasExited) { throw 'La aplicación sigue utilizando el proceso antiguo.' }
  if (Get-ChildItem -LiteralPath (Join-Path $sandbox 'Programs') -Directory -Filter 'Openfy.previous-*') { throw 'La instalación antigua no se eliminó tras validar la nueva.' }
  Write-Output 'Correcto: cierre ordenado, instalación y backend nuevos, favorita/estado conservados y binarios anteriores retirados.'
} finally {
  if (Test-Path -LiteralPath $exe) {
    $close = Start-Process -FilePath $exe -ArgumentList @('--state-dir', "`"$state`"", '--shutdown') -WindowStyle Hidden -PassThru
    [void]$close.WaitForExit(10000); $close.Dispose()
  }
  if ($oldApp) { $oldApp.Dispose() }
  $env:OPENFY_INSTALL_TEST_ROOT = $previousRoot
  $env:NITRO_PORT = $previousPort
  $env:OPENFY_DATA_DIR = $previousData
  $env:OPENFY_STATE_DIR = $previousState
  Write-Output "Prueba: $sandbox"
}
