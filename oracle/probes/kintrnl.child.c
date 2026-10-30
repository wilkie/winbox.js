/*
 * The program `kintrnl.c` starts with InitTask1's procedure set: marked
 * as running in protected mode only, flag 08h of its header, for which
 * `LoadModule` calls that procedure (`KRNL386.EXE` seg2 `218b`-`219f`,
 * `138e`-`139d`). It ends at once.
 */

#define PROBE_PROTMODE

#include <windows.h>

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
