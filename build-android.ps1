# Build installable debug APKs for phone/tablet and Wear OS with the local Android SDK.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$javaHome = $env:JAVA_HOME
if (-not $javaHome -or -not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\javac.exe'))) {
    $jdk = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
        Get-ItemProperty | Where-Object { $_.DisplayName -like '*OpenJDK*17*' -and $_.InstallLocation } | Select-Object -First 1
    if ($jdk) { $javaHome = $jdk.InstallLocation }
}
if (-not $javaHome -or -not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\javac.exe'))) { throw 'JDK 17 was not found. Set JAVA_HOME first.' }
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'platforms\android-35'))) { throw 'Android SDK platform 35 was not found.' }
$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkRoot
Push-Location android
try {
    .\gradlew.bat :mobile:assembleDebug :wear:assembleDebug --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
} finally { Pop-Location }
New-Item -ItemType Directory -Force -Path 'dist\Android' | Out-Null
Copy-Item -LiteralPath 'android\mobile\build\outputs\apk\debug\mobile-debug.apk' -Destination 'dist\Android\XuYe-Phone-Tablet-1.4-debug.apk'
Copy-Item -LiteralPath 'android\wear\build\outputs\apk\debug\wear-debug.apk' -Destination 'dist\Android\XuYe-WearOS-1.4-debug.apk'
Write-Host 'Built dist\Android\XuYe-Phone-Tablet-1.4-debug.apk and XuYe-WearOS-1.4-debug.apk.'
