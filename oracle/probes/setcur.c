/*
 * The cursor a window sets: which window is asked with `WM_SETCURSOR`, with
 * what, and when, and what `DefWindowProc` makes the cursor.
 *
 * `A` is a top-level window whose class's cursor is the I-beam, `C` a child
 * of it whose class's cursor is the cross, and `N` a top-level window whose
 * class has none. Each logs `WM_SETCURSOR` -- as the window it names, the
 * hit-test code and the mouse message -- and `WM_MOUSEMOVE`, with where, and
 * passes both to `DefWindowProc`.
 *
 * * `start`: `GetCursor` as the probe starts, as `arrow` if it is
 *   `LoadCursor(NULL, IDC_ARROW)`'s, and `SetCursor`'s answer.
 * * `shown`: the cursor at (100, 100); `A` made at (50, 50), 200 by 150,
 *   and shown; the messages up to a timer a quarter of a second on; the
 *   cursor after, by name.
 * * `moved`: `SetCursorPos` to (120, 110), inside `A`, and the same.
 * * `child`: `C` made at (40, 20) in `A`'s client area, 80 by 60, under the
 *   cursor, and shown; the same.
 * * `caption`: the cursor on `A`'s caption; `border`: on its left border;
 *   then on each other border and corner, the system menu box, the maximize
 *   box, and the desktop beside `A`.
 * * `back`: over `C` again; `repainted`: `A` invalidated and updated;
 *   `nudged`: `A` moved two pixels right, the cursor still over `C`;
 *   `nudgedback`: moved back.
 * * `none`: `N` made under the cursor and shown, after `SetCursor` of the
 *   wait cursor; the same.
 * * `gone`: `N` destroyed, the cursor over `A`'s client area again.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SETCUR.OUT"

#define TIMER 1

static HINSTANCE module;
static HWND a;
static HWND c;
static HWND n;
static HWND pumpWindow;
static HCURSOR arrow;
static HCURSOR ibeam;
static HCURSOR cross;
static HCURSOR wait;
static HCURSOR sizewe;
static HCURSOR sizens;
static HCURSOR sizenwse;
static HCURSOR sizenesw;
static char log[1024];
static LPSTR at;
static BOOL done;

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

static LPCSTR nameOf(HWND hwnd)
{
    if (hwnd == a) return "A";
    if (hwnd == c) return "C";
    if (hwnd == n) return "N";
    if (hwnd == NULL) return "0";
    return "other";
}

static LPCSTR cursorName(HCURSOR cursor)
{
    if (cursor == arrow) return "arrow";
    if (cursor == ibeam) return "ibeam";
    if (cursor == cross) return "cross";
    if (cursor == wait) return "wait";
    if (cursor == sizewe) return "sizewe";
    if (cursor == sizens) return "sizens";
    if (cursor == sizenwse) return "sizenwse";
    if (cursor == sizenesw) return "sizenesw";
    if (cursor == NULL) return "none";
    return "other";
}

static void note(LPCSTR text)
{
    if (at - log < (int)sizeof(log) - 40) {
        at += wsprintf(at, "%s%s", (LPSTR)(at == log ? "" : " "), text);
    }
}

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[64];

    if (message == WM_SETCURSOR) {
        wsprintf(text, "%s:setcursor(%s,%d,%x)", nameOf(hwnd), nameOf((HWND)wParam),
                 (int)(short)LOWORD(lParam), HIWORD(lParam));
        note(text);
    } else if (message == WM_MOUSEMOVE) {
        wsprintf(text, "%s:mousemove(%d,%d)", nameOf(hwnd), (int)(short)LOWORD(lParam),
                 (int)(short)HIWORD(lParam));
        note(text);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export PumpProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_TIMER) {
        KillTimer(hwnd, TIMER);
        done = TRUE;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* The messages until a timer a quarter of a second on, then the cursor. */
static void settle(LPCSTR name)
{
    MSG message;

    done = FALSE;
    SetTimer(pumpWindow, TIMER, 250, NULL);

    while (!done && GetMessage(&message, NULL, 0, 0)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    record("messages", name, at == log ? "none" : log);
    at = log;
    *at = '\0';
    record("cursor", name, cursorName(GetCursor()));
}

static void kind(LPCSTR name, HCURSOR cursor, WNDPROC proc)
{
    WNDCLASS k;

    k.style = 0;
    k.lpfnWndProc = proc;
    k.cbClsExtra = 0;
    k.cbWndExtra = 0;
    k.hInstance = module;
    k.hIcon = NULL;
    k.hCursor = cursor;
    k.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    k.lpszMenuName = NULL;
    k.lpszClassName = name;
    RegisterClass(&k);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HCURSOR before;

    module = instance;
    at = log;
    probeOpen(OUTPUT);

    arrow = LoadCursor(NULL, IDC_ARROW);
    ibeam = LoadCursor(NULL, IDC_IBEAM);
    cross = LoadCursor(NULL, IDC_CROSS);
    wait = LoadCursor(NULL, IDC_WAIT);
    sizewe = LoadCursor(NULL, IDC_SIZEWE);
    sizens = LoadCursor(NULL, IDC_SIZENS);
    sizenwse = LoadCursor(NULL, IDC_SIZENWSE);
    sizenesw = LoadCursor(NULL, IDC_SIZENESW);

    record("start", "GetCursor", cursorName(GetCursor()));
    before = SetCursor(arrow);
    record("start", "SetCursor", cursorName(before));

    kind("SetCurA", ibeam, ProbeProc);
    kind("SetCurC", cross, ProbeProc);
    kind("SetCurN", NULL, ProbeProc);
    kind("SetCurP", NULL, PumpProc);

    pumpWindow = CreateWindow("SetCurP", "", WS_POPUP, 0, 0, 1, 1, NULL, NULL, instance, NULL);

    SetCursorPos(100, 100);
    a = CreateWindow("SetCurA", "A", WS_OVERLAPPEDWINDOW, 50, 50, 200, 150, NULL, NULL, instance,
                     NULL);
    ShowWindow(a, SW_SHOWNORMAL);
    UpdateWindow(a);
    settle("shown");

    SetCursorPos(120, 110);
    settle("moved");

    c = CreateWindow("SetCurC", "", WS_CHILD | WS_BORDER, 40, 20, 80, 60, a, NULL, instance, NULL);
    ShowWindow(c, SW_SHOW);
    UpdateWindow(c);
    settle("child");

    SetCursorPos(150, 60);
    settle("caption");

    SetCursorPos(50, 120);
    settle("border");

    {
        static const struct { const char *name; int x; int y; } places[] = {
            { "right", 249, 120 },     { "top", 150, 50 },        { "bottom", 150, 199 },
            { "topleft", 50, 50 },     { "topright", 249, 50 },   { "bottomleft", 50, 199 },
            { "bottomright", 249, 199 }, { "sysmenu", 60, 60 },   { "maxbutton", 240, 60 },
            { "desktop", 400, 300 },
        };
        int i;

        for (i = 0; i < sizeof(places) / sizeof(places[0]); i++) {
            SetCursorPos(places[i].x, places[i].y);
            settle(places[i].name);
        }
    }

    SetCursorPos(120, 110);
    settle("back");
    InvalidateRect(a, NULL, TRUE);
    UpdateWindow(a);
    settle("repainted");
    MoveWindow(a, 52, 50, 200, 150, TRUE);
    settle("nudged");
    MoveWindow(a, 50, 50, 200, 150, TRUE);
    settle("nudgedback");

    SetCursorPos(200, 150);
    SetCursor(wait);
    n = CreateWindow("SetCurN", "N", WS_POPUP | WS_BORDER, 180, 130, 60, 40, NULL, NULL, instance,
                     NULL);
    ShowWindow(n, SW_SHOWNORMAL);
    UpdateWindow(n);
    settle("none");

    DestroyWindow(n);
    n = NULL;
    settle("gone");

    DestroyWindow(a);
    DestroyWindow(pumpWindow);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
