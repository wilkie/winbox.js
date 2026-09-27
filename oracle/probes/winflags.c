/*
 * What Windows says of the machine it runs on: `GetWinFlags`, and the value
 * KERNEL exports as `__WINFLAGS` (ordinal 178), which libraries read -- the
 * coprocessor emulator among them, to choose whether to emulate.
 *
 * * `flags`: each value, in hexadecimal.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINFLAGS.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    FARPROC exported;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%08lx", GetWinFlags());
    probe("flags", "GetWinFlags", probeResult);

    /* An absolute value, not a function: its "address" is the value. */
    exported = GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(178));
    wsprintf(probeResult, "%04x", (UINT)(DWORD)exported);
    probe("flags", "__WINFLAGS", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
