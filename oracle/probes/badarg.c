/*
 * What the API does with a pointer that points nowhere: its selector names
 * no segment (FFF7h, past the descriptor table). Championship Slots of the corpus hands LoadCursor such
 * pointers from a table it never filled, and runs on Windows.
 *
 * Each record is the call and what it answered; `survived` last says the
 * probe was not ended by any of them.
 *
 * Not all of the API checks: RegisterWindowMessage of such a pointer did not
 * come back -- a fault, which ends the program -- so it is not asked here.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BADARG.OUT"

/* Each record is closed into the file, so a call that ends the probe
 * leaves the records before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    LPCSTR nowhere = (LPCSTR)MAKELP(0xfff7, 0x10);
    HDC screen;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    wsprintf(probeResult, "%d", LoadCursor(instance, nowhere) != 0);
    record("LoadCursor", "nowhere", probeResult);
    wsprintf(probeResult, "%d", LoadCursor(NULL, nowhere) != 0);
    record("LoadCursor", "system-nowhere", probeResult);
    wsprintf(probeResult, "%d", LoadIcon(instance, nowhere) != 0);
    record("LoadIcon", "nowhere", probeResult);
    wsprintf(probeResult, "%d", FindWindow(nowhere, NULL) != 0);
    record("FindWindow", "nowhere", probeResult);
    wsprintf(probeResult, "%lx", GetTextExtent(screen, nowhere, 3));
    record("GetTextExtent", "nowhere", probeResult);
    ReleaseDC(NULL, screen);
    record("survived", "all", "1");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
