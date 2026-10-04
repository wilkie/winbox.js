/*
 * A button clicked with the mouse, each kind of button in turn: the mouse's
 * messages sent to it as USER sends them -- WM_LBUTTONDOWN, WM_MOUSEMOVE,
 * WM_LBUTTONUP and WM_LBUTTONDBLCLK, at points of its client area -- and
 * what the button does with them.
 *
 * A pop-up at (40, 40), 300 by 200, holds one button at a time, 80 by 24 at
 * (10, 10), made active. The kinds: push, default push, check box, auto
 * check box, radio, auto radio, three-state, auto three-state.
 *
 * * `step`: the kind and the step -- `down` inside, `move-out` to a point
 *   outside it, `move-in` back, `up` inside or `up-out` outside, `dbl`
 *   a double click's second press -- as `kind,sequence,step`; the result
 *   is the button's state (BM_GETSTATE, in hexadecimal), whether it has the
 *   capture and the focus, and the notifications its parent was sent since
 *   the last step, each as WM_COMMAND's code, in order.
 * * `answer`: what the button answered each message, where it is not 0.
 * * And each kind again disabled: the same down and up.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BTNCLICK.OUT"

#define ID 100

static HWND parent;
static HWND button;
static char notes[256];

static LRESULT CALLBACK ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_COMMAND && wParam == ID) {
        char one[16];

        wsprintf(one, "%s%u", (LPSTR)(notes[0] ? ";" : ""), HIWORD(lParam));
        lstrcat(notes, one);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* The mouse message sent to the button, as USER would send it; the step's
 * record. */
static void step(LPCSTR kind, LPCSTR sequence, LPCSTR name, UINT message, WPARAM keys, int x,
                 int y)
{
    MSG msg;
    LRESULT answer;

    answer = SendMessage(button, message, keys, MAKELPARAM(x, y));

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    wsprintf(probeArgs, "%s,%s,%s", kind, sequence, name);

    if (answer) {
        wsprintf(probeResult, "%lx", answer);
        probe("answer", probeArgs, probeResult);
    }

    wsprintf(probeResult, "state=%x,capture=%s,focus=%s,notes=%s",
             (UINT)SendMessage(button, BM_GETSTATE, 0, 0L),
             GetCapture() == button ? (LPSTR)"yes" : (LPSTR)"no",
             GetFocus() == button ? (LPSTR)"yes" : (LPSTR)"no", (LPSTR)notes);
    probe("step", probeArgs, probeResult);
    notes[0] = 0;
}

static void kind(LPCSTR name, DWORD style, BOOL enabled)
{
    MSG msg;
    char label[24];

    lstrcpy(label, name);

    if (!enabled) {
        lstrcat(label, "-disabled");
    }

    button = CreateWindow("BUTTON", "Button", WS_CHILD | WS_VISIBLE | style, 10, 10, 80, 24,
                          parent, (HMENU)ID, NULL, NULL);
    SetFocus(parent);

    if (!enabled) {
        EnableWindow(button, FALSE);
    }

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    notes[0] = 0;

    step(label, "1", "down", WM_LBUTTONDOWN, MK_LBUTTON, 20, 10);
    step(label, "1", "up", WM_LBUTTONUP, 0, 20, 10);

    if (enabled) {
        step(label, "2", "down", WM_LBUTTONDOWN, MK_LBUTTON, 20, 10);
        step(label, "2", "move-out", WM_MOUSEMOVE, MK_LBUTTON, 200, 10);
        step(label, "2", "up-out", WM_LBUTTONUP, 0, 200, 10);

        step(label, "3", "down", WM_LBUTTONDOWN, MK_LBUTTON, 20, 10);
        step(label, "3", "move-out", WM_MOUSEMOVE, MK_LBUTTON, 20, 100);
        step(label, "3", "move-in", WM_MOUSEMOVE, MK_LBUTTON, 30, 12);
        step(label, "3", "up", WM_LBUTTONUP, 0, 30, 12);

        step(label, "4", "down", WM_LBUTTONDOWN, MK_LBUTTON, 20, 10);
        step(label, "4", "up", WM_LBUTTONUP, 0, 20, 10);
        step(label, "4", "dbl", WM_LBUTTONDBLCLK, MK_LBUTTON, 20, 10);
        step(label, "4", "up", WM_LBUTTONUP, 0, 20, 10);

        step(label, "5", "up-alone", WM_LBUTTONUP, 0, 20, 10);
    }

    DestroyWindow(button);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    int pass;

    probeOpen(OUTPUT);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = ParentProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "BtnClick";
    RegisterClass(&wc);
    parent = CreateWindow("BtnClick", "", WS_POPUP | WS_VISIBLE, 40, 40, 300, 200, NULL, NULL,
                          instance, NULL);
    SetActiveWindow(parent);

    for (pass = 0; pass < 2; pass++) {
        BOOL enabled = pass == 0;

        kind("push", BS_PUSHBUTTON, enabled);
        kind("default", BS_DEFPUSHBUTTON, enabled);
        kind("check", BS_CHECKBOX, enabled);
        kind("autocheck", BS_AUTOCHECKBOX, enabled);
        kind("radio", BS_RADIOBUTTON, enabled);
        kind("autoradio", BS_AUTORADIOBUTTON, enabled);
        kind("3state", BS_3STATE, enabled);
        kind("auto3state", BS_AUTO3STATE, enabled);
    }

    DestroyWindow(parent);
    probeFinish();

    return 0;
}
