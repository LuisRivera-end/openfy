param([string]$Serial='emulator-5554',[string]$SdkRoot=$env:ANDROID_HOME,[switch]$RealProvider,[string]$SyncHost='',[switch]$GitHubUpdate)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if(-not $SdkRoot) { $SdkRoot='D:\SDK' }
$adb=Join-Path $SdkRoot 'platform-tools\adb.exe'
if(-not $env:JAVA_HOME) { $env:JAVA_HOME='D:\Android\jbr' }
$env:ANDROID_HOME=$SdkRoot
& (Join-Path $root 'android\gradlew.bat') -p (Join-Path $root 'android') :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest --console plain
if($LASTEXITCODE -ne 0) { throw 'Falló la validación Gradle.' }
& $adb -s $Serial install -r (Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk')
if($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el APK debug.' }
& $adb -s $Serial install -r (Join-Path $root 'android\app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk')
if($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el APK de pruebas.' }
$arguments=@('-s',$Serial,'shell','am','instrument','--user','0','-w')
# Android CLI layout/input keeps its own instrumentation service alive. Release it before a test runner owns UiAutomation.
& $adb -s $Serial shell am force-stop --user 0 com.android.cli.interact.instrumentation
if($RealProvider) { $arguments+=@('-e','realProvider','true') }
if($SyncHost) { $arguments+=@('-e','syncHost',$SyncHost) }
if($GitHubUpdate) { $arguments+=@('-e','githubUpdate','true') }
$arguments+='app.openfy.android.debug.test/androidx.test.runner.AndroidJUnitRunner'
$result=& $adb @arguments 2>&1
$report=Join-Path $root "output\android-tests\$Serial-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).txt"
New-Item -ItemType Directory -Path (Split-Path -Parent $report) -Force | Out-Null
$result | Tee-Object -FilePath $report | ForEach-Object { Write-Host $_ }
if($LASTEXITCODE -ne 0 -or ($result -join "`n") -match 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed') { throw "Fallaron las pruebas instrumentadas. $report" }
Write-Host "Informe: $report"
