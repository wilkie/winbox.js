/*
 * What `TranslateAccelerator` sends a window whose menu has the command a
 * key stands for, and whether the command comes when the menu's item is
 * grayed: Paintbrush grays Paste until its Edit menu is opened, and
 * enables it as the menu is told it is about to show (`WM_INITMENUPOPUP`).
 *
 * The bar, `B`: "&Edit" (`E`: "&Paste" 201 and "&Cut" 202, both grayed,
 * and "&More" (`M`: "&Deep" 302, grayed)) and "&View" 300. The keys, in
 * `accinit.rc`: F5 for 201; F6 for 202, then again for 203, which no menu
 * has; F7 for 300; F8 for 999, which no menu has; F9 for 302.
 *
 * Each record is a key handed to `TranslateAccelerator` as a `WM_KEYDOWN`
 * of the window's, what it answered, and the messages the window was sent
 * meanwhile, in order: `init(B)` for `WM_INITMENU` and the menu,
 * `popup(E,0,0)` for `WM_INITMENUPOPUP`, the pop-up, its place and whether
 * it is a system menu, `command(201,0,1)` for `WM_COMMAND` with its
 * `lParam`'s words, `syscommand(...)` likewise. With `enable`, the window
 * enables 201 and 302 as it is sent `WM_INITMENUPOPUP` for `E`; after each
 * key they are grayed again. `disabled` keys go to the window disabled,
 * `minimized` ones to it minimized.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ACCINIT.OUT"

static HMENU bar;
static HMENU edit;
static HMENU more;
static BOOL enable;
static char log[512];

static LPCSTR nameOf(HMENU menu)
{
    if (menu == bar) {
        return "B";
    }

    if (menu == edit) {
        return "E";
    }

    if (menu == more) {
        return "M";
    }

    return "other";
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

    switch (message) {
    case WM_INITMENU:
        wsprintf(text, "init(%s)", nameOf((HMENU)wParam));
        note(text);
        return 0;

    case WM_INITMENUPOPUP:
        wsprintf(text, "popup(%s,%u,%u)", nameOf((HMENU)wParam), LOWORD(lParam), HIWORD(lParam));
        note(text);

        if (enable && (HMENU)wParam == edit) {
            EnableMenuItem(bar, 201, MF_BYCOMMAND | MF_ENABLED);
            EnableMenuItem(bar, 302, MF_BYCOMMAND | MF_ENABLED);
        }

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

static void press(HWND window, HACCEL keys, LPCSTR name, UINT key)
{
    MSG msg;
    int answer;

    msg.hwnd = window;
    msg.message = WM_KEYDOWN;
    msg.wParam = key;
    msg.lParam = 1;
    msg.time = 0;
    msg.pt.x = 0;
    msg.pt.y = 0;
    log[0] = '\0';

    answer = TranslateAccelerator(window, keys, &msg);
    wsprintf(probeResult, "%d %s", answer, (LPSTR)log);
    probe("key", name, probeResult);

    EnableMenuItem(bar, 201, MF_BYCOMMAND | MF_GRAYED);
    EnableMenuItem(bar, 302, MF_BYCOMMAND | MF_GRAYED);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HACCEL keys;

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
    kind.lpszClassName = "AccInit";
    RegisterClass(&kind);

    more = CreatePopupMenu();
    AppendMenu(more, MF_STRING | MF_GRAYED, 302, "&Deep");

    edit = CreatePopupMenu();
    AppendMenu(edit, MF_STRING | MF_GRAYED, 201, "&Paste");
    AppendMenu(edit, MF_STRING | MF_GRAYED, 202, "&Cut");
    AppendMenu(edit, MF_POPUP, (UINT)more, "&More");

    bar = CreateMenu();
    AppendMenu(bar, MF_POPUP, (UINT)edit, "&Edit");
    AppendMenu(bar, MF_STRING, 300, "&View");

    window = CreateWindow("AccInit", "accinit", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL,
                          bar, instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    keys = LoadAccelerators(instance, "KEYS");

    enable = TRUE;
    press(window, keys, "enable,F5", VK_F5);
    press(window, keys, "enable,F6", VK_F6);
    press(window, keys, "enable,F7", VK_F7);
    press(window, keys, "enable,F8", VK_F8);
    press(window, keys, "enable,F9", VK_F9);
    press(window, keys, "enable,F2", VK_F2);

    enable = FALSE;
    press(window, keys, "gray,F5", VK_F5);
    press(window, keys, "gray,F6", VK_F6);
    press(window, keys, "gray,F9", VK_F9);

    enable = TRUE;
    EnableWindow(window, FALSE);
    press(window, keys, "disabled,F5", VK_F5);
    press(window, keys, "disabled,F7", VK_F7);
    press(window, keys, "disabled,F8", VK_F8);
    EnableWindow(window, TRUE);

    ShowWindow(window, SW_MINIMIZE);
    press(window, keys, "minimized,F5", VK_F5);
    press(window, keys, "minimized,F7", VK_F7);
    press(window, keys, "minimized,F8", VK_F8);
    ShowWindow(window, SW_RESTORE);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
