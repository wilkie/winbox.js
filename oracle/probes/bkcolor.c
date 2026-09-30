/*
 * What `SetBkColor` and `SetTextColor` answer: the colour before, as the
 * program gave it or as the display has it. Programs pass one back to put
 * it back, and a WM_CTLCOLOR handler reads it.
 *
 * * `answer`: on a device context of the screen, each call's answer in
 *   hexadecimal, in turn: to 123456h, a colour the display has not; to
 *   C0C0C0h; to 02000080h, a palette-relative one; and back to white or
 *   black. Then `GetBkColor` and `GetTextColor` after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BKCOLOR.OUT"

static void answer(LPCSTR name, DWORD value)
{
    wsprintf(probeResult, "%lx", value);
    probe("answer", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC hdc;

    probeOpen(OUTPUT);
    hdc = GetDC(NULL);

    answer("bk first", SetBkColor(hdc, RGB(0x56, 0x34, 0x12)));
    answer("bk after 123456", SetBkColor(hdc, RGB(0xc0, 0xc0, 0xc0)));
    answer("bk after c0c0c0", SetBkColor(hdc, 0x02000080L));
    answer("bk after 02000080", SetBkColor(hdc, RGB(0xff, 0xff, 0xff)));
    answer("GetBkColor", GetBkColor(hdc));

    answer("text first", SetTextColor(hdc, RGB(0x56, 0x34, 0x12)));
    answer("text after 123456", SetTextColor(hdc, RGB(0xc0, 0xc0, 0xc0)));
    answer("text after c0c0c0", SetTextColor(hdc, 0x02000080L));
    answer("text after 02000080", SetTextColor(hdc, RGB(0, 0, 0)));
    answer("GetTextColor", GetTextColor(hdc));

    ReleaseDC(NULL, hdc);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
