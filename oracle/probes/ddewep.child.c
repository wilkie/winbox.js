/*
 * The program `ddewep.c` starts: a DDEML instance, the string handles
 * "WepLeft" and "WepSrv", "WepSrv" registered as a service, in a window
 * "Wep Child". It writes the serial in its instance's id, in hexadecimal,
 * to C:\ORACLE\DDEWEP.TXT, and ends when posted `WM_USER + 9`, without
 * `DdeUninitialize`.
 */

#include <windows.h>
#include <ddeml.h>

#pragma library("ddeml")

#define LOG "C:\\ORACLE\\DDEWEP.TXT"

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    (void)type;
    (void)format;
    (void)conv;
    (void)one;
    (void)two;
    (void)data;
    (void)first;
    (void)second;
    return 0;
}

LRESULT CALLBACK __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER + 9) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    HWND window;
    DWORD instance = 0;
    HSZ service;
    char line[20];
    HFILE file;

    (void)previous;
    (void)command;
    (void)show;

    DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                  CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L);
    DdeCreateStringHandle(instance, "WepLeft", CP_WINANSI);
    service = DdeCreateStringHandle(instance, "WepSrv", CP_WINANSI);
    DdeNameService(instance, service, 0, DNS_REGISTER);

    wsprintf(line, "%x", HIWORD(instance));
    file = _lcreat(LOG, 0);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeWepC";
    RegisterClass(&kind);
    window = CreateWindow("DdeWepC", "Wep Child", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150, NULL,
                          NULL, module, NULL);
    ShowWindow(window, SW_SHOWNOACTIVATE);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    return 0;
}
