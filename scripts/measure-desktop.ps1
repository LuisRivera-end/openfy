param([int]$Runs = 3, [int]$Seconds = 12, [string]$Data = '', [string]$Executable = '', [string[]]$Scenarios = @('idle','playback','animated','limited'), [string]$ReportName = 'results.json')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'resolve-node.ps1')
if (-not $Data) { $Data = Join-Path $projectRoot 'output\native-qa\data' }
if (-not $Executable) {
  $manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'output/desktop/openfy-update.json') -Raw | ConvertFrom-Json
  $published = Get-ChildItem -Path (Join-Path $projectRoot ("output/desktop/build-" + $manifest.build + "-*/app/Openfy.exe")) | Select-Object -First 1
  if (-not $published) { throw 'Primero genera el paquete de escritorio.' }
  $Executable = $published.FullName
}
$resultDirectory = Join-Path $projectRoot 'output\desktop\benchmark'
$stateDirectory = Join-Path $resultDirectory 'state'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$rows = [System.Collections.Generic.List[object]]::new()
$cores = [Environment]::ProcessorCount
function Get-Tree([int[]]$Roots) {
  $inventory = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, Name)
  $byId = @{}; foreach ($item in $inventory) { $byId[[int]$item.ProcessId] = $item }
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($rootId in $Roots) { [void]$ids.Add($rootId) }
  do { $changed = $false; foreach ($item in $inventory) { if ($ids.Contains([int]$item.ParentProcessId) -and $item.CreationDate -ge $byId[[int]$item.ParentProcessId].CreationDate -and $ids.Add([int]$item.ProcessId)) { $changed = $true } } } while ($changed)
  return @($ids)
}
function Get-Sample([int[]]$Ids) {
  $memory = 0L; $cpu = 0.0
  foreach ($processId in $Ids) { $process = Get-Process -Id $processId -ErrorAction SilentlyContinue; if ($process) { $memory += $process.PrivateMemorySize64; $cpu += $process.TotalProcessorTime.TotalSeconds; $process.Dispose() } }
  $gpu = $null
  try {
    $engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop)
    $gpu = 0.0
    foreach ($engine in $engines) { if ($engine.Name -match 'pid_(\d+)_' -and $Ids -contains [int]$Matches[1]) { $gpu += [double]$engine.UtilizationPercentage } }
  } catch { }
  return [pscustomobject]@{ memoryMiB = $memory / 1MB; cpuSeconds = $cpu; gpuEngineSum = $gpu; at = [DateTime]::UtcNow }
}
Push-Location $projectRoot
try {
  foreach ($run in 1..$Runs) {
    foreach ($kind in @('native','web')) {
      $selectedScenarios = if ($kind -eq 'native') { $Scenarios } else { @($Scenarios | Where-Object { $_ -in @('idle','playback') }) }
      foreach ($scenario in $selectedScenarios) {
        $readyPath = Join-Path $stateDirectory $(if ($kind -eq 'native') { 'benchmark-ready.json' } else { 'web-ready.json' })
        $stopPath = Join-Path $stateDirectory 'web-stop'
        foreach ($file in @($readyPath,$stopPath)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $arguments = if ($kind -eq 'native') { @('--data-dir',"`"$Data`"",'--state-dir',"`"$stateDirectory`"",'--port','4298','--benchmark-mode',$scenario) } else { @('scripts/benchmark-web.mjs',$scenario,"`"$Data`"","`"$readyPath`"","`"$stopPath`"") }
        $program = if ($kind -eq 'native') { $Executable } else { $openfyNode }
        $process = Start-Process -FilePath $program -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
        try {
          while (-not (Test-Path -LiteralPath $readyPath)) { if ($process.HasExited -or $clock.Elapsed.TotalSeconds -gt 45) { throw "No se inició el escenario $kind/$scenario" }; Start-Sleep -Milliseconds 100 }
          $startup = $clock.Elapsed.TotalMilliseconds
          $greeting = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
          $roots = if ($kind -eq 'native') { @($process.Id) } else { @($greeting.roots) }
          Start-Sleep -Seconds 3
          $ids = Get-Tree $roots
          $first = Get-Sample $ids
          $measurement = [Diagnostics.Stopwatch]::StartNew()
          $samples = [System.Collections.Generic.List[object]]::new()
          while ($measurement.Elapsed.TotalSeconds -lt $Seconds) { Start-Sleep -Seconds 1; $samples.Add((Get-Sample $ids)) }
          $last = $samples[$samples.Count - 1]
          $row = [pscustomobject]@{ kind=$kind; scenario=$scenario; run=$run; startupMs=[Math]::Round($startup); privateMiB=[Math]::Round(($samples.memoryMiB | Measure-Object -Average).Average,2); cpuPercent=[Math]::Round(100 * ($last.cpuSeconds-$first.cpuSeconds) / ($last.at-$first.at).TotalSeconds / $cores,3); gpuEngineSum=($samples.gpuEngineSum | Measure-Object -Average).Average; samples=$samples.Count; seconds=($last.at-$first.at).TotalSeconds; processIds=$ids }
          $rows.Add($row); $row | ConvertTo-Json -Compress | Write-Host
          $rows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $resultDirectory ([IO.Path]::GetFileName($ReportName)))
        } finally {
          if ($kind -eq 'native') { $request=Start-Process -FilePath $Executable -ArgumentList @('--state-dir',"`"$stateDirectory`"",'--shutdown') -WindowStyle Hidden -PassThru; [void]$request.WaitForExit(5000) }
          else { Set-Content -LiteralPath $stopPath -Value 'stop' }
          if (-not $process.WaitForExit(10000)) { Stop-Process -Id $process.Id -Force }
          $process.Dispose()
        }
      }
    }
  }
} finally { Pop-Location }
