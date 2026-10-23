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
# 正式 APK 用团队自己的签名，而不是 Android SDK 的公开测试签名。
# 密码使用 Windows DPAPI 按当前账号保护；请另行备份签名目录以便将来升级。
$signingDir = Join-Path $env:LOCALAPPDATA 'XuYe\signing'
$keystore = Join-Path $signingDir 'release.jks'
$secretFile = Join-Path $signingDir 'password.dpapi'
New-Item -ItemType Directory -Force $signingDir | Out-Null
if (-not (Test-Path -LiteralPath $keystore)) {
    if (Test-Path -LiteralPath $secretFile) { throw 'Signing password exists without keystore; restore the keystore backup before building.' }
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $random = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($random) } finally { $generator.Dispose() }
    $password = -join ($random | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    ConvertTo-SecureString $password -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $secretFile
    & (Join-Path $javaHome 'bin\keytool.exe') -genkeypair -keystore $keystore -alias 'xuye-release' -storepass $password -keypass $password -dname 'CN=Silicon Awakening, O=Dalian University of Technology, C=CN' -keyalg RSA -keysize 3072 -validity 10000 -noprompt
    if ($LASTEXITCODE -ne 0) { throw 'Could not create Android release signing key.' }
} else {
    if (-not (Test-Path -LiteralPath $secretFile)) { throw 'Signing password missing; restore the signing backup before building.' }
    $secure = Get-Content -LiteralPath $secretFile | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:XUYE_KEYSTORE = $keystore
$env:XUYE_SIGN_PASSWORD = $password
Push-Location frontend
try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Push-Location android
try {
    .\gradlew.bat :mobile:assembleDebug :wear:assembleDebug :mobile:assembleRelease :wear:assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
} finally { Pop-Location }
Remove-Item Env:XUYE_SIGN_PASSWORD,Env:XUYE_KEYSTORE -ErrorAction SilentlyContinue
$password = $null
New-Item -ItemType Directory -Force -Path 'dist\Android' | Out-Null
Copy-Item -LiteralPath 'android\mobile\build\outputs\apk\debug\mobile-debug.apk' -Destination 'dist\Android\XuYe-Phone-Tablet-1.4-debug.apk'
Copy-Item -LiteralPath 'android\wear\build\outputs\apk\debug\wear-debug.apk' -Destination 'dist\Android\XuYe-WearOS-1.4-debug.apk'
Copy-Item -LiteralPath 'android\mobile\build\outputs\apk\release\mobile-release.apk' -Destination 'dist\Android\XuYe-Phone-Tablet-1.4.apk'
Copy-Item -LiteralPath 'android\wear\build\outputs\apk\release\wear-release.apk' -Destination 'dist\Android\XuYe-WearOS-1.4.apk'
Write-Host 'Built signed release APKs in dist\Android; debug APKs are also retained for testing.'
