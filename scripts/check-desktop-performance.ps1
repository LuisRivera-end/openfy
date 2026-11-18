param([string]$Executable, [switch]$Packaged, [switch]$Navigation, [switch]$Sections)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Executable) { $Executable = Join-Path $projectRoot 'desktop\Openfy.Windows\bin\Release\net10.0-windows10.0.26100.0\win-x64\Openfy.exe' }
$runDirectory = Join-Path $projectRoot ('output\performance-check\' + [Guid]::NewGuid().ToString('N'))
$stateDirectory = Join-Path $runDirectory 'state'
$dataDirectory = Join-Path $runDirectory 'data'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$reservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$reservation.Start(); $testPort = $reservation.LocalEndpoint.Port; $reservation.Stop()
$mode = if ($Sections) { '--sections-check' } elseif ($Navigation) { '--navigation-check' } else { '--downloads-check' }
$arguments = @('--state-dir', "`"$stateDirectory`"", '--data-dir', "`"$dataDirectory`"", '--port', $testPort, $mode)
if (-not $Packaged) { $arguments = @('--workspace', "`"$projectRoot`"") + $arguments }
$process = Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
try {
  if (-not $process.WaitForExit(45000)) { Stop-Process -Id $process.Id -Force; throw 'La prueba nativa excedió 45 segundos.' }
  $reportPath = Join-Path $stateDirectory $(if ($Sections) { 'sections-performance.json' } elseif ($Navigation) { 'navigation-performance.json' } else { 'downloads-performance.json' })
  if (-not (Test-Path -LiteralPath $reportPath)) { throw "No se generó el informe: $reportPath" }
  $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
  $report | ConvertTo-Json
  Write-Output "Informe: $reportPath"
  if (-not $report.passed) { throw "Falló la prueba nativa $mode. Consulta $reportPath" }
} finally { $process.Dispose() }
