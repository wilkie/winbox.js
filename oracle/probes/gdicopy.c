/*
 * Two of GDI's exports for the spooler and the printer drivers, asked by a
 * program, by ordinal.
 *
 * * `copy`: `Copy` of bytes to a buffer apart from them, and onto the bytes
 *   just past them, the buffer read back.
 * * `enumdfonts`: `DMEnumDFonts`'s answer, with nothing to walk.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDICOPY.OUT"

typedef void(FAR PASCAL *COPYPROC)(void FAR *, void FAR *, WORD);
typedef int(FAR PASCAL *ENUMPROC)(void FAR *, void FAR *, void FAR *, void FAR *);

static FARPROC gdiProc(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

static char buffer[17];

static void show(LPCSTR what)
{
    int i;

    for (i = 0; i < 16; i++) {
        probeResult[i] = buffer[i] ? buffer[i] : '.';
    }

    probeResult[16] = 0;
    probe("copy", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show_)
{
    COPYPROC copy = (COPYPROC)gdiProc(250);
    ENUMPROC enumDFonts = (ENUMPROC)gdiProc(206);
    static char source[] = "abcdefgh";

    probeOpen(OUTPUT);

    _fmemset(buffer, 0, sizeof(buffer));
    copy(buffer, source, 5);
    show("five apart");

    _fmemset(buffer, 0, sizeof(buffer));
    lstrcpy(buffer, "xyz");
    copy(buffer + 1, buffer, 8);
    show("eight onto the next byte");

    _fmemset(buffer, 0, sizeof(buffer));
    lstrcpy(buffer, "pqrs");
    copy(buffer, source, 0);
    show("none");

    wsprintf(probeResult, "%d", enumDFonts(NULL, NULL, NULL, NULL));
    probe("enumdfonts", "nothing", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show_;
    return 0;
}
