/*
 * What `DefWindowProc` answers `WM_NCHITTEST` (`USER.EXE` seg1 `6714`) at
 * every pixel of a window and the two pixels around it, for windows of each
 * kind of frame: none, a thin border, a dialog frame, a caption, a sizing
 * frame, `WS_EX_DLGMODALFRAME`; with and without the system menu, the
 * minimize and maximize boxes, a menu bar and the scroll bars; maximized and
 * minimized; hidden and disabled; and children with captions. The point is
 * given to `DefWindowProc` itself, so nothing else is asked.
 *
 * * `metrics`: SM_CXBORDER, SM_CYBORDER, SM_CXFRAME, SM_CYFRAME, SM_CXSIZE,
 *   SM_CYSIZE, SM_CYCAPTION, SM_CYMENU, SM_CXVSCROLL, SM_CYHSCROLL,
 *   SM_CXDLGFRAME, SM_CYDLGFRAME.
 * * `window`: a window's width and height, and its client rectangle in the
 *   window's own coordinates.
 * * `rows`: the window's name and a run of rows, from its top, that answer
 *   alike: each answer and how many pixels across give it, `code*count`,
 *   from two pixels left of the window to two right of it. The rows run from
 *   two above the window to two below it.
 *
 * A maximized window is scanned in two bands only, the rows across its top
 * and those across its bottom, the screen's whole width and the frame beyond
 * it each side.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\NCHIT.OUT"

static HINSTANCE instance;

/* One row's answers as runs, into `out`. */
static void runs(HWND window, int y, int from, int to, LPSTR out)
{
    int x = from;
    int code = (int)DefWindowProc(window, WM_NCHITTEST, 0, MAKELONG(from, y));
    int count = 0;
    LPSTR at = out;

    *at = '\0';

    for (x = from; x <= to; x++) {
        int next = (int)DefWindowProc(window, WM_NCHITTEST, 0, MAKELONG(x, y));

        if (next != code) {
            at += wsprintf(at, at == out ? "%d*%d" : " %d*%d", code, count);
            code = next;
            count = 0;
        }

        count++;
    }

    wsprintf(at, at == out ? "%d*%d" : " %d*%d", code, count);
}

/* The rows `top` to `bottom` of a window on the screen, runs alike merged. */
static void band(LPCSTR name, HWND window, RECT *rect, int top, int bottom, int from, int to)
{
    static char row[1024];
    static char last[1024];
    int first = top;
    int y;

    last[0] = '\0';

    for (y = top; y <= bottom + 1; y++) {
        if (y <= bottom) {
            runs(window, y, from, to, row);
        }

        if (y > top && (y > bottom || lstrcmp(row, last) != 0)) {
            wsprintf(probeArgs, "%s %d-%d", name, first - rect->top, y - 1 - rect->top);
            probe("rows", probeArgs, last);
            first = y;
        }

        lstrcpy(last, row);
    }
}

/* A window's size and client rectangle, then every row of it. */
static void scan(LPCSTR name, HWND window)
{
    RECT rect;
    RECT client;
    POINT origin;

    GetWindowRect(window, &rect);
    GetClientRect(window, &client);
    origin.x = 0;
    origin.y = 0;
    ClientToScreen(window, &origin);

    wsprintf(probeResult, "%d,%d %d,%d,%d,%d", rect.right - rect.left, rect.bottom - rect.top,
             origin.x - rect.left, origin.y - rect.top, origin.x - rect.left + client.right,
             origin.y - rect.top + client.bottom);
    probe("window", name, probeResult);

    if (IsZoomed(window)) {
        band(name, window, &rect, rect.top - 2, rect.top + 60, rect.left - 2, rect.right + 1);
        band(name, window, &rect, rect.bottom - 40, rect.bottom + 1, rect.left - 2, rect.right + 1);
    } else {
        band(name, window, &rect, rect.top - 2, rect.bottom + 1, rect.left - 2, rect.right + 1);
    }
}

static HMENU bar(void)
{
    HMENU menu = CreateMenu();

    AppendMenu(menu, MF_STRING, 1, "&File");
    AppendMenu(menu, MF_STRING, 2, "&Edit");
    return menu;
}

/* A window at the top, made, scanned and destroyed. */
static void top(LPCSTR name, DWORD extended, DWORD style, BOOL menu, int width, int height)
{
    HWND window = CreateWindowEx(extended, "NcHit", name, style, 100, 80, width, height, NULL,
                                 menu ? bar() : NULL, instance, NULL);

    scan(name, window);
    DestroyWindow(window);
}

int PASCAL WinMain(HINSTANCE self, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HWND parent;
    HWND child;
    static const int metrics[] = {SM_CXBORDER,  SM_CYBORDER,  SM_CXFRAME,    SM_CYFRAME,
                                  SM_CXSIZE,    SM_CYSIZE,    SM_CYCAPTION,  SM_CYMENU,
                                  SM_CXVSCROLL, SM_CYHSCROLL, SM_CXDLGFRAME, SM_CYDLGFRAME};
    int i;
    LPSTR at;

    instance = self;
    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "NcHit";
    RegisterClass(&kind);

    at = probeResult;
    for (i = 0; i < (int)(sizeof(metrics) / sizeof(metrics[0])); i++) {
        at += wsprintf(at, i ? " %d" : "%d", GetSystemMetrics(metrics[i]));
    }
    probe("metrics", "frame", probeResult);

    top("popup", 0, WS_POPUP, FALSE, 60, 40);
    top("border", 0, WS_POPUP | WS_BORDER, FALSE, 60, 40);
    top("dlgframe", 0, WS_POPUP | WS_DLGFRAME, FALSE, 60, 40);
    top("caption", 0, WS_POPUP | WS_CAPTION, FALSE, 120, 60);
    top("sysmenu", 0, WS_POPUP | WS_CAPTION | WS_SYSMENU, FALSE, 120, 60);
    top("minbox", 0, WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX, FALSE, 140, 60);
    top("maxbox", 0, WS_OVERLAPPED | WS_CAPTION | WS_MAXIMIZEBOX, FALSE, 140, 60);
    top("boxes", 0, WS_OVERLAPPED | WS_CAPTION | WS_MINIMIZEBOX | WS_MAXIMIZEBOX, FALSE, 140, 60);
    top("menu", 0, WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, TRUE, 140, 80);
    top("bordermenu", 0, WS_POPUP | WS_BORDER, TRUE, 140, 60);
    top("thick", 0, WS_POPUP | WS_THICKFRAME, FALSE, 120, 100);
    top("thickborder", 0, WS_POPUP | WS_BORDER | WS_THICKFRAME, FALSE, 120, 100);
    top("thickdlg", 0, WS_POPUP | WS_DLGFRAME | WS_THICKFRAME, FALSE, 120, 100);
    top("overlapped", 0, WS_OVERLAPPEDWINDOW, FALSE, 180, 120);
    top("overmenu", 0, WS_OVERLAPPEDWINDOW, TRUE, 180, 120);
    top("scrolls", 0, WS_OVERLAPPEDWINDOW | WS_VSCROLL | WS_HSCROLL, TRUE, 180, 140);
    top("vscroll", 0, WS_OVERLAPPEDWINDOW | WS_VSCROLL, FALSE, 160, 100);
    top("hscroll", 0, WS_OVERLAPPEDWINDOW | WS_HSCROLL, FALSE, 160, 100);
    top("thinscrolls", 0, WS_POPUP | WS_BORDER | WS_VSCROLL | WS_HSCROLL, FALSE, 120, 100);
    top("barescrolls", 0, WS_POPUP | WS_VSCROLL | WS_HSCROLL, FALSE, 120, 100);
    top("tiny", 0, WS_OVERLAPPEDWINDOW | WS_VSCROLL | WS_HSCROLL, TRUE, 40, 30);
    top("modal", WS_EX_DLGMODALFRAME, WS_POPUP | WS_CAPTION | WS_SYSMENU, FALSE, 140, 80);
    top("modalthick", WS_EX_DLGMODALFRAME, WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME,
        FALSE, 140, 90);
    top("modalbare", WS_EX_DLGMODALFRAME, WS_POPUP, FALSE, 60, 40);

    /* Hidden, never shown; and shown, then disabled. */
    window = CreateWindow("NcHit", "Hidden", WS_OVERLAPPEDWINDOW, 100, 80, 160, 100, NULL, NULL,
                          instance, NULL);
    scan("hidden", window);
    ShowWindow(window, SW_SHOWNOACTIVATE);
    EnableWindow(window, FALSE);
    scan("disabled", window);
    DestroyWindow(window);

    /* Maximized, with a menu bar and the scroll bars. */
    window = CreateWindow("NcHit", "Maximized", WS_OVERLAPPEDWINDOW | WS_VSCROLL | WS_HSCROLL,
                          100, 80, 160, 100, NULL, bar(), instance, NULL);
    ShowWindow(window, SW_SHOWMAXIMIZED);
    scan("maximized", window);
    ShowWindow(window, SW_SHOWMINNOACTIVE);
    scan("minimized", window);
    DestroyWindow(window);

    /* Children with captions, in a window's client area. */
    parent = CreateWindow("NcHit", "Parent", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 30, 400, 300,
                          NULL, NULL, instance, NULL);
    child = CreateWindow("NcHit", "Child", WS_CHILD | WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 180,
                         120, parent, (HMENU)1, instance, NULL);
    scan("child", child);
    DestroyWindow(child);
    child = CreateWindow("NcHit", "Child", WS_CHILD | WS_CAPTION | WS_SYSMENU | WS_VSCROLL, 20, 20,
                         140, 80, parent, (HMENU)1, instance, NULL);
    scan("childcap", child);
    DestroyWindow(child);
    child = CreateWindow("NcHit", "Child", WS_CHILD | WS_BORDER, 20, 20, 60, 40, parent, (HMENU)1,
                         instance, NULL);
    scan("childborder", child);
    DestroyWindow(child);
    DestroyWindow(parent);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
