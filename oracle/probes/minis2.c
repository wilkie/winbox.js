/*
 * Small calls programs make in use, found by opening every accessory's menus:
 *
 * * `pt`: PtInRect for points on and about a rectangle's edges, 1 or 0.
 * * `time`: whether GetCurrentTime and GetTickCount agree, taken together.
 * * `capture`: GetCapture before, after SetCapture, after ReleaseCapture, as
 *   `A` for the probe's window or `0`.
 * * `position`: GetCurrentPosition after MoveTo and LineTo, as `x,y`.
 * * `mapvk`: MapVirtualKey for every code 0-255 of a type, four hexadecimal
 *   digits each.
 * * `menu`: ChangeMenu's answer for each operation, and the menu after it,
 *   as its items' strings and IDs.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MINIS2.OUT"

typedef UINT(FAR PASCAL *MAPPROC)(UINT, UINT);

static HWND a;

static void pt(LPCSTR what, RECT *rect, int x, int y)
{
    POINT point;

    point.x = x;
    point.y = y;
    wsprintf(probeResult, "%d", PtInRect(rect, point) ? 1 : 0);
    probe("pt", what, probeResult);
}

static void menu(LPCSTR what, HMENU handle, BOOL answer)
{
    char text[400];
    char one[48];
    char name[32];
    int count;
    int i;

    count = GetMenuItemCount(handle);
    wsprintf(text, "%d:%d", answer ? 1 : 0, count);

    for (i = 0; i < count; i++) {
        name[0] = '\0';
        GetMenuString(handle, i, name, sizeof(name), MF_BYPOSITION);
        wsprintf(one, ",%s=%d", (LPSTR)name, GetMenuItemID(handle, i));
        lstrcat(text, one);
    }

    probe("menu", what, text);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char all[4 * 256 + 1];
    WNDCLASS kind;
    RECT rect;
    DWORD tick;
    DWORD current;
    HDC dc;
    DWORD position;
    MAPPROC map;
    HMENU handle;
    UINT type;
    int code;
    BOOL answer;

    probeOpen(OUTPUT);

    rect.left = 10;
    rect.top = 20;
    rect.right = 30;
    rect.bottom = 40;
    pt("inside", &rect, 15, 25);
    pt("left-top", &rect, 10, 20);
    pt("right", &rect, 30, 25);
    pt("bottom", &rect, 15, 40);
    pt("right-bottom-less", &rect, 29, 39);
    pt("left-less", &rect, 9, 25);
    pt("negative", &rect, -5, -5);

    tick = GetTickCount();
    current = GetCurrentTime();
    probe("time", "agree", (LPSTR)(current - tick < 100 ? "yes" : "no"));

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Minis2";
    RegisterClass(&kind);
    a = CreateWindow("Minis2", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 100, 60, NULL, NULL,
                     instance, NULL);

    probe("capture", "before", (LPSTR)(GetCapture() == a ? "A" : GetCapture() ? "?" : "0"));
    SetCapture(a);
    probe("capture", "set", (LPSTR)(GetCapture() == a ? "A" : GetCapture() ? "?" : "0"));
    ReleaseCapture();
    probe("capture", "released", (LPSTR)(GetCapture() == a ? "A" : GetCapture() ? "?" : "0"));

    dc = GetDC(a);
    position = GetCurrentPosition(dc);
    wsprintf(probeResult, "%d,%d", (int)LOWORD(position), (int)HIWORD(position));
    probe("position", "new", probeResult);
    MoveTo(dc, 7, 9);
    position = GetCurrentPosition(dc);
    wsprintf(probeResult, "%d,%d", (int)LOWORD(position), (int)HIWORD(position));
    probe("position", "moved", probeResult);
    LineTo(dc, 20, 3);
    position = GetCurrentPosition(dc);
    wsprintf(probeResult, "%d,%d", (int)LOWORD(position), (int)HIWORD(position));
    probe("position", "line", probeResult);
    ReleaseDC(a, dc);

    map = (MAPPROC)GetProcAddress(GetModuleHandle("KEYBOARD"), MAKEINTRESOURCE(131));

    for (type = 0; type <= 2; type++) {
        for (code = 0; code < 256; code++) {
            wsprintf(all + code * 4, "%04x", map(code, type));
        }

        wsprintf(probeResult, "%u", type);
        probe("mapvk", probeResult, all);
    }

    handle = CreateMenu();
    answer = ChangeMenu(handle, 0, "One", 101, MF_APPEND);
    menu("append", handle, answer);
    answer = ChangeMenu(handle, 0, "Two", 102, MF_APPEND);
    menu("append-again", handle, answer);
    answer = ChangeMenu(handle, 101, "Zero", 100, MF_INSERT);
    menu("insert-before-101", handle, answer);
    answer = ChangeMenu(handle, 102, "Deux", 202, MF_CHANGE);
    menu("change-102", handle, answer);
    answer = ChangeMenu(handle, 1, NULL, 0, MF_DELETE | MF_BYPOSITION);
    menu("delete-position-1", handle, answer);
    answer = ChangeMenu(handle, 202, NULL, 0, MF_REMOVE);
    menu("remove-202", handle, answer);
    answer = ChangeMenu(handle, 999, NULL, 0, MF_DELETE);
    menu("delete-missing", handle, answer);
    DestroyMenu(handle);

    DestroyWindow(a);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
