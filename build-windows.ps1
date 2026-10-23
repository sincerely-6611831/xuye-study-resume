# Build the Windows folder distribution. The first run installs PyInstaller.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) { throw 'Run start.cmd first.' }
Push-Location frontend
try { npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' } }
finally { Pop-Location }
.venv\Scripts\python.exe -m pip install pyinstaller
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller installation failed.' }
.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --onedir --name XuYe --add-data 'frontend\dist;frontend\dist' --collect-submodules backend.app windows_entry.py
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
Write-Host 'Built dist\XuYe\XuYe.exe. Data is under AppData\Local\XuYe.'
