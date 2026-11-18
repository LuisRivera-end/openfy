$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Openfy\development\dotnet'
$sdk = Join-Path $sdkRoot 'dotnet.exe'
if (-not (Test-Path -LiteralPath $sdk)) {
  New-Item -ItemType Directory -Path (Join-Path $projectRoot 'output\tools') -Force | Out-Null
  $installer = Join-Path $projectRoot 'output\tools\dotnet-install.ps1'
  Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installer
  & $installer -Version 10.0.404 -InstallDir $sdkRoot -NoPath
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar .NET.' }
}
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
& (Join-Path $PSScriptRoot 'stop.ps1')
. (Join-Path $PSScriptRoot 'resolve-node.ps1')
Push-Location $projectRoot
try {
  & $openfyNode scripts/create-icons.mjs
  & $openfyNode scripts/create-native-icons.mjs
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los iconos nativos.' }
  & $openfyNode node_modules/nuxt/bin/nuxt.mjs build
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación del backend.' }
  & $sdk build desktop/Openfy.Windows/Openfy.Windows.csproj -c Release
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación nativa.' }
  Write-Host 'Openfy nativo está preparado. Ejecuta .\scripts\start-desktop.ps1'
} finally { Pop-Location }
