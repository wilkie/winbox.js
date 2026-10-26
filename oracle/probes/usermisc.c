/*
 * USER's smaller exports that had no implementation, called by ordinal:
 *
 * * `desktop`: GetDesktopHwnd, as `desktop` where it is GetDesktopWindow's.
 * * `extra`: GetMessageExtraInfo after a posted message is taken.
 * * `idle`: IsUserIdle, with no mouse button down; UserYield returning.
 * * `getmessage2`: GetMessage2 waiting and not, as the answer and the
 *   message taken; WM_QUIT with and without waiting.
 * * `cpinfo`: ControlPanelInfo of SPI_GETBEEP, SPI_GETKEYBOARDSPEED and
 *   SPI_GETSCREENSAVETIMEOUT, the answer and the value, and
 *   SystemParametersInfo's for each beside it.
 * * `repaint`: RepaintScreen, and whether a window validated is then to
 *   be painted, with its update rectangle.
 * * `priority`: GetPriorityClipboardFormat with the clipboard empty, then
 *   with text on it, for lists of formats.
 * * `sysmenu`: SetSystemMenu for a window with a system menu and one
 *   without, and whether GetSystemMenu then answers the menu given.
 * * `queue`: GetNextQueueWindow from each of two overlapped windows, forwards
 *   and back, as `A`, `B`, `0` or `other`.
 * * `brush`: GetControlBrush, as `mine` where it is the brush the parent
 *   answered WM_CTLCOLOR with, and what WM_CTLCOLOR was sent; PaintRect
 *   and FillWindow, as the colour of a pixel painted.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\USERMISC.OUT"

typedef HWND(FAR PASCAL *HWNDPROC0)(void);
typedef DWORD(FAR PASCAL *DWORDPROC0)(void);
typedef WORD(FAR PASCAL *WORDPROC0)(void);
typedef BOOL(FAR PASCAL *GETMESSAGE2PROC)(LPMSG, HWND, UINT, UINT, UINT, BOOL);
typedef BOOL(FAR PASCAL *CPINFOPROC)(UINT, UINT, LPVOID);
typedef int(FAR PASCAL *PRIORITYPROC)(UINT FAR *, int);
typedef BOOL(FAR PASCAL *SETSYSMENUPROC)(HWND, HMENU);
typedef HWND(FAR PASCAL *NEXTQUEUEPROC)(HWND, BOOL);
typedef HBRUSH(FAR PASCAL *CONTROLBRUSHPROC)(HWND, HDC, UINT);
typedef void(FAR PASCAL *PAINTRECTPROC)(HWND, HWND, HDC, HBRUSH, LPRECT);
typedef void(FAR PASCAL *FILLWINDOWPROC)(HWND, HWND, HDC, HBRUSH);

static HMODULE user;
static HWND a, b, child, popup;
static HBRUSH red;
static char colored[80];

static FARPROC entry(int ordinal)
{
    return GetProcAddress(user, MAKEINTRESOURCE(ordinal));
}

static LPCSTR nameOf(HWND window)
{
    if (!window) {
        return "0";
    }

    if (window == a) {
        return "A";
    }

    if (window == b) {
        return "B";
    }

    if (window == child) {
        return "child";
    }

    if (window == popup) {
        return "popup";
    }

    return "other";
}

LRESULT CALLBACK _export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_CTLCOLOR) {
        wsprintf(colored, "%s from %s type %u", (LPSTR)nameOf(window),
                 (LPSTR)nameOf((HWND)LOWORD(lParam)), HIWORD(lParam));
        return (LRESULT)(UINT)red;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void pixel(LPCSTR what, HDC dc, int x, int y)
{
    COLORREF colour = GetPixel(dc, x, y);

    wsprintf(probeResult, "%06lx", colour);
    probe("brush", what, probeResult);
}

static void spi(UINT action)
{
    WORD value = 0x5555;
    WORD direct = 0x5555;
    BOOL answer = ((CPINFOPROC)entry(273))(action, 0, &value);

    SystemParametersInfo(action, 0, &direct, 0);
    wsprintf(probeArgs, "%u", action);
    wsprintf(probeResult, "%d:%u spi %u", answer, value, direct);
    probe("cpinfo", probeArgs, probeResult);
}

static void priority(LPCSTR what, UINT FAR *list, int count)
{
    wsprintf(probeResult, "%d", ((PRIORITYPROC)entry(402))(list, count));
    probe("priority", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    BOOL answer;
    HMENU menu;
    HDC dc;
    RECT rect;
    HGLOBAL text;
    HBRUSH got;
    static UINT bitmapText[] = {CF_BITMAP, CF_TEXT};
    static UINT bitmapOnly[] = {CF_BITMAP};
    static UINT zeroText[] = {0, CF_TEXT};
    static UINT oemText[] = {CF_OEMTEXT, CF_TEXT};

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");
    red = CreateSolidBrush(RGB(255, 0, 0));

    kind.style = 0;
    kind.lpfnWndProc = WindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "UserMisc";
    RegisterClass(&kind);

    a = CreateWindow("UserMisc", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 200, 150, NULL,
                     NULL, instance, NULL);
    b = CreateWindow("UserMisc", "B", WS_OVERLAPPED | WS_CAPTION | WS_VISIBLE, 250, 10, 200, 150,
                     NULL, NULL, instance, NULL);
    child = CreateWindow("UserMisc", "", WS_CHILD | WS_VISIBLE, 10, 10, 60, 40, a, NULL, instance,
                         NULL);
    popup = CreateWindow("UserMisc", "", WS_POPUP, 300, 300, 60, 40, b, NULL, instance, NULL);
    UpdateWindow(a);
    UpdateWindow(b);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    probe("desktop", "GetDesktopHwnd",
          ((HWNDPROC0)entry(278))() == GetDesktopWindow() ? "desktop" : "other");

    PostMessage(a, WM_USER + 1, 2, 3);
    PeekMessage(&msg, a, WM_USER + 1, WM_USER + 1, PM_REMOVE);
    wsprintf(probeResult, "%08lx", ((DWORDPROC0)entry(288))());
    probe("extra", "after a posted message", probeResult);

    wsprintf(probeResult, "%u", ((WORDPROC0)entry(333))());
    probe("idle", "IsUserIdle", probeResult);
    ((WORDPROC0)entry(332))();
    probe("idle", "UserYield", "returned");

    PostMessage(a, WM_USER + 2, 4, 5);
    answer = ((GETMESSAGE2PROC)entry(323))(&msg, NULL, WM_USER + 2, WM_USER + 2, PM_NOREMOVE, FALSE);
    wsprintf(probeResult, "%d:%04x", answer, msg.message);
    probe("getmessage2", "peek noremove", probeResult);
    answer = ((GETMESSAGE2PROC)entry(323))(&msg, NULL, WM_USER + 2, WM_USER + 2, PM_REMOVE, FALSE);
    wsprintf(probeResult, "%d:%04x:%u:%ld", answer, msg.message, msg.wParam, msg.lParam);
    probe("getmessage2", "peek remove", probeResult);
    answer = ((GETMESSAGE2PROC)entry(323))(&msg, NULL, WM_USER + 2, WM_USER + 2, PM_REMOVE, FALSE);
    wsprintf(probeResult, "%d", answer);
    probe("getmessage2", "peek none", probeResult);
    PostMessage(a, WM_USER + 3, 6, 7);
    answer = ((GETMESSAGE2PROC)entry(323))(&msg, NULL, WM_USER + 3, WM_USER + 3, PM_REMOVE, TRUE);
    wsprintf(probeResult, "%d:%04x:%u:%ld", answer, msg.message, msg.wParam, msg.lParam);
    probe("getmessage2", "wait", probeResult);
    PostQuitMessage(9);
    answer = ((GETMESSAGE2PROC)entry(323))(&msg, NULL, 0, 0, PM_NOREMOVE, FALSE);
    wsprintf(probeResult, "%d:%04x:%u", answer, msg.message, msg.wParam);
    probe("getmessage2", "quit peek", probeResult);
    answer = ((GETMESSAGE2PROC)entry(323))(&msg, NULL, 0, 0, PM_REMOVE, TRUE);
    wsprintf(probeResult, "%d:%04x:%u", answer, msg.message, msg.wParam);
    probe("getmessage2", "quit wait", probeResult);

    spi(SPI_GETBEEP);
    spi(SPI_GETKEYBOARDSPEED);
    spi(SPI_GETSCREENSAVETIMEOUT);

    ValidateRect(a, NULL);
    ((WORDPROC0)entry(275))();
    answer = GetUpdateRect(a, &rect, FALSE);
    wsprintf(probeResult, "%d:%d,%d,%d,%d", answer, rect.left, rect.top, rect.right, rect.bottom);
    probe("repaint", "A after RepaintScreen", probeResult);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    OpenClipboard(a);
    EmptyClipboard();
    CloseClipboard();
    priority("empty", bitmapText, 2);
    OpenClipboard(a);
    text = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 3);
    lstrcpy((LPSTR)GlobalLock(text), "hi");
    GlobalUnlock(text);
    SetClipboardData(CF_TEXT, text);
    CloseClipboard();
    priority("bitmap text", bitmapText, 2);
    priority("bitmap", bitmapOnly, 1);
    priority("zero text", zeroText, 2);
    priority("oemtext text", oemText, 2);
    priority("none", bitmapText, 0);
    priority("bitmap text, one", bitmapText, 1);
    OpenClipboard(a);
    EmptyClipboard();
    CloseClipboard();

    menu = CreateMenu();
    AppendMenu(menu, MF_STRING, 100, "Item");
    wsprintf(probeResult, "%d", ((SETSYSMENUPROC)entry(280))(a, menu));
    probe("sysmenu", "A", probeResult);
    probe("sysmenu", "A GetSystemMenu", GetSystemMenu(a, FALSE) == menu ? "given" : "other");
    wsprintf(probeResult, "%d", ((SETSYSMENUPROC)entry(280))(child, menu));
    probe("sysmenu", "child", probeResult);

    probe("queue", "A next", nameOf(((NEXTQUEUEPROC)entry(274))(a, FALSE)));
    probe("queue", "A previous", nameOf(((NEXTQUEUEPROC)entry(274))(a, TRUE)));
    probe("queue", "B next", nameOf(((NEXTQUEUEPROC)entry(274))(b, FALSE)));
    probe("queue", "B previous", nameOf(((NEXTQUEUEPROC)entry(274))(b, TRUE)));
    probe("queue", "child next", nameOf(((NEXTQUEUEPROC)entry(274))(child, FALSE)));

    dc = GetDC(child);
    colored[0] = '\0';
    got = ((CONTROLBRUSHPROC)entry(326))(child, dc, CTLCOLOR_BTN);
    wsprintf(probeResult, "%s, %s", (LPSTR)(got == red ? "mine" : "other"), (LPSTR)colored);
    probe("brush", "GetControlBrush child", probeResult);
    colored[0] = '\0';
    got = ((CONTROLBRUSHPROC)entry(326))(popup, dc, CTLCOLOR_STATIC);
    wsprintf(probeResult, "%s, %s", (LPSTR)(got == red ? "mine" : "other"), (LPSTR)colored);
    probe("brush", "GetControlBrush popup", probeResult);
    colored[0] = '\0';
    got = ((CONTROLBRUSHPROC)entry(326))(a, dc, CTLCOLOR_DLG);
    wsprintf(probeResult, "%s, %s", (LPSTR)(got == red ? "mine" : "other"), (LPSTR)colored);
    probe("brush", "GetControlBrush A", probeResult);

    rect.left = 0;
    rect.top = 0;
    rect.right = 8;
    rect.bottom = 8;
    colored[0] = '\0';
    ((PAINTRECTPROC)entry(325))(a, child, dc, (HBRUSH)CTLCOLOR_STATIC, &rect);
    pixel("PaintRect type", dc, 2, 2);
    probe("brush", "PaintRect type sent", colored);
    rect.left = 10;
    rect.right = 18;
    ((PAINTRECTPROC)entry(325))(a, child, dc, GetStockObject(BLACK_BRUSH), &rect);
    pixel("PaintRect brush", dc, 12, 2);
    rect.left = 20;
    rect.right = 28;
    colored[0] = '\0';
    ((PAINTRECTPROC)entry(325))(NULL, child, dc, (HBRUSH)CTLCOLOR_STATIC, &rect);
    pixel("PaintRect desktop", dc, 22, 2);
    probe("brush", "PaintRect desktop sent", colored[0] ? colored : "none");
    colored[0] = '\0';
    ((FILLWINDOWPROC)entry(324))(a, child, dc, (HBRUSH)CTLCOLOR_BTN);
    pixel("FillWindow", dc, 50, 30);
    probe("brush", "FillWindow sent", colored);
    colored[0] = '\0';
    ((FILLWINDOWPROC)entry(324))(NULL, child, dc, (HBRUSH)CTLCOLOR_BTN);
    pixel("FillWindow itself", dc, 50, 30);
    probe("brush", "FillWindow itself sent", colored);
    ReleaseDC(child, dc);

    DestroyWindow(popup);
    DestroyWindow(b);
    DestroyWindow(a);
    DeleteObject(red);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
