/*
 * A button with the keyboard, and the rest of its procedure the mouse does
 * not reach: each kind of button in turn, in a pop-up at (40, 40), 300 by
 * 200, at (10, 10), 80 by 24.
 *
 * * `key`: the Space bar sent to the button as the keyboard sends it --
 *   WM_KEYDOWN, WM_CHAR and WM_KEYUP of VK_SPACE -- and other keys; as
 *   `kind,step`, the button's state (BM_GETSTATE, in hexadecimal), whether
 *   it has the capture and the focus, and the parent's notifications since
 *   the last step, each as WM_COMMAND's code.
 * * `check`: BM_SETCHECK with 0 to 3 on each kind, then BM_GETCHECK, and
 *   whether WS_TABSTOP is set, as `kind,value`.
 * * `radiofocus`: a radio button given the focus, checked or not, and a
 *   check box: the notifications.
 * * `owner`: an owner-drawn button's state set and cleared: the messages its
 *   parent was sent, in order -- WM_CTLCOLOR with its type, WM_DRAWITEM with
 *   its action and state, WM_COMMAND with its code.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BTNKEYS.OUT"

#define ID 100

static HWND parent;
static HWND button;
static char notes[512];

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

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

static void record(LPCSTR function, LPCSTR kind, LPCSTR step)
{
    pump();
    wsprintf(probeArgs, "%s,%s", kind, step);
    wsprintf(probeResult, "state=%x,capture=%s,focus=%s,notes=%s",
             (UINT)SendMessage(button, BM_GETSTATE, 0, 0L),
             GetCapture() == button ? (LPSTR)"yes" : (LPSTR)"no",
             GetFocus() == button ? (LPSTR)"yes" : (LPSTR)"no", (LPSTR)notes);
    probe(function, probeArgs, probeResult);
    notes[0] = 0;
}

static void make(DWORD style)
{
    button = CreateWindow("BUTTON", "Button", WS_CHILD | WS_VISIBLE | style, 10, 10, 80, 24,
                          parent, (HMENU)ID, NULL, NULL);
    pump();
    notes[0] = 0;
}

/* The Space bar, as the keyboard sends it, and other keys. */
static void keys(LPCSTR kind, DWORD style)
{
    make(style);
    SetFocus(button);
    record("key", kind, "focused");

    SendMessage(button, WM_KEYDOWN, VK_SPACE, 0x00390001L);
    record("key", kind, "space-down");
    SendMessage(button, WM_CHAR, ' ', 0x00390001L);
    record("key", kind, "space-char");
    SendMessage(button, WM_KEYUP, VK_SPACE, 0xc0390001L);
    record("key", kind, "space-up");

    SendMessage(button, WM_KEYDOWN, VK_SPACE, 0x00390001L);
    SendMessage(button, WM_KEYDOWN, VK_SPACE, 0x40390001L);
    record("key", kind, "space-repeat");
    SendMessage(button, WM_KEYUP, VK_SPACE, 0xc0390001L);
    record("key", kind, "space-up-again");

    SendMessage(button, WM_KEYUP, VK_SPACE, 0xc0390001L);
    record("key", kind, "space-up-alone");

    SendMessage(button, WM_KEYDOWN, VK_SPACE, 0x00390001L);
    SendMessage(button, WM_KEYDOWN, VK_RETURN, 0x001c0001L);
    record("key", kind, "space-then-return");
    SendMessage(button, WM_KEYUP, VK_SPACE, 0xc0390001L);
    record("key", kind, "space-up-after-return");

    SendMessage(button, WM_KEYDOWN, VK_SPACE, 0x00390001L);
    SetFocus(parent);
    record("key", kind, "space-then-focus-away");
    SetFocus(button);
    record("key", kind, "focus-back");

    SendMessage(button, WM_KEYDOWN, VK_RETURN, 0x001c0001L);
    SendMessage(button, WM_KEYUP, VK_RETURN, 0xc01c0001L);
    record("key", kind, "return");

    EnableWindow(button, FALSE);
    SendMessage(button, WM_KEYDOWN, VK_SPACE, 0x00390001L);
    SendMessage(button, WM_KEYUP, VK_SPACE, 0xc0390001L);
    record("key", kind, "space-disabled");

    DestroyWindow(button);
}

/* BM_SETCHECK with each value. */
static void checks(LPCSTR kind, DWORD style)
{
    UINT value;
    char step[16];

    make(style);

    for (value = 0; value <= 3; value++) {
        SendMessage(button, BM_SETCHECK, value, 0L);
        wsprintf(probeArgs, "%s,%u", kind, value);
        wsprintf(probeResult, "check=%u,tabstop=%s,notes=%s",
                 (UINT)SendMessage(button, BM_GETCHECK, 0, 0L),
                 GetWindowLong(button, GWL_STYLE) & WS_TABSTOP ? (LPSTR)"yes" : (LPSTR)"no",
                 (LPSTR)notes);
        probe("check", probeArgs, probeResult);
        notes[0] = 0;
    }

    wsprintf(step, "%u", 0);
    DestroyWindow(button);
}

/* A radio button given the focus. */
static void focus(LPCSTR kind, DWORD style)
{
    char step[32];

    make(style);
    SetFocus(parent);
    pump();
    notes[0] = 0;

    SetFocus(button);
    record("radiofocus", kind, "unchecked");
    SetFocus(parent);
    record("radiofocus", kind, "away");

    SendMessage(button, BM_SETCHECK, 1, 0L);
    pump();
    notes[0] = 0;
    SetFocus(button);
    record("radiofocus", kind, "checked");
    SetFocus(parent);
    SendMessage(button, BM_SETCHECK, 0, 0L);
    pump();
    notes[0] = 0;

    lstrcpy(step, "unchecked-again");
    SetFocus(button);
    record("radiofocus", kind, step);

    DestroyWindow(button);
}

/* An owner-drawn button's state set and cleared. */
static void owner(void)
{
    make(BS_OWNERDRAW);
    pump();
    notes[0] = 0;

    SendMessage(button, BM_SETSTATE, TRUE, 0L);
    record("owner", "ownerdraw", "set");
    SendMessage(button, BM_SETSTATE, TRUE, 0L);
    record("owner", "ownerdraw", "set-again");
    SendMessage(button, BM_SETSTATE, FALSE, 0L);
    record("owner", "ownerdraw", "clear");
    SendMessage(button, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(20, 10));
    record("owner", "ownerdraw", "down");
    SendMessage(button, WM_LBUTTONUP, 0, MAKELPARAM(20, 10));
    record("owner", "ownerdraw", "up");
    SendMessage(button, WM_LBUTTONDBLCLK, MK_LBUTTON, MAKELPARAM(20, 10));
    record("owner", "ownerdraw", "dbl");
    SendMessage(button, WM_LBUTTONUP, 0, MAKELPARAM(20, 10));
    record("owner", "ownerdraw", "dbl-up");

    DestroyWindow(button);
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
    int i;

    probeOpen(OUTPUT);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = ParentProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "BtnKeys";
    RegisterClass(&wc);
    parent = CreateWindow("BtnKeys", "", WS_POPUP | WS_VISIBLE, 40, 40, 300, 200, NULL, NULL,
                          instance, NULL);
    SetActiveWindow(parent);

    for (i = 0; i < 8; i++) {
        keys(KINDS[i].name, KINDS[i].style);
    }

    for (i = 0; i < 11; i++) {
        checks(KINDS[i].name, KINDS[i].style);
    }

    focus("radio", BS_RADIOBUTTON);
    focus("autoradio", BS_AUTORADIOBUTTON);
    focus("check", BS_CHECKBOX);
    owner();

    DestroyWindow(parent);
    probeFinish();

    return 0;
}
