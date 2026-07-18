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
$localPropertiesPath = Join-Path $androidRoot 'local.properties'

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

function Assert-PrivateOneDriveConfig {
    if (-not (Test-Path -LiteralPath $localPropertiesPath)) {
        throw 'Private OneDrive configuration is missing. Follow android/README.md before installing.'
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $localPropertiesPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or $trimmed.StartsWith('!')) {
            continue
        }
        $separator = $line.IndexOf('=')
        if ($separator -le 0) {
            continue
        }
        $key = $line.Substring(0, $separator).Trim()
        $values[$key] = $line.Substring($separator + 1).Trim()
    }

    $requiredKeys = @(
        'echodraft.msalClientId',
        'echodraft.msalTenantId',
        'echodraft.msalSignatureHash'
    )
    $missingKeys = @($requiredKeys | Where-Object { -not $values.ContainsKey($_) -or -not $values[$_] })
    if ($missingKeys.Count -gt 0) {
        throw 'Private OneDrive configuration is incomplete. Follow android/README.md before installing.'
    }

    $canonicalUuidPattern = '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
    foreach ($key in @('echodraft.msalClientId', 'echodraft.msalTenantId')) {
        $value = [string]$values[$key]
        $parsed = [Guid]::Empty
        if (
            $value -notmatch $canonicalUuidPattern -or
            -not [Guid]::TryParse($value, [ref]$parsed) -or
            $parsed.ToString('D') -cne $value.ToLowerInvariant()
        ) {
            throw 'Private OneDrive configuration contains an invalid application or tenant identifier.'
        }
    }

    $signatureValue = [string]$values['echodraft.msalSignatureHash']
    if ($signatureValue -notmatch '^[A-Za-z0-9+/]{27}=$') {
        throw 'Private OneDrive configuration contains an invalid Android signature hash.'
    }
    try {
        $signatureBytes = [Convert]::FromBase64String($signatureValue)
    } catch {
        throw 'Private OneDrive configuration contains an invalid Android signature hash.'
    }
    if (
        $signatureBytes.Length -ne 20 -or
        [Convert]::ToBase64String($signatureBytes) -cne $signatureValue
    ) {
        throw 'Private OneDrive configuration contains an invalid Android signature hash.'
    }
}

if (-not (Test-Path -LiteralPath $gradleWrapper)) {
    throw "Gradle wrapper not found at $gradleWrapper"
}

$sdkRoot = Resolve-AndroidSdk
$javaHome = Resolve-JavaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:JAVA_HOME = $javaHome

if ($Install) {
    Assert-PrivateOneDriveConfig
}

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

$deviceEntries = @(
    $deviceOutput |
        Where-Object { $_ -match '^\S+\s+\S+$' -and $_ -notmatch '^List of devices' } |
        ForEach-Object {
            $parts = $_ -split '\s+'
            [pscustomobject]@{ Serial = $parts[0]; State = $parts[1] }
        }
)

if ($deviceEntries.Count -ne 1 -or $deviceEntries[0].State -ne 'device') {
    $deviceStates = @($deviceEntries | ForEach-Object { $_.State })
    $stateText = if ($deviceStates.Count -gt 0) {
        " Detected device states: $($deviceStates -join ', ')."
    } else {
        ''
    }
    throw "Connect and authorize exactly one Android phone, then retry.$stateText"
}

Write-Host 'Installing the debug APK on the connected phone...'
& $adb -s $deviceEntries[0].Serial install -r $apkPath
if ($LASTEXITCODE -ne 0) {
    throw "Android installation failed with exit code $LASTEXITCODE"
}

Write-Host 'EchoDraft Mobile is installed. Open it, tap Connect OneDrive, and complete Microsoft sign-in.'
