param(
  [string]$Executable,
  [string]$ReportDirectory,
  [switch]$Packaged,
  [switch]$Live
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Executable) { $Executable = Join-Path $projectRoot 'desktop/Openfy.Windows/bin/Release/net10.0-windows10.0.26100.0/win-x64/Openfy.exe' }
$Executable = [IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable)) { throw 'Compila el cliente de Windows o proporciona -Executable.' }
if (-not $ReportDirectory) { $ReportDirectory = Join-Path $projectRoot ('output/discord-check-' + [Guid]::NewGuid().ToString('N')) }
$ReportDirectory = [IO.Path]::GetFullPath($ReportDirectory)
$state = Join-Path $ReportDirectory 'state'
$data = Join-Path $ReportDirectory 'data'
New-Item -ItemType Directory -Path $state,$data -Force | Out-Null
$fixture = Join-Path $ReportDirectory 'discord-test.m4a'
$duration = if ($Live) { 20 } else { 4 }
& (Join-Path $projectRoot 'node_modules/ffmpeg-static/ffmpeg.exe') -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=$duration" -c:a aac -metadata 'title=Openfy - Prueba de Discord' -metadata 'artist=Openfy' -metadata 'album=Prueba de integración' $fixture
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el audio de prueba.' }
$mode = if ($Live) { '--discord-live-test' } else { '--discord-test' }
$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portProbe.Start()
try { $port = $portProbe.LocalEndpoint.Port } finally { $portProbe.Stop() }
$arguments = @('--state-dir',"`"$state`"",'--data-dir',"`"$data`"",'--port',"$port",$mode,"`"$fixture`"")
if (-not $Packaged) { $arguments += @('--workspace',"`"$projectRoot`"") }
$process = Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory $env:TEMP -WindowStyle Hidden -PassThru
try {
  if (-not $process.WaitForExit(120000)) {
    $shutdown = Start-Process -FilePath $Executable -ArgumentList @('--state-dir',"`"$state`"",'--shutdown') -WindowStyle Hidden -PassThru
    try { [void]$shutdown.WaitForExit(10000) } finally { $shutdown.Dispose() }
    throw 'La comprobación de Discord agotó el tiempo.'
  }
  $report = Join-Path $state 'discord-smoke.json'
  if (-not (Test-Path -LiteralPath $report)) { throw "No se generó el informe en $report (salida $($process.ExitCode))." }
  $result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
  if (-not $result.passed) { throw "Falló la comprobación de Discord: $($result.error)" }
  Write-Host "Discord verificado (Live=$Live). Informe: $report"
} finally { $process.Dispose() }
