$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'desktop\Openfy.Windows\bin\Release\net10.0-windows10.0.26100.0\win-x64\Openfy.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Primero ejecuta .\scripts\setup-desktop.ps1' }
if (Test-Path -LiteralPath (Join-Path $projectRoot '.openfy.pid')) { & (Join-Path $PSScriptRoot 'stop.ps1') }
Start-Process -FilePath $executable -ArgumentList @('--workspace', "`"$projectRoot`"") -WindowStyle Hidden
Write-Host 'Abriendo Openfy nativo. Cerrar la ventana lo mantiene en la bandeja; Salir detiene también el servidor del iPhone.'
