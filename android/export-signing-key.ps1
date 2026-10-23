# Run this while you still have access to the Windows account that built the release APK.
# The exported key can be imported on another computer with the password you choose here.
param([Parameter(Mandatory = $true)][string]$DestinationDirectory)
$ErrorActionPreference = 'Stop'
$signingDir = Join-Path $env:LOCALAPPDATA 'XuYe\signing'
$source = Join-Path $signingDir 'release.jks'
$secret = Join-Path $signingDir 'password.dpapi'
if (-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $secret)) {
    throw 'Release signing key or its Windows-protected password was not found.'
}
New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
$target = Join-Path (Resolve-Path -LiteralPath $DestinationDirectory).Path 'XuYe-release-backup.p12'
if (Test-Path -LiteralPath $target) { throw 'The backup already exists. Choose another folder.' }
$secureOld = Get-Content -LiteralPath $secret | ConvertTo-SecureString
$oldPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureOld)
try { $oldPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($oldPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($oldPtr) }
$secureNew = Read-Host 'Choose a new backup password (at least 12 characters)' -AsSecureString
$newPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureNew)
try { $newPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($newPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($newPtr) }
if ($newPassword.Length -lt 12) { throw 'Backup password must have at least 12 characters.' }
$javaHome = $env:JAVA_HOME
if (-not $javaHome) {
    $jdk = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
        Get-ItemProperty | Where-Object { $_.DisplayName -like '*OpenJDK*17*' -and $_.InstallLocation } | Select-Object -First 1
    if ($jdk) { $javaHome = $jdk.InstallLocation }
}
if (-not $javaHome) { throw 'Set JAVA_HOME to your JDK 17 directory.' }
& (Join-Path $javaHome 'bin\keytool.exe') -importkeystore -srckeystore $source -srcstorepass $oldPassword -srckeypass $oldPassword -srcalias 'xuye-release' -destkeystore $target -deststoretype PKCS12 -deststorepass $newPassword -destkeypass $newPassword -noprompt
$oldPassword = $null
$newPassword = $null
if ($LASTEXITCODE -ne 0) { throw 'Could not export the release signing key.' }
Write-Host "Exported $target. Keep it private and remember the password you chose."
