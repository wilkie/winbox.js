/*
 * The focus set inside a window at the top that is hidden: whether `SetFocus`
 * activates it first, as it does one that shows; and a box over a modeless
 * dialog, made hidden as `DialogBox` makes one, its focus set before it
 * shows, then destroyed: where the focus goes back to.
 *
 * Three windows at the top: B, shown and active; A, hidden, with an edit
 * control E in it; and M, a modeless dialog with an edit control M1 and a
 * button M2, shown. P is a popup dialog owned by M, made hidden from a
 * template with a button P1, whose procedure answers TRUE to
 * `WM_INITDIALOG`, so the dialog manager gives P1 the focus as it makes it.
 * Each step records:
 *
 * * `msg`: each of `WM_NCACTIVATE`, `WM_ACTIVATE`, `WM_SETFOCUS`,
 *   `WM_KILLFOCUS` and `WM_SHOWWINDOW` that A, B, M or P got, in order, by
 *   step and number: the window, the message in hexadecimal, its `wParam`
 *   -- a window's handle by its name -- and `WM_ACTIVATE`'s `lParam`'s low
 *   word as a window.
 * * `state`: `GetFocus`, `GetActiveWindow`, and whether A and P show.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HIDFOCUS.OUT"

static HWND windowA;
static HWND windowB;
static HWND editE;
static HWND dialogM;
static HWND dialogP;
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

static void item(int x, int y, int id, DWORD style, BYTE kind)
{
    word(x);
    word(y);
    word(60);
    word(12);
    word(id);
    word(LOWORD(style));
    word(HIWORD(style));
    byte(kind);
    string("");
    byte(0);
}

/* M: shown, an edit control and a button. */
static void buildM(void)
{
    DWORD style = WS_POPUP | WS_CAPTION | WS_VISIBLE;

    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(2);
    word(150);
    word(20);
    word(120);
    word(60);
    byte(0);
    byte(0);
    string("M");
    item(6, 6, 201, ES_LEFT | WS_BORDER | WS_TABSTOP | WS_CHILD | WS_VISIBLE, 0x81);
    item(6, 24, 202, BS_PUSHBUTTON | WS_TABSTOP | WS_CHILD | WS_VISIBLE, 0x80);
}

/* P: hidden, one button. */
static void buildP(void)
{
    DWORD style = WS_POPUP | WS_CAPTION;

    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(1);
    word(170);
    word(50);
    word(100);
    word(40);
    byte(0);
    byte(0);
    string("P");
    item(6, 6, 301, BS_PUSHBUTTON | WS_TABSTOP | WS_CHILD | WS_VISIBLE, 0x80);
}

/* A window's name: A, B, E, M, M1, M2, P, P1, 0, or ? for any other. */
static void name(LPSTR out, HWND hwnd)
{
    if (hwnd == NULL) {
        lstrcpy(out, "0");
    } else if (hwnd == windowA) {
        lstrcpy(out, "A");
    } else if (hwnd == windowB) {
        lstrcpy(out, "B");
    } else if (hwnd == editE) {
        lstrcpy(out, "E");
    } else if (hwnd == dialogM) {
        lstrcpy(out, "M");
    } else if (hwnd == dialogP) {
        lstrcpy(out, "P");
    } else if (dialogM != NULL && GetParent(hwnd) == dialogM) {
        wsprintf(out, "M%d", GetDlgCtrlID(hwnd) - 200);
    } else if (dialogP != NULL && GetParent(hwnd) == dialogP) {
        wsprintf(out, "P%d", GetDlgCtrlID(hwnd) - 300);
    } else {
        lstrcpy(out, "?");
    }
}

static void logMessage(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char who[8];
    char w[16];
    char l[16];

    switch (message) {
    case WM_NCACTIVATE:
    case WM_SHOWWINDOW:
        wsprintf(w, "%u", wParam);
        lstrcpy(l, "-");
        break;
    case WM_ACTIVATE:
        wsprintf(w, "%u", wParam);
        name(l, (HWND)LOWORD(lParam));
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
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

BOOL FAR PASCAL _export ModelessProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    return message == WM_INITDIALOG;
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
    wsprintf(probeResult, "focus=%s,active=%s,A=%d,P=%d", (LPSTR)focus, (LPSTR)active,
             windowA != NULL && IsWindowVisible(windowA),
             dialogP != NULL && IsWindowVisible(dialogP));
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
    kind.lpszClassName = "ProbeHidFocus";
    RegisterClass(&kind);

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    template = (BYTE FAR *)GlobalLock(memory);

    /* B, shown and active; A, hidden, an edit control in it. */
    begin("create");
    windowB = CreateWindow("ProbeHidFocus", "B", WS_OVERLAPPEDWINDOW, 60, 60, 300, 200, NULL,
                           NULL, instance, NULL);
    ShowWindow(windowB, SW_SHOWNORMAL);
    windowA = CreateWindow("ProbeHidFocus", "A", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL,
                           NULL, instance, NULL);
    editE = CreateWindow("EDIT", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 100, 20,
                         windowA, (HMENU)1, instance, NULL);
    state();

    begin("focusE");
    SetFocus(editE);
    state();

    begin("showA");
    ShowWindow(windowA, SW_SHOWNORMAL);
    state();

    begin("destroyA");
    DestroyWindow(windowA);
    windowA = NULL;
    editE = NULL;
    state();

    /* M, shown and active, its edit control given the focus. */
    begin("dialogM");
    buildM();
    dialogM = CreateDialogIndirect(instance, template, windowB, (DLGPROC)ModelessProc);
    SetActiveWindow(dialogM);
    SetFocus(GetDlgItem(dialogM, 201));
    state();

    /* P over it, made hidden, then shown, then destroyed. */
    begin("dialogP");
    buildP();
    dialogP = CreateDialogIndirect(instance, template, dialogM, (DLGPROC)ModelessProc);
    state();

    begin("showP");
    ShowWindow(dialogP, SW_SHOW);
    state();

    begin("destroyP");
    DestroyWindow(dialogP);
    dialogP = NULL;
    state();

    begin("destroy");
    DestroyWindow(dialogM);
    dialogM = NULL;
    DestroyWindow(windowB);
    windowB = NULL;
    state();

    GlobalUnlock(memory);
    GlobalFree(memory);
    probeFinish();

    return 0;
}
