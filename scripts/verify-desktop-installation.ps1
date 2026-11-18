param([string]$Installer = '', [string]$AudioFixture = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Installer) {
  $output = Join-Path $projectRoot 'output/desktop'
  $manifest = Get-Content -LiteralPath (Join-Path $output 'openfy-update.json') -Raw | ConvertFrom-Json
  $Installer = Join-Path $output $manifest.file
}
if (-not $AudioFixture) { $AudioFixture = Join-Path $projectRoot 'output\native-qa\synthetic.m4a' }
$qa = Join-Path $projectRoot ('output/installation-qa/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qa -Force | Out-Null
New-Item -ItemType File -Path (Join-Path $qa '.openfy-qa') | Out-Null
$installation = Join-Path $qa 'Programs/Openfy'
$executable = Join-Path $installation 'Openfy.exe'
$maintenance = Join-Path $qa 'Openfy/installer/Openfy.Setup.exe'
$state = Join-Path $qa 'Openfy/desktop'
$data = Join-Path $qa 'Openfy/data'
$report = [ordered]@{ passed=$false; steps=[ordered]@{} }
$library = $data
$previousEnvironment = @{}
foreach ($key in @('OPENFY_INSTALL_TEST_ROOT','OPENFY_DATA_DIR','OPENFY_STATE_DIR','NITRO_PORT')) {
  $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key)
}
$env:OPENFY_INSTALL_TEST_ROOT = $qa
$env:OPENFY_DATA_DIR = $data
$env:OPENFY_STATE_DIR = $state
$env:NITRO_PORT = '4297'
function Manifest {
  $files = if (Test-Path -LiteralPath $library) { @(Get-ChildItem -LiteralPath $library -File -Recurse | Where-Object { $_.Name -ne '.openfy-library.lock' } | Sort-Object FullName) } else { @() }
  return @($files | ForEach-Object { [pscustomobject]@{ path=$_.FullName; hash=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
}
function Run-Installer([string]$File,[string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(120000) -or $process.ExitCode -ne 0) { throw 'Falló una operación del instalador.' }
  $process.Dispose()
}
function Run-App([string]$Arguments) {
  $process = Start-Process -FilePath $executable -ArgumentList $Arguments -WorkingDirectory $env:TEMP -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(90000)) { $request=Start-Process -FilePath $executable -ArgumentList "--state-dir `"$state`" --shutdown" -WindowStyle Hidden -PassThru; [void]$request.WaitForExit(5000); throw 'La prueba nativa no terminó.' }
  try { if ($process.ExitCode -ne 0) { throw "La aplicación instalada se cerró con código $($process.ExitCode)." } }
  finally { $process.Dispose() }
}
try {
  Run-Installer $Installer '--silent'
  $report.steps.install = $true
  $repeat = Start-Process -FilePath $Installer -ArgumentList '--silent' -WindowStyle Hidden -PassThru
  if (-not $repeat.WaitForExit(10000) -or $repeat.ExitCode -eq 0) { throw 'Se permitió reinstalar la misma compilación.' }
  $repeat.Dispose()
  $report.steps.sameBuildRejected = $true
  foreach ($resource in @('App.xbf','Openfy.pri')) { if (-not (Test-Path -LiteralPath (Join-Path $installation $resource))) { throw "Falta un recurso de WinUI en la instalación: $resource" } }
  $arguments = "--data-dir `"$data`" --state-dir `"$state`" --port 4297"
  foreach ($oldReport in @('native-smoke.json','youtube-smoke.json')) { $oldReportPath = Join-Path $state $oldReport; if (Test-Path -LiteralPath $oldReportPath) { Remove-Item -LiteralPath $oldReportPath } }
  Run-App "$arguments --smoke-test `"$AudioFixture`""
  $smoke = Get-Content -LiteralPath (Join-Path $state 'native-smoke.json') -Raw | ConvertFrom-Json
  $report.steps.nativeSmoke = $smoke
  if (-not $smoke.passed) { throw 'Falló la prueba funcional instalada.' }
  Run-App "$arguments --youtube-test J2kPH11Z4cM"
  $remote = Get-Content -LiteralPath (Join-Path $state 'youtube-smoke.json') -Raw | ConvertFrom-Json
  $report.steps.youtube = $remote
  if (-not $remote.passed) { throw 'Falló la reproducción real instalada.' }
  $ready = Join-Path $state 'benchmark-ready.json'
  if (Test-Path -LiteralPath $ready) { Remove-Item -LiteralPath $ready }
  $first = Start-Process -FilePath $executable -ArgumentList "$arguments --benchmark-mode idle" -WindowStyle Hidden -PassThru
  try {
    for ($i=0; $i -lt 300 -and -not (Test-Path -LiteralPath $ready); $i++) { Start-Sleep -Milliseconds 100 }
    $identity = Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
    $second = Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $report.steps.singleInstance = $second.WaitForExit(5000) -and -not $first.HasExited
    $second.Dispose()
    if (-not $report.steps.singleInstance) { throw 'La segunda apertura no activó la instancia existente.' }
  } finally { Run-App "--state-dir `"$state`" --shutdown"; if (-not $first.WaitForExit(10000)) { throw 'La instancia de prueba no cerró.' }; $first.Dispose() }
  $report.steps.noNodeOrphan = -not (@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq (Join-Path $installation 'runtime\node.exe') }).Count)
  $before = Manifest
  Run-Installer $maintenance '--uninstall --silent'
  $report.steps.uninstall = -not (Test-Path -LiteralPath $installation)
  $after = Manifest
  $report.steps.libraryPreserved = (ConvertTo-Json -InputObject $before -Compress) -eq (ConvertTo-Json -InputObject $after -Compress)
  if (-not $report.steps.libraryPreserved -or -not $report.steps.uninstall) { throw 'La desinstalación no conservó el estado esperado.' }
  Run-Installer $Installer '--silent'
  $report.steps.reinstall = Test-Path -LiteralPath $executable
  $report.passed = $report.steps.noNodeOrphan -and $report.steps.reinstall
} catch { $report.error = $_.Exception.Message; throw }
finally {
  foreach ($key in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key]) }
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $qa 'installation-validation.json')
}
