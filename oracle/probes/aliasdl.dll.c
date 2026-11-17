/*
 * The library `aliasdl.c` puts in the root of C: as ALIASDLD.DLL, its
 * module's name made ALIASDLX: a file imported by one name whose module
 * has another, as a `CTL3D.DLL` that is `CTL3DV2`. `aliasdl.child.c`
 * imports it as ALIASDLD.
 */

#include <windows.h>

int FAR PASCAL _export AliasHere(void)
{
    return 0x1234;
}

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
