/*
 * Activation and the focus: which messages a window gets as it is shown,
 * activated and given the focus, and where the focus is after.
 *
 * Two top-level windows, A and B, and in A a child dialog D, made hidden from
 * a template, with two edit controls, E1 and E2. D's procedure answers FALSE
 * to everything, `WM_INITDIALOG` too, so the dialog manager sets no focus of
 * its own. Each step records:
 *
 * * `msg`: each of `WM_ACTIVATEAPP`, `WM_NCACTIVATE`, `WM_ACTIVATE`,
 *   `WM_SETFOCUS`, `WM_KILLFOCUS` and `WM_INITDIALOG` that A, B or D got, in
 *   order, by step and number: the window, the message in hexadecimal, and
 *   its `wParam` and `lParam`, with a window's handle given by its name --
 *   `WM_NCACTIVATE`'s `lParam` too, its low word as a window and its high
 *   word in hexadecimal.
 * * `state`: `GetFocus` and `GetActiveWindow` after the step.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ACTIVATE.OUT"

static HWND windowA;
static HWND windowB;
static HWND dialogD;
static LPCSTR step = "";
static int number;
static BYTE FAR *template;
static int at;

static void byte(BYTE value)
{
    template[at++] = value;
}

static void word(WORD value)
{
    byte(LOBYTE(value));
    byte(HIBYTE(value));
}

static void string(LPCSTR text)
{
    while (*text) {
        byte(*text++);
    }

    byte(0);
}

static void item(int x, int y, int id)
{
    DWORD style = ES_LEFT | WS_BORDER | WS_TABSTOP | WS_CHILD | WS_VISIBLE;

    word(x);
    word(y);
    word(80);
    word(12);
    word(id);
    word(LOWORD(style));
    word(HIWORD(style));
    byte(0x81);
    string("");
    byte(0);
}

/* The child dialog: hidden, two edit controls, 101 and 102. */
static void build(void)
{
    DWORD style = WS_CHILD;

    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(2);
    word(4);
    word(4);
    word(120);
    word(50);
    byte(0);
    byte(0);
    string("");
    item(6, 6, 101);
    item(6, 24, 102);
}

/* A window's name: A, B, D, E1, E2, 0, or ? for any other. */
static void name(LPSTR out, HWND hwnd)
{
    if (hwnd == NULL) {
        lstrcpy(out, "0");
    } else if (hwnd == windowA) {
        lstrcpy(out, "A");
    } else if (hwnd == windowB) {
        lstrcpy(out, "B");
    } else if (hwnd == dialogD) {
        lstrcpy(out, "D");
    } else if (dialogD != NULL && GetParent(hwnd) == dialogD) {
        wsprintf(out, "E%d", GetDlgCtrlID(hwnd) - 100);
    } else {
        lstrcpy(out, "?");
    }
}

static void logMessage(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char who[8];
    char w[16];
    char l[24];

    switch (message) {
    case WM_ACTIVATEAPP:
        wsprintf(w, "%u", wParam);
        lstrcpy(l, lParam ? "task" : "0");
        break;
    case WM_NCACTIVATE:
        wsprintf(w, "%u", wParam);
        name(l, (HWND)LOWORD(lParam));
        wsprintf(l + lstrlen(l), ":%x", HIWORD(lParam));
        break;
    case WM_ACTIVATE:
        wsprintf(w, "%u", wParam);
        name(l, (HWND)LOWORD(lParam));
        wsprintf(l + lstrlen(l), ":%u", HIWORD(lParam));
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
    case WM_INITDIALOG:
        name(w, (HWND)wParam);
        lstrcpy(l, "-");
        break;
    default:
        return;
    }

    name(who, hwnd);
    wsprintf(probeArgs, "%s,%d", step, number++);
    wsprintf(probeResult, "%s,%04x,%s,%s", (LPSTR)who, message, (LPSTR)w, (LPSTR)l);
    probe("msg", probeArgs, probeResult);
}

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    return DefWindowProc(hwnd, message, wParam, lParam);
}

BOOL FAR PASCAL _export DialogProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    return FALSE;
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static void begin(LPCSTR name)
{
    step = name;
    number = 0;
}

static void state(void)
{
    char focus[8];
    char active[8];

    pump();
    name(focus, GetFocus());
    name(active, GetActiveWindow());
    wsprintf(probeResult, "focus=%s,active=%s", (LPSTR)focus, (LPSTR)active);
    probe("state", step, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HGLOBAL memory;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeActivate";
    RegisterClass(&kind);

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    template = (BYTE FAR *)GlobalLock(memory);
    build();

    /* A, hidden, and the dialog made in it. */
    begin("create");
    windowA = CreateWindow("ProbeActivate", "A", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL,
                           NULL, instance, NULL);
    state();

    begin("dialog");
    dialogD = CreateDialogIndirect(instance, template, windowA, (DLGPROC)DialogProc);
    state();

    begin("showdialog");
    ShowWindow(dialogD, SW_SHOW);
    state();

    begin("showA");
    ShowWindow(windowA, SW_SHOWNORMAL);
    state();

    begin("focusE2");
    SetFocus(GetDlgItem(dialogD, 102));
    state();

    /* B, shown over A. */
    begin("showB");
    windowB = CreateWindow("ProbeActivate", "B", WS_OVERLAPPEDWINDOW, 60, 60, 300, 200, NULL,
                           NULL, instance, NULL);
    ShowWindow(windowB, SW_SHOWNORMAL);
    state();

    begin("activateA");
    SetActiveWindow(windowA);
    state();

    begin("focusnone");
    SetFocus(NULL);
    state();

    begin("focusA");
    SetFocus(windowA);
    state();

    begin("activateB");
    SetActiveWindow(windowB);
    state();

    begin("destroyB");
    DestroyWindow(windowB);
    windowB = NULL;
    state();

    begin("destroyA");
    DestroyWindow(windowA);
    windowA = NULL;
    dialogD = NULL;
    state();

    GlobalUnlock(memory);
    GlobalFree(memory);
    probeFinish();

    return 0;
}
