; 续页 Windows 安装包。应用、Python 服务与 WebView2 Loader 一起安装。
#define AppVersion "1.5.0"
[Setup]
AppId={{9CCB7921-6ABC-4FDE-BCB1-313583919E44}
AppName=续页
AppVersion={#AppVersion}
AppPublisher=硅基觉醒（Silicon Awakening）
SetupIconFile=XuYe.ico
DefaultDirName={localappdata}\Programs\XuYe
DefaultGroupName=续页
OutputDir=..\dist
OutputBaseFilename=XuYe-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\StartXuYe.exe
WizardStyle=modern

[Files]
Source: "..\dist\XuYe\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; 仅缺少 WebView2 Runtime 时安装。联网安装所需文件已随安装包携带。
Source: "..\.buildtools\webview2\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{autoprograms}\续页"; Filename: "{app}\StartXuYe.exe"
Name: "{autoprograms}\续页（局域网共享）"; Filename: "{app}\StartXuYe.exe"; Parameters: "--share"
Name: "{autodesktop}\续页"; Filename: "{app}\StartXuYe.exe"; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "创建桌面快捷方式"; GroupDescription: "其他选项:"

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "正在安装 WebView2 Runtime..."; Check: not WebView2Installed; Flags: waituntilterminated
Filename: "{app}\StartXuYe.exe"; Description: "打开续页"; Flags: nowait postinstall skipifsilent

[Code]
function WebView2Installed: Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '')) or
    (RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> ''));
end;
