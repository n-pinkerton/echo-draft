[CmdletBinding()]
param(
    [switch]$Install
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $repoRoot 'android'
$gradleWrapper = Join-Path $androidRoot 'gradlew.bat'
$apkPath = Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'

function Resolve-AndroidSdk {
    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { $_ }

    foreach ($candidate in $candidates) {
        $resolved = [System.IO.Path]::GetFullPath($candidate)
        if (Test-Path -LiteralPath (Join-Path $resolved 'platform-tools\adb.exe')) {
            return $resolved
        }
    }

    throw 'Android SDK not found. Install Android Studio with the Android SDK, then rerun this command.'
}

function Resolve-JavaHome {
    $bundledJbr = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
    $candidates = @($bundledJbr, $env:JAVA_HOME) | Where-Object { $_ }

    foreach ($candidate in $candidates) {
        $resolved = [System.IO.Path]::GetFullPath($candidate)
        if (Test-Path -LiteralPath (Join-Path $resolved 'bin\java.exe')) {
            return $resolved
        }
    }

    throw 'Compatible Java not found. Install Android Studio, which includes the required Java runtime.'
}

if (-not (Test-Path -LiteralPath $gradleWrapper)) {
    throw "Gradle wrapper not found at $gradleWrapper"
}

$sdkRoot = Resolve-AndroidSdk
$javaHome = Resolve-JavaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:JAVA_HOME = $javaHome

Write-Host 'Building and checking the private EchoDraft Android companion...'
& $gradleWrapper -p $androidRoot testDebugUnitTest lintDebug assembleDebug
if ($LASTEXITCODE -ne 0) {
    throw "Android build failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $apkPath)) {
    throw "Android build completed without producing $apkPath"
}

Write-Host "APK ready: $apkPath"

if (-not $Install) {
    Write-Host 'No phone is needed until you run npm run android:install.'
    exit 0
}

$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
$deviceOutput = @(& $adb devices)
if ($LASTEXITCODE -ne 0) {
    throw "adb could not list devices (exit code $LASTEXITCODE)"
}

$authorizedDevices = @(
    $deviceOutput |
        Where-Object { $_ -match '^\S+\s+device$' } |
        ForEach-Object { ($_ -split '\s+')[0] }
)

if ($authorizedDevices.Count -ne 1) {
    $deviceStates = @(
        $deviceOutput |
            Where-Object { $_ -match '^\S+\s+\S+$' -and $_ -notmatch '^List of devices' } |
            ForEach-Object { ($_ -split '\s+')[1] }
    )
    $stateText = if ($deviceStates.Count -gt 0) {
        " Detected device states: $($deviceStates -join ', ')."
    } else {
        ''
    }
    throw "Connect and authorize exactly one Android phone, then retry.$stateText"
}

Write-Host 'Installing the debug APK on the connected phone...'
& $adb -s $authorizedDevices[0] install -r $apkPath
if ($LASTEXITCODE -ne 0) {
    throw "Android installation failed with exit code $LASTEXITCODE"
}

Write-Host 'EchoDraft Mobile is installed. Open it on the phone to select the shared inbox folder.'
