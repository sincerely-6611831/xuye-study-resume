# 用本机 Visual Studio + Python + Inno Setup 生成单个 Windows 安装包。
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) { throw 'Run start.cmd first.' }
$vsdev = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat'
$iscc = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'
if (-not (Test-Path -LiteralPath $vsdev)) { throw 'Visual Studio C++ tools were not found.' }
if (-not (Test-Path -LiteralPath $iscc)) { throw 'Inno Setup 6 was not found.' }

# 官方 WebView2 C++ SDK 只在构建时需要；DLL 随程序文件进入安装包。
$webviewVersion = '1.0.4314.35'
$sdkRoot = '.buildtools\webview2\sdk\build\native'
if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'include\WebView2.h'))) {
    New-Item -ItemType Directory -Force '.buildtools\webview2' | Out-Null
    $package = '.buildtools\webview2\sdk.nupkg'
    $url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$webviewVersion/microsoft.web.webview2.$webviewVersion.nupkg"
    Invoke-WebRequest -Uri $url -OutFile $package
    Expand-Archive -LiteralPath $package -DestinationPath '.buildtools\webview2\sdk' -Force
}
$bootstrapper = '.buildtools\webview2\MicrosoftEdgeWebview2Setup.exe'
if (-not (Test-Path -LiteralPath $bootstrapper)) {
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
}

Push-Location frontend
try {
    # 按锁文件准备 React、Motion 等依赖；Vite 随后将它们写入安装包内的静态资源。
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependencies could not be installed.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}
finally { Pop-Location }
.venv\Scripts\python.exe -m pip install pyinstaller
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller installation failed.' }
.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --onedir --name XuYe --add-data 'frontend\dist;frontend\dist' --collect-submodules backend.app windows_entry.py
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }

$native = (Resolve-Path -LiteralPath $sdkRoot).Path
$compile = '"' + $vsdev + '" -arch=x64 >nul && cl /nologo /std:c++17 /utf-8 /EHsc /O2 /I"' + $native + '\include" /Fe:"dist\XuYe\StartXuYe.exe" "windows\StartXuYe.cpp" /link /SUBSYSTEM:WINDOWS /LIBPATH:"' + $native + '\x64" WebView2Loader.dll.lib'
cmd.exe /d /s /c $compile
if ($LASTEXITCODE -ne 0) { throw 'Visual Studio desktop build failed.' }
Copy-Item -LiteralPath (Join-Path $native 'x64\WebView2Loader.dll') -Destination 'dist\XuYe\WebView2Loader.dll' -Force
& $iscc 'windows\XuYe.iss'
if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
Write-Host 'Built dist\XuYe-Setup-1.4.0.exe. Install it, then open XuYe from the desktop or Start menu.'
