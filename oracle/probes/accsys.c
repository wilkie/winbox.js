/*
 * What `TranslateAccelerator` does with a command that is not in the
 * window's menu bar but in its system menu (`USER.EXE` seg19 `08c2`), and
 * which window states and keys hold a command back.
 *
 * The window, `AccSys`, has a bar `B`: "&Edit" (`E`: "&Paste" 201) and
 * "&Tasks", whose command is `SC_TASKLIST`. The keys, in `accsys.rc`: F2
 * `SC_CLOSE`, F3 `SC_RESTORE`, F4 `SC_MAXIMIZE`, F5 `SC_MINIMIZE`, F6
 * `SC_TASKLIST`, F7 201, F8 999 (no menu has it), F9 with Alt 400, F10
 * `SC_SIZE`, F11 `SC_MOVE`, and the character `a` with Alt 401.
 *
 * Each record is a key handed to `TranslateAccelerator` as a message of the
 * window's -- `WM_KEYDOWN` unless the name says `syskey` or `char` -- what
 * it answered, and the messages the window was sent meanwhile, in order:
 * `init(m)` for `WM_INITMENU`, `popup(m,place,system)` for
 * `WM_INITMENUPOPUP`, `command(id,lo,hi)` and `syscommand(id,lo,hi)` for
 * `WM_COMMAND` and `WM_SYSCOMMAND` with `lParam`'s words. A menu is named
 * `B`, `E`, `S` once `GetSystemMenu` has answered it, or `m` and its count
 * of items. The child records go to a child window; their messages are the
 * child's.
 *
 * Every window procedure here answers the menu messages itself, so no
 * command is carried out.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ACCSYS.OUT"

#ifndef VK_F11
#define VK_F11 0x7A
#endif

static HMENU bar;
static HMENU edit;
static HMENU sys;
static char log[512];

static void nameOf(LPSTR out, HMENU menu)
{
    if (menu && menu == bar) {
        lstrcpy(out, "B");
    } else if (menu && menu == edit) {
        lstrcpy(out, "E");
    } else if (menu && menu == sys) {
        lstrcpy(out, "S");
    } else {
        wsprintf(out, "m%d", GetMenuItemCount(menu));
    }
}

static void note(LPCSTR text)
{
    if (lstrlen(log) + lstrlen(text) < sizeof(log) - 2) {
        if (log[0]) {
            lstrcat(log, " ");
        }

        lstrcat(log, text);
    }
}

LRESULT CALLBACK _export HostProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[64];
    char name[16];

    switch (message) {
    case WM_INITMENU:
        nameOf(name, (HMENU)wParam);
        wsprintf(text, "init(%s)", (LPSTR)name);
        note(text);
        return 0;

    case WM_INITMENUPOPUP:
        nameOf(name, (HMENU)wParam);
        wsprintf(text, "popup(%s,%u,%u)", (LPSTR)name, LOWORD(lParam), HIWORD(lParam));
        note(text);
        return 0;

    case WM_COMMAND:
        wsprintf(text, "command(%u,%u,%u)", wParam, LOWORD(lParam), HIWORD(lParam));
        note(text);
        return 0;

    case WM_SYSCOMMAND:
        wsprintf(text, "syscommand(%x,%u,%u)", wParam, LOWORD(lParam), HIWORD(lParam));
        note(text);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void hand(HWND window, HACCEL keys, LPCSTR name, UINT message, UINT key, LONG lParam)
{
    MSG msg;
    int answer;

    msg.hwnd = window;
    msg.message = message;
    msg.wParam = key;
    msg.lParam = lParam;
    msg.time = 0;
    msg.pt.x = 0;
    msg.pt.y = 0;
    log[0] = '\0';

    answer = TranslateAccelerator(window, keys, &msg);
    wsprintf(probeResult, "%d %s", answer, (LPSTR)log);
    probe("key", name, probeResult);
}

static void press(HWND window, HACCEL keys, LPCSTR name, UINT key)
{
    hand(window, keys, name, WM_KEYDOWN, key, 1);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HWND plain;
    HWND child;
    HACCEL keys;
    BYTE saved[256];
    BYTE state[256];

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = HostProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "AccSys";
    RegisterClass(&kind);

    edit = CreatePopupMenu();
    AppendMenu(edit, MF_STRING, 201, "&Paste");

    bar = CreateMenu();
    AppendMenu(bar, MF_POPUP, (UINT)edit, "&Edit");
    AppendMenu(bar, MF_STRING, SC_TASKLIST, "&Tasks");

    window = CreateWindow("AccSys", "accsys", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL, bar,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    keys = LoadAccelerators(instance, "KEYS");

    press(window, keys, "normal,F2", VK_F2);
    press(window, keys, "normal,F3", VK_F3);
    press(window, keys, "normal,F4", VK_F4);
    press(window, keys, "normal,F5", VK_F5);
    press(window, keys, "normal,F6", VK_F6);
    press(window, keys, "normal,F7", VK_F7);
    press(window, keys, "normal,F8", VK_F8);
    press(window, keys, "normal,F10", VK_F10);
    press(window, keys, "normal,F11", VK_F11);

    ShowWindow(window, SW_MINIMIZE);
    press(window, keys, "minimized,F2", VK_F2);
    press(window, keys, "minimized,F3", VK_F3);
    press(window, keys, "minimized,F5", VK_F5);
    press(window, keys, "minimized,F6", VK_F6);
    press(window, keys, "minimized,F7", VK_F7);
    press(window, keys, "minimized,F11", VK_F11);
    ShowWindow(window, SW_RESTORE);

    ShowWindow(window, SW_MAXIMIZE);
    press(window, keys, "maximized,F3", VK_F3);
    press(window, keys, "maximized,F4", VK_F4);
    press(window, keys, "maximized,F10", VK_F10);
    press(window, keys, "maximized,F11", VK_F11);
    ShowWindow(window, SW_RESTORE);

    EnableWindow(window, FALSE);
    press(window, keys, "disabled,F2", VK_F2);
    press(window, keys, "disabled,F6", VK_F6);
    press(window, keys, "disabled,F8", VK_F8);
    EnableWindow(window, TRUE);

    SetCapture(window);
    press(window, keys, "capture,F2", VK_F2);
    press(window, keys, "capture,F7", VK_F7);
    press(window, keys, "capture,F8", VK_F8);
    ReleaseCapture();

    GetKeyboardState(saved);
    GetKeyboardState(state);
    state[VK_MENU] = 0x80;
    SetKeyboardState(state);
    press(window, keys, "altdown,F9", VK_F9);
    press(window, keys, "altdown,F2", VK_F2);
    hand(window, keys, "altdown,char,a", WM_CHAR, 'a', 1);
    SetKeyboardState(saved);
    hand(window, keys, "altup,syskey,F9", WM_SYSKEYDOWN, VK_F9, 0x20000001L);
    hand(window, keys, "altup,syschar,a", WM_SYSCHAR, 'a', 0x20000001L);
    hand(window, keys, "altup,syskey,F2", WM_SYSKEYDOWN, VK_F2, 0x20000001L);

    sys = GetSystemMenu(window, FALSE);
    press(window, keys, "own,F3", VK_F3);
    press(window, keys, "own,F2", VK_F2);
    EnableMenuItem(sys, SC_CLOSE, MF_BYCOMMAND | MF_GRAYED);
    press(window, keys, "own,grayed,F2", VK_F2);
    EnableMenuItem(sys, SC_CLOSE, MF_BYCOMMAND | MF_ENABLED);
    sys = NULL;

    child = CreateWindow("AccSys", "child", WS_CHILD | WS_VISIBLE | WS_CAPTION | WS_SYSMENU, 10,
                         10, 150, 80, window, (HMENU)7, instance, NULL);
    press(child, keys, "child,F2", VK_F2);
    press(child, keys, "child,F3", VK_F3);
    press(child, keys, "child,F7", VK_F7);
    DestroyWindow(child);

    child = CreateWindow("AccSys", "bare", WS_CHILD | WS_VISIBLE | WS_CAPTION, 10, 10, 150, 80,
                         window, (HMENU)8, instance, NULL);
    press(child, keys, "nosys,child,F2", VK_F2);
    DestroyWindow(child);

    plain = CreateWindow("AccSys", "plain", WS_OVERLAPPED | WS_CAPTION, 40, 40, 200, 100, NULL,
                         NULL, instance, NULL);
    ShowWindow(plain, SW_SHOWNORMAL);
    press(plain, keys, "nosys,F2", VK_F2);
    DestroyWindow(plain);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
