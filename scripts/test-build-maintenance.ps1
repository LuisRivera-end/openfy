$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-maintenance.ps1')
$sandbox = Join-Path $env:TEMP ('openfy-retention-test-' + [Guid]::NewGuid().ToString('N'))
$output = Join-Path $sandbox 'output\desktop'
$feed = Join-Path $sandbox 'feed'
New-Item -ItemType Directory -Path $output,$feed -Force | Out-Null
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Fixture([string]$Root, [string]$ManifestName) {
  $name = 'Openfy-Setup-0.3.0-200-x64.exe'
  $file = Join-Path $Root $name
  [IO.File]::WriteAllBytes($file, [byte[]]@(1,2,3))
  @{ file=$name; build=200; size=3; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root $ManifestName)
  [IO.File]::WriteAllBytes((Join-Path $Root 'Openfy-Setup-0.3.0-100-x64.exe'), [byte[]]@(4,5))
}
Fixture $output 'openfy-update.json'; Fixture $feed 'latest.json'
$old = Join-Path $output ('build-100-' + ('a' * 32))
$busy = Join-Path $output ('build-150-' + ('b' * 32))
$source = Join-Path $output 'source'
$web = Join-Path (Split-Path -Parent $output) ('web-build-100-' + ('c' * 32))
foreach ($directory in @($old,$busy,$source,$web)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null; Set-Content -LiteralPath (Join-Path $directory 'sentinel.txt') -Value 'keep until verified' }
$active = [IO.File]::Open((Join-Path $busy '.openfy-build-active'), 'CreateNew', 'ReadWrite', 'None')
try {
  $plan = @(Clear-OpenfyBuildArtifacts $output $feed)
  Assert-True (Test-Path -LiteralPath $old) 'El modo de revisión eliminó archivos.'
  Assert-True ([bool]($plan | Where-Object { $_.path -eq $busy -and $_.reason -eq 'Compilación en curso' })) 'Se ignoró el bloqueo de una compilación activa.'
  $result = @(Clear-OpenfyBuildArtifacts $output $feed -Apply)
  Assert-True (-not (Test-Path -LiteralPath $old)) 'No se retiró la compilación antigua.'
  Assert-True (-not (Test-Path -LiteralPath $web)) 'No se retiró el temporal web.'
  Assert-True (Test-Path -LiteralPath $busy) 'Se eliminó una compilación activa.'
  Assert-True (Test-Path -LiteralPath (Join-Path $source 'sentinel.txt')) 'Se tocó una carpeta ajena a las compilaciones.'
  foreach ($root in @($output,$feed)) {
    Assert-True (Test-Path -LiteralPath (Join-Path $root 'Openfy-Setup-0.3.0-200-x64.exe')) 'Se eliminó el instalador actual.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root 'Openfy-Setup-0.3.0-100-x64.exe'))) 'Se conservó un instalador obsoleto.'
  }
  $outside = Join-Path $sandbox 'outside'
  New-Item -ItemType Directory -Path $outside -Force | Out-Null
  $guarded = $false
  try { Remove-OpenfyGeneratedPath $outside $output @() -Apply } catch { $guarded = $true }
  Assert-True $guarded 'Se permitió una ruta fuera de output.'
  $linked = Join-Path $output ('build-100-' + ('d' * 32))
  New-Item -ItemType Junction -Path $linked -Target $outside | Out-Null
  $linkResult = Remove-OpenfyGeneratedPath $linked $output @() -Apply
  Assert-True (-not $linkResult.removed -and (Test-Path -LiteralPath $outside)) 'La limpieza siguió una junction.'
  $processResult = Remove-OpenfyGeneratedPath $source $output @([pscustomobject]@{ ExecutablePath=(Join-Path $source 'Openfy.exe'); CommandLine='' }) -Apply
  Assert-True (-not $processResult.removed) 'La limpieza ignoró un proceso activo.'
  [IO.File]::WriteAllBytes((Join-Path $output 'Openfy-Setup-0.3.0-200-x64.exe'), [byte[]]@(9,9,9))
  $rejected = $false
  try { Clear-OpenfyBuildArtifacts $output $feed -Apply } catch { $rejected = $true }
  Assert-True $rejected 'Un paquete corrupto permitió retirar la versión anterior.'
  Write-Output 'Correcto: revisión, limpieza, instalador actual, bloqueo activo, procesos, rutas, junctions e integridad.'
} finally {
  $active.Dispose()
  # Keep this tiny sandbox as test evidence; it contains no application binaries.
  Write-Output "Prueba: $sandbox"
}
