$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Openfy\runtime'
Write-Host 'Preparando Node aislado para Openfy...'
& npm install --prefix $runtimeRoot node@22.22.3 npm@11.6.2 --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar el runtime.' }
$nodePath = Join-Path $runtimeRoot 'node_modules\node\bin\node.exe'
$npmPath = Join-Path $runtimeRoot 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'No se encuentra el runtime de Node.' }
@{ nodePath = $nodePath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.openfy-runtime.json') -Encoding utf8
$env:Path = (Split-Path $nodePath -Parent) + ';' + $env:Path
Push-Location $projectRoot
try {
  if (Test-Path -LiteralPath (Join-Path $projectRoot '.openfy.pid')) {
    Write-Host 'Deteniendo la instancia de Openfy antes de reinstalar y compilar...'
    & (Join-Path $PSScriptRoot 'stop.ps1')
  }
  & $nodePath $npmPath ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
  & $nodePath 'scripts/create-icons.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los iconos.' }
  & $nodePath $npmPath run build
  if ($LASTEXITCODE -ne 0) { throw 'La compilación falló.' }
  Write-Host 'Openfy está preparado. Ejecuta .\scripts\start.ps1'
} finally { Pop-Location }
