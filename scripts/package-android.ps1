param(
    [switch]$Debug,
    [ValidateRange(1,2100000000)][int]$BuildNumber = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds(),
    [string]$OutputRoot = '',
    [string]$SdkRoot = $env:ANDROID_HOME,
    [string]$JavaRoot = $env:JAVA_HOME,
    [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if(-not $SdkRoot) { $SdkRoot = 'D:\SDK' }
if(-not $JavaRoot) { $JavaRoot = 'D:\Android\jbr' }
if(-not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platforms'))) { throw 'Configura ANDROID_HOME o -SdkRoot con el Android SDK.' }
if(-not (Test-Path -LiteralPath (Join-Path $JavaRoot 'bin\java.exe'))) { throw 'Configura JAVA_HOME o -JavaRoot con un JDK compatible.' }
if(-not $OutputRoot) { $OutputRoot=Join-Path $projectRoot 'output\android' }
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$variant=if($Debug) { 'debug' } else { 'release' }
$run=Join-Path $OutputRoot "$version-$BuildNumber-$variant-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$work=Join-Path $run '.work'
New-Item -ItemType Directory -Path $run,$work -Force | Out-Null
$active=[IO.File]::Open((Join-Path $run '.openfy-build-active'),'CreateNew','ReadWrite','None')
$oldJava=$env:JAVA_HOME; $oldSdk=$env:ANDROID_HOME
$oldPath=$env:PATH
$secretNames=@('OPENFY_ANDROID_KEYSTORE','OPENFY_ANDROID_STORE_PASSWORD','OPENFY_ANDROID_KEY_PASSWORD','OPENFY_ANDROID_KEY_ALIAS')
$previousSecrets=@{}; foreach($name in $secretNames) { $previousSecrets[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
try {
    $env:JAVA_HOME=$JavaRoot; $env:ANDROID_HOME=$SdkRoot
    . (Join-Path $PSScriptRoot 'resolve-node.ps1')
    $env:PATH=(Split-Path -Parent $openfyNode)+';'+$env:PATH
    if(-not $Debug -and -not $env:OPENFY_ANDROID_KEYSTORE) {
        $signingRoot=Join-Path $env:LOCALAPPDATA 'Openfy\development\android-signing'
        New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
        $keystore=Join-Path $signingRoot 'openfy.jks'
        $credentials=Join-Path $signingRoot 'credentials.xml'
        if(Test-Path -LiteralPath $keystore) {
            if(-not (Test-Path -LiteralPath $credentials)) { throw 'La clave existe. Proporciona sus contraseñas mediante OPENFY_ANDROID_*.' }
            $credential=Import-Clixml -LiteralPath $credentials
            $password=$credential.GetNetworkCredential().Password
        } else {
            $password=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
            $credential=[pscredential]::new('openfy',(ConvertTo-SecureString $password -AsPlainText -Force))
            $credential | Export-Clixml -LiteralPath $credentials
        }
        $env:OPENFY_ANDROID_KEYSTORE=$keystore
        $env:OPENFY_ANDROID_STORE_PASSWORD=$password
        $env:OPENFY_ANDROID_KEY_PASSWORD=$password
        $env:OPENFY_ANDROID_KEY_ALIAS='openfy'
        if(-not (Test-Path -LiteralPath $keystore)) {
            & (Join-Path $JavaRoot 'bin\keytool.exe') -genkeypair -keystore $keystore -storetype JKS -alias openfy -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Openfy, O=Openfy' -storepass:env OPENFY_ANDROID_STORE_PASSWORD -keypass:env OPENFY_ANDROID_KEY_PASSWORD 2>&1 | ForEach-Object { Write-Host $_ }
            if($LASTEXITCODE -ne 0) { throw 'No se pudo crear la clave de firma.' }
        }
    }
    $task=if($Debug) { ':app:assembleDebug' } else { ':app:assembleRelease' }
    $tasks=@(); if(-not $SkipTests) { $tasks+=@(':app:testDebugUnitTest',':app:lintDebug') }; $tasks+=$task
    $arguments=@('-p',(Join-Path $projectRoot 'android'))+$tasks+@("-PopenfyBuild=$BuildNumber","-PopenfyVersion=$version","-PopenfyOutput=$work",'--console','plain')
    & (Join-Path $projectRoot 'android\gradlew.bat') @arguments 2>&1 | Tee-Object -FilePath (Join-Path $run 'build.log') | ForEach-Object { Write-Host $_ }
    if($LASTEXITCODE -ne 0) { throw 'Falló la compilación Android. Consulta build.log.' }
    $apk=Get-ChildItem -LiteralPath (Join-Path $work "app\outputs\apk\$variant") -Filter '*.apk' | Select-Object -First 1
    if(-not $apk) { throw 'No se generó un APK.' }
    $buildTools=Get-ChildItem -LiteralPath (Join-Path $SdkRoot 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
    # Windows PowerShell 5.1 turns redirected stderr (JDK 24+ native-access warnings) into a terminating error under Stop; the exit code decides.
    $previousPreference=$ErrorActionPreference; $ErrorActionPreference='Continue'
    try { $verification=& (Join-Path $buildTools.FullName 'apksigner.bat') verify --verbose --print-certs $apk.FullName 2>&1 | ForEach-Object { "$_" } }
    finally { $ErrorActionPreference=$previousPreference }
    if($LASTEXITCODE -ne 0) { throw 'El APK no pasó la verificación de firma.' }
    $verification | Set-Content -LiteralPath (Join-Path $run 'signature.txt') -Encoding utf8
    & (Join-Path $buildTools.FullName 'zipalign.exe') -c -P 16 4 $apk.FullName
    if($LASTEXITCODE -ne 0) { throw 'El APK no pasó la verificación de alineación de 16 KiB.' }
    $file="Openfy-$version-$BuildNumber-$variant.apk"
    $destination=Join-Path $run $file
    Copy-Item -LiteralPath $apk.FullName -Destination $destination
    $manifest=[ordered]@{ version=$version; build=$BuildNumber; variant=$variant; applicationId=if($Debug) {'app.openfy.android.debug'} else {'app.openfy.android'}; minSdk=29; targetSdk=37; abis=@('arm64-v8a','x86_64'); file=$file; bytes=(Get-Item -LiteralPath $destination).Length; sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant(); testsRun=(-not $SkipTests) }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding utf8
    if(-not $Debug) {
        $certificateLine=$verification | Where-Object { "$_" -match '^Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]{64})$' } | Select-Object -First 1
        if(-not $certificateLine -or "$certificateLine" -notmatch 'digest: ([a-fA-F0-9]{64})$') { throw 'No se pudo obtener la huella del certificado.' }
        $certificateHash=$Matches[1].ToLowerInvariant()
        $descriptor=[ordered]@{ schema=1; applicationId=$manifest.applicationId; version=$version; build=$BuildNumber; minSdk=29; abis=$manifest.abis; file=$file; bytes=$manifest.bytes; sha256=$manifest.sha256; certificateSha256=$certificateHash }
        # -Encoding utf8NoBOM only exists in PowerShell 7; write BOM-less UTF-8 on 5.1 too.
        [IO.File]::WriteAllText((Join-Path $run 'openfy-android-update.json'),($descriptor | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    }
    foreach($directory in @('reports','test-results')) { $source=Join-Path $work "app\$directory"; if(Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $run $directory) -Recurse } }
    Write-Host "APK verificado: $destination"
} finally {
    $active.Dispose()
    $env:JAVA_HOME=$oldJava; $env:ANDROID_HOME=$oldSdk; $env:PATH=$oldPath
    foreach($name in $secretNames) { [Environment]::SetEnvironmentVariable($name,$previousSecrets[$name],'Process') }
    # Only remove this invocation's isolated intermediates; never enumerate/delete another build.
    $resolvedWork=[IO.Path]::GetFullPath($work)
    if($resolvedWork -ne ([IO.Path]::GetFullPath($run)+[IO.Path]::DirectorySeparatorChar+'.work') -or -not $resolvedWork.StartsWith($OutputRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta de limpieza Android no válida.' }
    if(Test-Path -LiteralPath $resolvedWork) { Remove-Item -LiteralPath $resolvedWork -Recurse -Force }
}
