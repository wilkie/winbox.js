/*
 * `EM_LINELENGTH` of a single-line edit control, as File Manager's Copy box
 * asks it of its From field to size the buffer it reads the field into: with
 * `wParam` -1, 0, 3 and 100, the text "CALC.HLP " in it, nothing selected
 * and then "LC.H" selected; and of an empty one.
 *
 * Each record is `len`: the step, then `wParam`, and the answer.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SLLEN.OUT"

static HWND edit;

static void ask(LPCSTR step)
{
    static const int params[4] = {-1, 0, 3, 100};
    int i;

    for (i = 0; i < 4; i++) {
        wsprintf(probeArgs, "%s,%d", step, params[i]);
        wsprintf(probeResult, "%d", (int)SendMessage(edit, EM_LINELENGTH, (WPARAM)params[i], 0L));
        probe("len", probeArgs, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND host;

    probeOpen(OUTPUT);

    host = CreateWindow("STATIC", "", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL, NULL,
                        instance, NULL);
    edit = CreateWindow("EDIT", "CALC.HLP ", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_AUTOHSCROLL,
                        10, 10, 200, 20, host, (HMENU)1, instance, NULL);

    ask("text");

    SendMessage(edit, EM_SETSEL, 0, MAKELONG(2, 6));
    ask("selected");

    SetWindowText(edit, "");
    ask("empty");

    DestroyWindow(host);
    probeFinish();

    return 0;
}
