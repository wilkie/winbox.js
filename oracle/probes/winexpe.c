/*
 * WinExec given a Win32 program, with no Win32s: Widget Workshop's own
 * WIDGET.EXE is one, and its installer leaves Win32s uninstalled on Windows
 * in standard mode. The probe writes the smallest such file there is -- an
 * MZ header whose new header, at 40h, is "PE" with an i386 COFF header and
 * an optional header, no sections -- and starts it.
 *
 * * `exec`: WinExec's answer, `inst` for an instance, else the error.
 * * `load`: LoadModule's, with no parameter block's environment.
 * * `library`: LoadLibrary's.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINEXPE.OUT"
#define PE32 "C:\\ORACLE\\PE32.EXE"

static unsigned char image[0x40 + 4 + 20 + 0xe0];

static void put16(int at, unsigned value)
{
    image[at] = (unsigned char)value;
    image[at + 1] = (unsigned char)(value >> 8);
}

static void put32(int at, unsigned long value)
{
    put16(at, (unsigned)value);
    put16(at + 2, (unsigned)(value >> 16));
}

static void answer(LPCSTR function, LPCSTR args, UINT result)
{
    if (result >= 32) {
        lstrcpy(probeResult, "inst");
    } else {
        wsprintf(probeResult, "%u", result);
    }

    probe(function, args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HFILE file;
    int coff = 0x40 + 4;
    int optional = coff + 20;
    struct {
        WORD environment;
        LPSTR tail;
        LPVOID show;
        LPVOID reserved;
    } block;
    static WORD showing[2] = {2, SW_SHOWNORMAL};
    static char tail[2] = {0, 0};

    probeOpen(OUTPUT);

    image[0] = 'M';
    image[1] = 'Z';
    put16(0x18, 0x40);
    put32(0x3c, 0x40);
    image[0x40] = 'P';
    image[0x41] = 'E';
    put16(coff, 0x14c);
    put16(coff + 16, 0xe0);
    put16(coff + 18, 0x0102);
    put16(optional, 0x10b);
    put32(optional + 28, 0x400000);
    put32(optional + 32, 0x1000);
    put32(optional + 36, 0x200);
    put16(optional + 40, 3);
    put16(optional + 48, 3);
    put16(optional + 50, 10);
    put32(optional + 56, 0x1000);
    put32(optional + 60, 0x200);
    put16(optional + 68, 2);
    put32(optional + 72, 0x100000);
    put32(optional + 76, 0x1000);
    put32(optional + 80, 0x100000);
    put32(optional + 84, 0x1000);
    put32(optional + 92, 16);

    file = _lcreat(PE32, 0);
    _lwrite(file, (LPCSTR)image, sizeof(image));
    _lclose(file);

    answer("exec", "pe32", WinExec(PE32, SW_SHOWNORMAL));

    block.environment = 0;
    block.tail = tail;
    block.show = showing;
    block.reserved = NULL;
    answer("load", "pe32", (UINT)LoadModule(PE32, &block));
    answer("library", "pe32", (UINT)LoadLibrary(PE32));

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
