/*
 * The library `nametab.c` loads: NAMETABD.DLL, whose resources are in
 * `nametab.dll.rc` and whose old-style name table (`RT_NAMETABLE`, type
 * 15) `build-probes.mjs` lays out from its named constants. It does
 * nothing else.
 */

#include <windows.h>

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}

int FAR PASCAL _export WEP(int exiting)
{
    (void)exiting;
    return 1;
}
