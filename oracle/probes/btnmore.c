/*
 * What USER's button procedure does that the mouse and the keyboard do not
 * reach, and what EnableWindow sends a window it disables: each kind of
 * button in turn, in a pop-up at (40, 40), 300 by 200, at (10, 10), 80 by
 * 24.
 *
 * * `settext`: a button's text set with WM_SETTEXT while it shows: the
 *   parent's notes at once (WM_CTLCOLOR as `ctlcolorN`, WM_DRAWITEM as
 *   `drawA,S`, WM_COMMAND codes), then after its paint, if any is due.
 * * `dlgcode`: what WM_GETDLGCODE answers, in hexadecimal, given no message
 *   and given WM_CHAR of `+`, `-`, `=` and `a`, and WM_KEYDOWN of VK_SPACE.
 * * `enable`: a window -- a button, then a window of the probe's own class,
 *   subclassed to note its messages -- disabled while it has the focus,
 *   the capture, both, or neither: the messages it was sent, in order, and
 *   whether it kept the focus and the capture.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BTNMORE.OUT"

#define ID 100

static HWND parent;
static HWND button;
static char notes[512];
static FARPROC buttonProc;

static void note(LPCSTR text)
{
    if (lstrlen(notes) + lstrlen(text) + 2 < sizeof(notes)) {
        if (notes[0]) {
            lstrcat(notes, ";");
        }

        lstrcat(notes, text);
    }
}

static LRESULT CALLBACK ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[48];

    if (message == WM_COMMAND && wParam == ID) {
        wsprintf(one, "%u", HIWORD(lParam));
        note(one);
        return 0;
    }

    if (message == WM_CTLCOLOR && (HWND)LOWORD(lParam) == button) {
        wsprintf(one, "ctlcolor%u", HIWORD(lParam));
        note(one);
    }

    if (message == WM_DRAWITEM && wParam == ID) {
        const DRAWITEMSTRUCT FAR *item = (const DRAWITEMSTRUCT FAR *)lParam;

        wsprintf(one, "draw%u,%u", item->itemAction, item->itemState);
        note(one);
        return TRUE;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* The messages a window is sent, by name where they are the ones looked
 * for, else by number. */
static void heard(UINT message, WPARAM wParam)
{
    char one[32];

    switch (message) {
    case WM_CANCELMODE: note("WM_CANCELMODE"); return;
    case WM_KILLFOCUS: note("WM_KILLFOCUS"); return;
    case WM_SETFOCUS: note("WM_SETFOCUS"); return;
    case WM_ENABLE: wsprintf(one, "WM_ENABLE%u", wParam); note(one); return;
    case WM_NCPAINT: note("WM_NCPAINT"); return;
    case WM_ERASEBKGND: note("WM_ERASEBKGND"); return;
    case WM_PAINT: note("WM_PAINT"); return;
    case WM_CTLCOLOR: return;
    case WM_GETDLGCODE: note("WM_GETDLGCODE"); return;
    }

    wsprintf(one, "%x", message);
    note(one);
}

static LRESULT CALLBACK OwnProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    heard(message, wParam);
    return DefWindowProc(hwnd, message, wParam, lParam);
}

static LRESULT CALLBACK SubclassProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    heard(message, wParam);
    return CallWindowProc(buttonProc, hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

static void make(DWORD style)
{
    button = CreateWindow("BUTTON", "Button", WS_CHILD | WS_VISIBLE | style, 10, 10, 80, 24,
                          parent, (HMENU)ID, NULL, NULL);
    UpdateWindow(button);
    pump();
    notes[0] = 0;
}

static void settext(LPCSTR kind, DWORD style)
{
    make(style);
    SendMessage(button, WM_SETTEXT, 0, (LPARAM)(LPCSTR)"Other");
    wsprintf(probeArgs, "%s,at-once", kind);
    probe("settext", probeArgs, notes);
    notes[0] = 0;
    UpdateWindow(button);
    pump();
    wsprintf(probeArgs, "%s,painted", kind);
    probe("settext", probeArgs, notes);
    notes[0] = 0;
    DestroyWindow(button);
}

static void dlgcode(LPCSTR kind, DWORD style)
{
    static const struct {
        LPCSTR name;
        UINT message;
        WPARAM key;
    } ASKS[] = {
        {"none", 0, 0},          {"char-plus", WM_CHAR, '+'},  {"char-minus", WM_CHAR, '-'},
        {"char-equals", WM_CHAR, '='}, {"char-a", WM_CHAR, 'a'}, {"key-space", WM_KEYDOWN, VK_SPACE},
    };
    MSG msg;
    int i;

    make(style);

    for (i = 0; i < 6; i++) {
        _fmemset(&msg, 0, sizeof(msg));
        msg.hwnd = button;
        msg.message = ASKS[i].message;
        msg.wParam = ASKS[i].key;
        wsprintf(probeArgs, "%s,%s", kind, ASKS[i].name);
        wsprintf(probeResult, "%lx",
                 SendMessage(button, WM_GETDLGCODE, 0,
                             ASKS[i].message ? (LPARAM)(LPMSG)&msg : 0L));
        probe("dlgcode", probeArgs, probeResult);
    }

    DestroyWindow(button);
    notes[0] = 0;
}

/* A window disabled with the focus, the capture, both or neither. */
static void disable(LPCSTR kind, HWND window, BOOL focus, BOOL capture)
{
    EnableWindow(window, TRUE);
    SetFocus(parent);
    ReleaseCapture();
    pump();

    if (focus) {
        SetFocus(window);
    }

    if (capture) {
        SetCapture(window);
    }

    pump();
    notes[0] = 0;
    EnableWindow(window, FALSE);
    wsprintf(probeArgs, "%s,%s%s", kind, focus ? (LPSTR)"focus" : (LPSTR)"",
             capture ? (LPSTR)"capture" : (focus ? (LPSTR)"" : (LPSTR)"neither"));
    wsprintf(probeResult, "%s,focus=%s,capture=%s", (LPSTR)notes,
             GetFocus() == window ? (LPSTR)"yes" : (LPSTR)"no",
             GetCapture() == window ? (LPSTR)"yes" : (LPSTR)"no");
    probe("enable", probeArgs, probeResult);
    notes[0] = 0;
    ReleaseCapture();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const struct {
        LPCSTR name;
        DWORD style;
    } KINDS[] = {
        {"push", BS_PUSHBUTTON},     {"default", BS_DEFPUSHBUTTON},
        {"check", BS_CHECKBOX},      {"autocheck", BS_AUTOCHECKBOX},
        {"radio", BS_RADIOBUTTON},   {"autoradio", BS_AUTORADIOBUTTON},
        {"3state", BS_3STATE},       {"auto3state", BS_AUTO3STATE},
        {"group", BS_GROUPBOX},      {"user", BS_USERBUTTON},
        {"ownerdraw", BS_OWNERDRAW},
    };
    WNDCLASS wc;
    HWND own;
    int i;

    probeOpen(OUTPUT);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = ParentProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "BtnMore";
    RegisterClass(&wc);
    wc.lpfnWndProc = OwnProc;
    wc.lpszClassName = "BtnMoreOwn";
    RegisterClass(&wc);
    parent = CreateWindow("BtnMore", "", WS_POPUP | WS_VISIBLE, 40, 40, 300, 200, NULL, NULL,
                          instance, NULL);
    SetActiveWindow(parent);
    pump();

    for (i = 0; i < 11; i++) {
        settext(KINDS[i].name, KINDS[i].style);
    }

    for (i = 0; i < 11; i++) {
        dlgcode(KINDS[i].name, KINDS[i].style);
    }

    make(BS_PUSHBUTTON);
    buttonProc = (FARPROC)SetWindowLong(button, GWL_WNDPROC, (LONG)(WNDPROC)SubclassProc);
    disable("button", button, TRUE, FALSE);
    disable("button", button, FALSE, TRUE);
    disable("button", button, TRUE, TRUE);
    disable("button", button, FALSE, FALSE);
    DestroyWindow(button);

    own = CreateWindow("BtnMoreOwn", "", WS_CHILD | WS_VISIBLE, 10, 10, 80, 24, parent,
                       (HMENU)ID + 1, instance, NULL);
    pump();
    disable("own", own, TRUE, FALSE);
    disable("own", own, FALSE, TRUE);
    disable("own", own, TRUE, TRUE);
    disable("own", own, FALSE, FALSE);
    DestroyWindow(own);

    DestroyWindow(parent);
    probeFinish();

    return 0;
}
