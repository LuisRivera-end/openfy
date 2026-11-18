$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeConfig = Join-Path $projectRoot '.openfy-runtime.json'
$openfyNode = if (Test-Path -LiteralPath $runtimeConfig) {
  $runtimeText = Get-Content -LiteralPath $runtimeConfig -Raw
  ($runtimeText.TrimStart([char]0xFEFF) | ConvertFrom-Json).nodePath
} else { (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $openfyNode)) { throw 'Ejecuta .\scripts\setup.ps1 para preparar Node.' }
$openfyVersion = [Version]((& $openfyNode --version).TrimStart('v'))
if ($openfyVersion -lt [Version]'22.22.3') { throw 'Node es demasiado antiguo. Ejecuta .\scripts\setup.ps1.' }
