/*
 * `GetSpoolJob`: GDI's own interface to Print Manager, an option and a
 * parameter, asked in the order Print Manager asks as it starts -- 1Dh, 19h,
 * 14h with a buffer, 15h with its window -- and then the options that only
 * read, on an installation with no printer.
 *
 * * `answer`: what an option answered, as a hexadecimal DWORD.
 * * `buffer`: the 256 bytes option 14h was given, filled beforehand with AAh,
 *   as hexadecimal: what it wrote there.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SPOOLJOB.OUT"

typedef LONG(FAR PASCAL *SPOOLPROC)(UINT, LONG);

static SPOOLPROC spool;

static void ask(LPCSTR what, UINT option, LONG parameter)
{
    wsprintf(probeResult, "%08lx", spool(option, parameter));
    probe("answer", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static BYTE buffer[256];
    static char text[520];
    WNDCLASS kind;
    HWND window;
    int i;

    probeOpen(OUTPUT);

    spool = (SPOOLPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(245));

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SpoolJob";
    RegisterClass(&kind);
    window = CreateWindow("SpoolJob", "Spool", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL,
                          instance, NULL);

    ask("1d-first", 0x1d, 0L);
    ask("19", 0x19, 0L);
    ask("19-again", 0x19, 0L);
    ask("1d", 0x1d, 0L);

    for (i = 0; i < sizeof(buffer); i++) {
        buffer[i] = 0xaa;
    }

    ask("14", 0x14, (LONG)(BYTE FAR *)buffer);

    for (i = 0; i < sizeof(buffer); i++) {
        wsprintf(text + i * 2, "%02x", buffer[i]);
    }

    probe("buffer", "14", text);

    ask("22-before", 0x22, 0L);
    probe("answer", "15", (LPSTR)(spool(0x15, (LONG)(WORD)window) == 0 ? "00000000" : "other"));
    ask("22", 0x22, 0L);
    ask("20-0", 0x20, 0L);
    ask("21-0", 0x21, 0L);
    ask("16", 0x16, 0L);
    ask("13", 0x13, 0L);
    ask("24", 0x24, 0L);
    ask("15-clear", 0x15, 0L);
    ask("22-after", 0x22, 0L);
    ask("1f", 0x1f, 0L);
    ask("1d-after", 0x1d, 0L);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
