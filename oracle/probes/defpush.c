/*
 * Which push button is the default as the focus moves, as FIBS/W's About
 * box shows its first button, given the focus as the box opens, with the
 * default's second outline, though its template makes another the default.
 *
 * A modeless dialog from a template: push buttons `A` (11) and `B` (12),
 * `C` (13) the template's default, and an edit control (14), each a tab
 * stop. `WM_INITDIALOG` answers TRUE.
 *
 * * `state`: after each step, which buttons have `BS_DEFPUSHBUTTON`, as the
 *   ids of those that do, the focus's id, and `DM_GETDEFID` in hexadecimal:
 *   as the dialog opens (`open`); after `SetFocus` on B (`setfocus`); after
 *   Tab pressed through `IsDialogMessage` (`tab1`, `tab2`, `tab3`); after
 *   `SetFocus` on A again (`back`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DEFPUSH.OUT"

static HWND dialog;

BOOL FAR PASCAL _export DialogProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return message == WM_INITDIALOG;
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        if (!IsDialogMessage(dialog, &message)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }
    }
}

static void state(LPCSTR step)
{
    char defaults[16];
    HWND focus = GetFocus();
    int id;

    defaults[0] = '\0';

    for (id = 11; id <= 13; id++) {
        if ((GetWindowLong(GetDlgItem(dialog, id), GWL_STYLE) & 0x0f) == BS_DEFPUSHBUTTON) {
            wsprintf(defaults + lstrlen(defaults), "%d.", id);
        }
    }

    wsprintf(probeResult, "%s;%d;%lx", (LPSTR)defaults, focus ? GetDlgCtrlID(focus) : 0,
             SendMessage(dialog, DM_GETDEFID, 0, 0L));
    probe("state", step, probeResult);
}

static void tab(LPCSTR step)
{
    PostMessage(GetFocus(), WM_KEYDOWN, VK_TAB, 0L);
    pump();
    state(step);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    FARPROC proc = MakeProcInstance((FARPROC)DialogProc, instance);

    probeOpen(OUTPUT);

    dialog = CreateDialog(instance, MAKEINTRESOURCE(100), NULL, (DLGPROC)proc);
    pump();
    state("open");

    SetFocus(GetDlgItem(dialog, 12));
    pump();
    state("setfocus");

    tab("tab1");
    tab("tab2");
    tab("tab3");

    SetFocus(GetDlgItem(dialog, 11));
    pump();
    state("back");

    DestroyWindow(dialog);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
