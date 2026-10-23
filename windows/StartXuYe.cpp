// 由 Visual Studio C++ 工具链编译的轻量入口。Python 服务仍由 XuYe.exe 提供。
#define UNICODE
#define _UNICODE
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <string>
#pragma comment(lib, "Ws2_32.lib")
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "User32.lib")

static bool serverReady(unsigned short port) {
    WSADATA data{};
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return false;
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(port);
    InetPtonW(AF_INET, L"127.0.0.1", &address.sin_addr);
    bool ready = connect(sock, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == 0;
    closesocket(sock);
    WSACleanup();
    return ready;
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    wchar_t portText[8]{};
    DWORD size = GetEnvironmentVariableW(L"STUDY_PORT", portText, 8);
    int parsed = size > 0 && size < 8 ? _wtoi(portText) : 8000;
    unsigned short port = parsed > 0 && parsed <= 65535 ? static_cast<unsigned short>(parsed) : 8000;
    wchar_t ownPath[MAX_PATH]{};
    GetModuleFileNameW(nullptr, ownPath, MAX_PATH);
    std::wstring folder(ownPath);
    folder.erase(folder.find_last_of(L"\\/"));
    std::wstring service = folder + L"\\XuYe.exe";
    if (GetFileAttributesW(service.c_str()) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(nullptr, L"找不到 XuYe.exe，请保留完整的 XuYe 文件夹。", L"续页", MB_ICONERROR);
        return 1;
    }
    if (!serverReady(port)) {
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        std::wstring command = L"\"" + service + L"\"";
        SetEnvironmentVariableW(L"STUDY_NO_BROWSER", L"1");
        BOOL started = CreateProcessW(service.c_str(), command.data(), nullptr, nullptr, FALSE,
                                      CREATE_NEW_CONSOLE, nullptr, folder.c_str(), &startup, &process);
        SetEnvironmentVariableW(L"STUDY_NO_BROWSER", nullptr);
        if (!started) {
            MessageBoxW(nullptr, L"续页服务启动失败。", L"续页", MB_ICONERROR);
            return 1;
        }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        for (int attempt = 0; attempt < 60 && !serverReady(port); ++attempt) Sleep(250);
    }
    if (!serverReady(port)) {
        MessageBoxW(nullptr, L"服务未能启动，请检查控制台提示。", L"续页", MB_ICONERROR);
        return 1;
    }
    std::wstring url = L"http://127.0.0.1:" + std::to_wstring(port) + L"/";
    ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    return 0;
}
