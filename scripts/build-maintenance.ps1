# Shared by packaging and the explicit cleanup command. All removals are limited
# to generated children; a verified installer must exist before retiring a release.
function Test-OpenfyChildPath([string]$Path, [string]$Root) {
  # TrimEndingDirectorySeparator does not exist in Windows PowerShell 5.1 (.NET Framework).
  $parent = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  return [IO.Path]::GetFullPath($Path).StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)
}

function Read-OpenfyBuildManifest([string]$Directory, [string]$Name = 'openfy-update.json') {
  $manifest = Get-Content -LiteralPath (Join-Path $Directory $Name) -Raw -ErrorAction Stop | ConvertFrom-Json
  if ($manifest.file -notmatch '^Openfy-Setup-\d+\.\d+\.\d+-\d+-x64\.exe$' -or $manifest.build -lt 1) { throw 'Manifiesto de compilación no válido.' }
  $file = Join-Path $Directory $manifest.file
  if ((Get-Item -LiteralPath $file -ErrorAction Stop).Length -ne $manifest.size -or
      (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $manifest.sha256) { throw 'El instalador no coincide con su manifiesto; se conservan las compilaciones anteriores.' }
  return $manifest
}

function Remove-OpenfyGeneratedPath([string]$Path, [string]$Root, [object[]]$Processes, [switch]$Apply) {
  $full = [IO.Path]::GetFullPath($Path)
  if (-not (Test-OpenfyChildPath $full $Root)) { throw "Ruta de limpieza fuera de su carpeta: $full" }
  if (-not (Test-Path -LiteralPath $full)) { return }
  $item = Get-Item -LiteralPath $full -Force
  $reason = ''
  # Check every ancestor and descendant before recursive deletion, including
  # junctions: a generated folder must never lead into the library or source.
  $cursor = $item
  while ($cursor) {
    if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { $reason = 'Contiene un enlace o junction'; break }
    $cursor = if ($cursor -is [IO.DirectoryInfo]) { $cursor.Parent } else { $cursor.Directory }
  }
  if (-not $reason -and $item.PSIsContainer -and (Get-ChildItem -LiteralPath $full -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop | Select-Object -First 1)) { $reason = 'Contiene un enlace o junction' }
  if (-not $reason -and ($Processes | Where-Object { ($_.ExecutablePath -and (Test-OpenfyChildPath $_.ExecutablePath $full)) -or ($_.CommandLine -and $_.CommandLine.IndexOf($full, [StringComparison]::OrdinalIgnoreCase) -ge 0) } | Select-Object -First 1)) { $reason = 'En uso por un proceso' }
  $marker = Join-Path $full '.openfy-build-active'
  if (-not $reason -and $item.PSIsContainer -and (Test-Path -LiteralPath $marker)) {
    try { $probe = [IO.File]::Open($marker, 'Open', 'ReadWrite', 'None'); $probe.Dispose() }
    catch { $reason = 'Compilación en curso' }
  }
  if ($reason) { return [pscustomobject]@{ path = $full; removed = $false; reason = $reason } }
  if ($Apply) {
    try { Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop }
    catch { return [pscustomobject]@{ path = $full; removed = $false; reason = $_.Exception.Message } }
  }
  return [pscustomobject]@{ path = $full; removed = [bool]$Apply; reason = $(if ($Apply) { 'Eliminado' } else { 'Se puede eliminar' }) }
}

function Clear-OpenfyBuildArtifacts([string]$OutputDirectory, [string]$FeedRoot, [switch]$IncludeLegacyTests, [switch]$Apply, [IO.FileStream]$OutputLock) {
  $output = [IO.Path]::GetFullPath($OutputDirectory)
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ExecutablePath,CommandLine)
  $lock = if ($OutputLock) { $OutputLock } else { [IO.File]::Open((Join-Path $output 'retention.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
  try {
    $manifest = Read-OpenfyBuildManifest $output
    foreach ($item in Get-ChildItem -LiteralPath $output -Force) {
      $generated = $item.PSIsContainer -and ($item.Name -match '^build-\d+-[a-f0-9]{32}$' -or $item.Name -in @('app','setup'))
      $obsoleteInstaller = -not $item.PSIsContainer -and $item.Name -match '^Openfy-Setup-\d+\.\d+\.\d+-\d+-x64\.exe$' -and $item.Name -ne $manifest.file
      if ($generated -and $Apply -and $item.Name -match '^build-(\d+)-[a-f0-9]{32}$' -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $number = $Matches[1]
        foreach ($report in @(@('openfy-update.json',"release-$number.json"),@('publication-qa\startup.json',"startup-$number.json"))) {
          $reportPath = Join-Path $item.FullName $report[0]
          if (Test-Path -LiteralPath $reportPath) {
            $reportFile = Get-Item -LiteralPath $reportPath
            if ($reportFile.Length -lt 1MB -and -not ($reportFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
              $reports = Join-Path $output 'reports'; New-Item -ItemType Directory -Path $reports -Force | Out-Null
              Copy-Item -LiteralPath $reportPath -Destination (Join-Path $reports $report[1]) -Force
            }
          }
        }
      }
      if ($generated -or $obsoleteInstaller -or $item.Name -eq 'payload.zip') { Remove-OpenfyGeneratedPath $item.FullName $output $processes -Apply:$Apply }
    }
    # Legacy scripts created these disposable installations and copied feeds.
    # Reports in other output folders, diagnostics, source and user data stay put.
    $outputRoot = Split-Path -Parent $output
    if ((Split-Path -Leaf $output) -eq 'desktop') {
      foreach ($item in Get-ChildItem -LiteralPath $outputRoot -Directory -Force) {
        $webBuild = $item.Name -match '^web-build-\d+-[a-f0-9]{32}$'
        $legacy = $IncludeLegacyTests -and ($item.Name -match '^update-(sandbox|faults)-[a-f0-9]+$' -or $item.Name -in @('installation-qa','update-qa-feed','github-release'))
        if ($webBuild -or $legacy) { Remove-OpenfyGeneratedPath $item.FullName $outputRoot $processes -Apply:$Apply }
      }
    }
    if ($FeedRoot -and (Test-Path -LiteralPath (Join-Path $FeedRoot 'latest.json'))) {
      $feedLock = [IO.File]::Open((Join-Path $FeedRoot 'publish.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
      try {
        $feed = Read-OpenfyBuildManifest $FeedRoot 'latest.json'
        foreach ($file in Get-ChildItem -LiteralPath $FeedRoot -File -Filter 'Openfy-Setup-*-x64.exe') {
          if ($file.Name -ne $feed.file) { Remove-OpenfyGeneratedPath $file.FullName $FeedRoot $processes -Apply:$Apply }
        }
      } finally { $feedLock.Dispose() }
    }
  } finally { if (-not $OutputLock) { $lock.Dispose() } }
}

function Install-OpenfyBuild([string]$Installer, [long]$BuildNumber) {
  $local = [Environment]::GetFolderPath('LocalApplicationData')
  if ($env:OPENFY_INSTALL_TEST_ROOT) {
    $local = [IO.Path]::GetFullPath($env:OPENFY_INSTALL_TEST_ROOT)
    if (-not (Test-Path -LiteralPath (Join-Path $local '.openfy-qa'))) { throw 'Falta la marca de instalación de pruebas.' }
  }
  $installation = Join-Path $local 'Programs\Openfy'
  $exe = Join-Path $installation 'Openfy.exe'
  $identity = Join-Path $installation '.openfy-installation'
  if (-not (Test-Path -LiteralPath $identity) -or (Get-Content -LiteralPath $identity -Raw) -ne '548FAE2A-A651-4C67-AAF0-639331AC451F') { throw 'No se reconoce la instalación de Openfy.' }
  $profilePath = Join-Path $local 'Openfy\updates\profile.json'
  $profile = Get-Content -LiteralPath $profilePath -Raw -ErrorAction Stop | ConvertFrom-Json
  $currentRelease = Get-Content -LiteralPath (Join-Path $installation 'release.json') -Raw | ConvertFrom-Json
  if ($currentRelease.build -gt $BuildNumber) { throw 'La instalación ya tiene una compilación posterior.' }
  if ($currentRelease.build -eq $BuildNumber) { Write-Output "Openfy ya utiliza la compilación $BuildNumber."; return }
  $running = @(Get-CimInstance Win32_Process -Filter "Name='Openfy.exe'" | Where-Object { $_.ExecutablePath -eq $exe })
  # The installer backs up SQLite and the JSON session before swapping binaries.
  # A graceful shutdown also lets interrupted downloads resume on the new build.
  if ($running.Count) {
    $logs = Join-Path $profile.stateRoot 'session-logs'
    $savedLogs = Join-Path $local ('Openfy\logs\before-build-' + $BuildNumber)
    if (Test-Path -LiteralPath $logs) {
      New-Item -ItemType Directory -Path $savedLogs -Force | Out-Null
      foreach ($name in @('native.jsonl','backend.jsonl')) { $path = Join-Path $logs $name; if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination $savedLogs -Force } }
    }
    $request = Start-Process -FilePath $exe -ArgumentList @('--state-dir', "`"$($profile.stateRoot)`"", '--shutdown') -WindowStyle Hidden -PassThru
    try { if (-not $request.WaitForExit(10000)) { throw 'Openfy no recibió la solicitud de cierre.' } } finally { $request.Dispose() }
    foreach ($entry in $running) {
      $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
      if ($process) { try { if (-not $process.WaitForExit(30000)) { throw 'Openfy sigue en uso; se conserva la versión anterior.' } } finally { $process.Dispose() } }
    }
  }
  $setup = Start-Process -FilePath $Installer -ArgumentList @('--silent','--reopen') -WindowStyle Hidden -PassThru
  try { if (-not $setup.WaitForExit(180000) -or $setup.ExitCode -ne 0) { throw 'El instalador no confirmó la actualización. Revisa setup.log.' } } finally { $setup.Dispose() }
  $release = Get-Content -LiteralPath (Join-Path $installation 'release.json') -Raw | ConvertFrom-Json
  if ($release.build -ne $BuildNumber) { throw 'La instalación no corresponde a la compilación nueva.' }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    try {
      $status = Invoke-RestMethod -Uri "http://127.0.0.1:$($profile.port)/api/status" -TimeoutSec 2
      if ($status.online -and [long]$status.build -eq $BuildNumber) { Write-Output "Openfy actualizado a $($release.version)+$($release.build), con el backend nuevo conectado."; return }
    } catch { }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Los archivos se actualizaron, pero el backend nuevo no confirmó su arranque.'
}
