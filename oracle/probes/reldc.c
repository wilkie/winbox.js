/*
 * A device context used after it was given back: `GetDC(NULL)`, then
 * `ReleaseDC`, then the same handle asked, as Reversi asks
 * `GetNearestColor` of one.
 *
 * * `released`: `GetNearestColor` of 0xAAAAAA and 0x555555, and
 *   `GetDeviceCaps(BITSPIXEL)` and `GetDeviceCaps(PLANES)`, of the released
 *   handle, in hexadecimal; and the same of one held, to compare.
 * * `again`: whether the next `GetDC(NULL)` answers the same handle.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\RELDC.OUT"

static void ask(LPCSTR name, HDC hdc)
{
    wsprintf(probeArgs, "%s,nearest(aaaaaa)", name);
    wsprintf(probeResult, "%lx", GetNearestColor(hdc, RGB(0xaa, 0xaa, 0xaa)));
    probe("released", probeArgs, probeResult);
    wsprintf(probeArgs, "%s,nearest(555555)", name);
    wsprintf(probeResult, "%lx", GetNearestColor(hdc, RGB(0x55, 0x55, 0x55)));
    probe("released", probeArgs, probeResult);
    wsprintf(probeArgs, "%s,BITSPIXEL", name);
    wsprintf(probeResult, "%x", GetDeviceCaps(hdc, BITSPIXEL));
    probe("released", probeArgs, probeResult);
    wsprintf(probeArgs, "%s,PLANES", name);
    wsprintf(probeResult, "%x", GetDeviceCaps(hdc, PLANES));
    probe("released", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC held;
    HDC released;
    HDC next;

    probeOpen(OUTPUT);

    held = GetDC(NULL);
    ask("held", held);
    ReleaseDC(NULL, held);

    released = GetDC(NULL);
    ReleaseDC(NULL, released);
    ask("released", released);

    next = GetDC(NULL);
    probe("again", "same", next == released ? "yes" : "no");
    ReleaseDC(NULL, next);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
