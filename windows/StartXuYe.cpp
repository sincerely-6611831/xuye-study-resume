// 续页 Windows 桌面窗口：静态页面和 Python 服务都随安装包携带。
#define UNICODE
#define _UNICODE
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <WebView2.h>
#include <wrl.h>
#include <string>
#pragma comment(lib, "Ws2_32.lib")
#pragma comment(lib, "User32.lib")
using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

static constexpr wchar_t kClass[] = L"XuYeDesktopWindow";
// IndexedDB 按来源区分数据，端口必须长期固定，否则重启后看不到旧任务。
static constexpr unsigned short kPort = 18461;
static HWND mainWindow = nullptr;
static PROCESS_INFORMATION server{};
static ComPtr<ICoreWebView2Controller> controller;
static std::wstring url;

static bool ready(unsigned short port) {
    WSADATA data{};
    if (WSAStartup(MAKEWORD(2, 2), &data)) return false;
    SOCKET socketHandle = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(port);
    InetPtonW(AF_INET, L"127.0.0.1", &address.sin_addr);
    bool okay = socketHandle != INVALID_SOCKET && connect(socketHandle, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == 0;
    if (socketHandle != INVALID_SOCKET) closesocket(socketHandle);
    WSACleanup();
    return okay;
}
static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_SIZE && controller) {
        RECT bounds{};
        GetClientRect(hwnd, &bounds);
        controller->put_Bounds(bounds);
        return 0;
    }
    if (message == WM_DESTROY) {
        if (controller) controller->Close();
        controller.Reset();
        // 关窗时只结束该窗口的服务。SQLite 事务由数据库日志保证恢复。
        if (server.hProcess) {
            TerminateProcess(server.hProcess, 0);
            CloseHandle(server.hProcess);
            CloseHandle(server.hThread);
        }
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, message, wparam, lparam);
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR args, int show) {
    HANDLE mutex = CreateMutexW(nullptr, TRUE, L"Local\\XuYeDesktopSingleInstance");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = FindWindowW(kClass, nullptr);
        if (existing) { ShowWindow(existing, SW_RESTORE); SetForegroundWindow(existing); }
        if (mutex) CloseHandle(mutex);
        return 0;
    }
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
    wchar_t ownPath[MAX_PATH]{};
    GetModuleFileNameW(nullptr, ownPath, MAX_PATH);
    std::wstring folder(ownPath);
    folder.erase(folder.find_last_of(L"\\/"));
    std::wstring service = folder + L"\\XuYe.exe";
    if (GetFileAttributesW(service.c_str()) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(nullptr, L"安装不完整：找不到 XuYe.exe。", L"续页", MB_ICONERROR);
        return 1;
    }
    const unsigned short port = kPort;
    const bool share = args && wcsstr(args, L"--share") != nullptr;
    if (ready(port)) {
        MessageBoxW(nullptr, L"续页的固定端口 18461 已被占用，请先关闭占用该端口的程序。", L"续页", MB_ICONERROR);
        return 1;
    }
    url = L"http://127.0.0.1:" + std::to_wstring(port) + L"/";
    SetEnvironmentVariableW(L"STUDY_PORT", std::to_wstring(port).c_str());
    SetEnvironmentVariableW(L"STUDY_NO_BROWSER", L"1");
    SetEnvironmentVariableW(L"STUDY_HOST", share ? L"0.0.0.0" : L"127.0.0.1");
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    std::wstring command = L"\"" + service + L"\"";
    BOOL started = CreateProcessW(service.c_str(), command.data(), nullptr, nullptr, FALSE,
        CREATE_NO_WINDOW, nullptr, folder.c_str(), &startup, &server);
    SetEnvironmentVariableW(L"STUDY_PORT", nullptr);
    SetEnvironmentVariableW(L"STUDY_NO_BROWSER", nullptr);
    SetEnvironmentVariableW(L"STUDY_HOST", nullptr);
    if (!started) {
        MessageBoxW(nullptr, L"无法启动续页的本机服务。", L"续页", MB_ICONERROR);
        return 1;
    }
    for (int i = 0; i < 120 && !ready(port); ++i) {
        if (WaitForSingleObject(server.hProcess, 100) == WAIT_OBJECT_0) break;
        Sleep(150);
    }
    if (!ready(port) || WaitForSingleObject(server.hProcess, 0) == WAIT_OBJECT_0) {
        MessageBoxW(nullptr, L"本机服务未能启动。请检查安装目录。", L"续页", MB_ICONERROR);
        TerminateProcess(server.hProcess, 1);
        return 1;
    }
    WNDCLASSW klass{};
    klass.lpfnWndProc = windowProc;
    klass.hInstance = instance;
    klass.lpszClassName = kClass;
    klass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    klass.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    RegisterClassW(&klass);
    mainWindow = CreateWindowExW(0, kClass, L"续页 · 学习断片续接器",
        WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1280, 820,
        nullptr, nullptr, instance, nullptr);
    ShowWindow(mainWindow, show);
    if (share) MessageBoxW(mainWindow,
        L"自建服务器的局域网访问已开启。手机与电脑接入同一网络后，在 Android 应用点“连接服务器”，输入 http://电脑的局域网IPv4:18461。\n\n学习数据仍需在“数据与同步”中主动选择任务发送或接收。跨公网请部署 HTTPS。",
        L"续页 · 自建服务器", MB_OK | MB_ICONINFORMATION);
    wchar_t appData[MAX_PATH]{};
    GetEnvironmentVariableW(L"LOCALAPPDATA", appData, MAX_PATH);
    std::wstring profile = std::wstring(appData) + L"\\XuYe\\WebView2";
    HRESULT init = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(result) || !environment) {
                    MessageBoxW(mainWindow, L"无法初始化 WebView2。请安装 Microsoft Edge WebView2 Runtime。", L"续页", MB_ICONERROR);
                    DestroyWindow(mainWindow);
                    return E_FAIL;
                }
                return environment->CreateCoreWebView2Controller(mainWindow,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [](HRESULT result, ICoreWebView2Controller* created) -> HRESULT {
                            if (FAILED(result) || !created) {
                                MessageBoxW(mainWindow, L"应用窗口加载失败。", L"续页", MB_ICONERROR);
                                DestroyWindow(mainWindow);
                                return E_FAIL;
                            }
                            controller = created;
                            RECT bounds{};
                            GetClientRect(mainWindow, &bounds);
                            controller->put_Bounds(bounds);
                            ComPtr<ICoreWebView2> view;
                            controller->get_CoreWebView2(&view);
                            view->Navigate(url.c_str());
                            return S_OK;
                        }).Get());
            }).Get());
    if (FAILED(init)) {
        MessageBoxW(mainWindow, L"WebView2 启动失败。", L"续页", MB_ICONERROR);
        DestroyWindow(mainWindow);
    }
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    CoUninitialize();
    if (mutex) CloseHandle(mutex);
    return static_cast<int>(message.wParam);
}
