param(
  [long]$BuildNumber = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(),
  [string]$FeedRoot = (Join-Path $env:LOCALAPPDATA 'Openfy/updates/feed'),
  [string]$OutputDirectory,
  [switch]$NoInstall
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'build-maintenance.ps1')
$output = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot 'output/desktop' }
$workRoot = Join-Path $env:TEMP 'Openfy\builds'
$work = Join-Path $workRoot ("build-" + $BuildNumber + "-" + [Guid]::NewGuid().ToString("N"))
$webWork = Join-Path $projectRoot ("output/web-build-" + $BuildNumber + "-" + [Guid]::NewGuid().ToString("N"))
$stage = Join-Path $work 'app'
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($BuildNumber -lt 1) { throw 'Número de compilación no válido.' }
$releaseNotes = (Get-Content -LiteralPath (Join-Path $projectRoot 'shared/release-notes.json') -Raw -Encoding UTF8 | ConvertFrom-Json).releases
if (-not ($releaseNotes | Where-Object { $_.version -eq $version -and @($_.items).Count -gt 0 })) { throw "Falta la entrada de Novedades de la versión $version en shared/release-notes.json." }
$env:OPENFY_BUILD = "$BuildNumber"
# Nuxt's generated client paths must remain on the workspace volume. The larger
# native publish, staging area and installer can use another disk.
$env:OPENFY_BUILD_DIR = Join-Path $webWork '.nuxt'
$env:OPENFY_BUILD_OUTPUT = Join-Path $webWork '.output'
$sdk = Join-Path $env:LOCALAPPDATA 'Openfy\development\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $sdk)) { throw 'Ejecuta .\scripts\setup-desktop.ps1 primero.' }

. (Join-Path $PSScriptRoot 'resolve-node.ps1')
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
New-Item -ItemType Directory -Path $output,$work,$webWork -Force | Out-Null
$activeWork = [IO.File]::Open((Join-Path $work '.openfy-build-active'), 'CreateNew', 'ReadWrite', 'None')
$activeWeb = [IO.File]::Open((Join-Path $webWork '.openfy-build-active'), 'CreateNew', 'ReadWrite', 'None')
$releaseGate = $null
Push-Location $projectRoot
try {
  & $openfyNode node_modules/nuxt/bin/nuxt.mjs build
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación web.' }
  & $sdk publish desktop/Openfy.Windows/Openfy.Windows.csproj -c Release --artifacts-path (Join-Path $work 'dotnet') -o $stage "-p:OpenfyBuild=$BuildNumber"
  if ($LASTEXITCODE -ne 0) { throw 'Falló la publicación nativa.' }
  $backend = Join-Path $stage 'backend'
  New-Item -ItemType Directory -Path (Join-Path $backend 'scripts'),(Join-Path $stage 'runtime') -Force | Out-Null
  Copy-Item -LiteralPath $env:OPENFY_BUILD_OUTPUT -Destination $backend -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\serve.mjs') -Destination (Join-Path $backend 'scripts\serve.mjs') -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update-library.mjs') -Destination (Join-Path $backend 'scripts/update-library.mjs')
  Copy-Item -LiteralPath $openfyNode -Destination (Join-Path $stage 'runtime\node.exe') -Force
  Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $stage 'LICENSE.txt') -Force
  & $openfyNode scripts/collect-desktop-notices.mjs $stage
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron recopilar los avisos de terceros.' }
  $required = @('App.xbf','Openfy.pri','Microsoft.Graphics.Canvas.dll','Microsoft.Graphics.Canvas.Interop.dll','runtime\node.exe','backend\.output\server\node_modules\better-sqlite3\build\Release\better_sqlite3.node','backend\.output\server\node_modules\ffmpeg-static\ffmpeg.exe','backend\.output\server\node_modules\@jitl\quickjs-wasmfile-release-sync\dist\emscripten-module.wasm')
  foreach ($file in $required) { if (-not (Test-Path -LiteralPath (Join-Path $stage $file))) { throw "El paquete está incompleto: $file" } }
  # Exercise the published executable from another working directory. A build
  # tree can hide missing XBF/PRI resources that make the installed app crash.
  $startupQa = Join-Path $work 'publication-qa'
  New-Item -ItemType Directory -Path $startupQa -Force | Out-Null
  $startupReport = Join-Path $startupQa 'startup.json'
  if (Test-Path -LiteralPath $startupReport) { Remove-Item -LiteralPath $startupReport }
  $startupState = Join-Path $startupQa 'state'
  $publishedExe = Join-Path $stage 'Openfy.exe'
  $startupProcess = Start-Process -FilePath $publishedExe -ArgumentList @('--data-dir',"`"$(Join-Path $startupQa 'data')`"",'--state-dir',"`"$startupState`"",'--port','4296','--startup-check',"`"$startupReport`"") -WorkingDirectory $env:TEMP -WindowStyle Hidden -PassThru
  try {
    if (-not $startupProcess.WaitForExit(45000)) {
      $shutdown = Start-Process -FilePath $publishedExe -ArgumentList @('--state-dir',"`"$startupState`"",'--shutdown') -WindowStyle Hidden -PassThru
      [void]$shutdown.WaitForExit(5000)
      throw 'La aplicación publicada no completó la comprobación de arranque.'
    }
    if ($startupProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $startupReport)) { throw 'La aplicación publicada se cerró al iniciar. No se generará el instalador.' }
    $startupResult = Get-Content -LiteralPath $startupReport -Raw | ConvertFrom-Json
    if (-not $startupResult.passed) { throw 'La aplicación publicada no abrió la ventana y la biblioteca.' }
  } finally { $startupProcess.Dispose() }
  $payload = Join-Path $work 'payload.zip'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload, [IO.Compression.CompressionLevel]::Fastest, $false)
  $setup = Join-Path $work 'setup'
  & $sdk publish desktop/Openfy.Setup/Openfy.Setup.csproj -c Release --artifacts-path (Join-Path $work 'dotnet') -o $setup "-p:PayloadPath=$payload" "-p:OpenfyBuild=$BuildNumber"
  if ($LASTEXITCODE -ne 0) { throw 'Falló la publicación del instalador.' }
  $file = "Openfy-Setup-$version-$BuildNumber-x64.exe"
  $installer = Join-Path $output $file
  $releaseGate = [IO.File]::Open((Join-Path $output 'retention.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  if (Test-Path -LiteralPath $installer) { throw 'La compilación ya existe. Usa un número nuevo.' }
  Copy-Item -LiteralPath (Join-Path $setup 'Openfy.Setup.exe') -Destination $installer -ErrorAction Stop
  $manifest = [ordered]@{
    version=$version; build=$BuildNumber; platform='win-x64'; file=$file; size=(Get-Item -LiteralPath $installer).Length
    sha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    protocol=1; minLibrarySchema=1; maxLibrarySchema=6
  }
  $json = $manifest | ConvertTo-Json
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $work 'openfy-update.json'), $json, $utf8)
  [IO.Directory]::CreateDirectory($FeedRoot) | Out-Null
  $gate = [IO.File]::Open((Join-Path $FeedRoot 'publish.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  try {
    $latest = Join-Path $FeedRoot 'latest.json'
    $prior = if (Test-Path -LiteralPath $latest) { Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json }
    if ($prior -and (([Version]$prior.version -gt [Version]$version) -or (([Version]$prior.version -eq [Version]$version) -and $prior.build -ge $BuildNumber))) { throw 'El canal ya tiene una compilación igual o posterior.' }
    $incoming = Join-Path $FeedRoot ($file + '.part')
    Copy-Item -LiteralPath $installer -Destination $incoming -Force
    if ((Get-FileHash -LiteralPath $incoming -Algorithm SHA256).Hash -ne $manifest.sha256) { throw 'Falló la verificación de la copia local.' }
    [IO.File]::Move($incoming, (Join-Path $FeedRoot $file))
    [IO.File]::WriteAllText(($latest + '.new'), $json, $utf8)
    if (Test-Path -LiteralPath $latest) { [IO.File]::Replace($latest + '.new', $latest, ($latest + '.previous')) } else { [IO.File]::Move($latest + '.new', $latest) }
    [IO.File]::WriteAllText((Join-Path $output 'openfy-update.json'), $json, $utf8)
  } finally { $gate.Dispose() }
  $reports = Join-Path $output 'reports'
  New-Item -ItemType Directory -Path $reports -Force | Out-Null
  Copy-Item -LiteralPath $startupReport -Destination (Join-Path $reports ("startup-$BuildNumber.json"))
  Copy-Item -LiteralPath (Join-Path $work 'openfy-update.json') -Destination (Join-Path $reports ("release-$BuildNumber.json"))
  $defaultFeed = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Openfy\updates\feed'))
  $installed = Join-Path $env:LOCALAPPDATA 'Programs\Openfy\.openfy-installation'
  if (-not $NoInstall -and [IO.Path]::GetFullPath($FeedRoot) -eq $defaultFeed -and (Test-Path -LiteralPath $installed)) {
    Install-OpenfyBuild $installer $BuildNumber
  }
  $retired = @(Clear-OpenfyBuildArtifacts $output $FeedRoot -Apply -OutputLock $releaseGate)
  $retired | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $reports ("cleanup-$BuildNumber.json"))
  Write-Host "Instalador verificado en $installer"
} finally {
  if ($releaseGate) { $releaseGate.Dispose() }
  $activeWork.Dispose(); $activeWeb.Dispose()
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ExecutablePath,CommandLine)
  if ($processes.Count) {
    foreach ($temporary in @(@($work,$workRoot),@($webWork,(Join-Path $projectRoot 'output')))) {
      $result = Remove-OpenfyGeneratedPath $temporary[0] $temporary[1] $processes -Apply
      if ($result -and -not $result.removed) { Write-Warning "Temporal conservado: $($result.path). $($result.reason)" }
    }
  }
  Pop-Location
}
