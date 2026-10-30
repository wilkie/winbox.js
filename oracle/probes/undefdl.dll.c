/*
 * The library `undefdl.child.c` imports from: UNDEFDLD.DLL, which exports
 * one procedure, `Present`, answering 7. The program also imports from it
 * an ordinal and a name it does not export (`undefdl.child.lnk`).
 */

#include <windows.h>

int FAR PASCAL _export Present(void)
{
    return 7;
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
