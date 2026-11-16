/*
 * The library `libmiss.c` loads: LIBMISSD.DLL, which imports `Absent` from
 * NOSUCHMD, a module that is nowhere (`libmiss.dll.lnk`), as a Visual Basic
 * control imports a library its download left out (GRAPH.VBX and
 * GSWDLL). It calls the import only when asked.
 */

#include <windows.h>

int FAR PASCAL Absent(void);

int FAR PASCAL _export CallAbsent(void)
{
    return Absent();
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
