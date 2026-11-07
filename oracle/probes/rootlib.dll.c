/*
 * The library `rootlib.c` puts in the root of C: alone: ROOTLIBD.DLL, which
 * the program `rootlib.child.c` imports, and copied with its module's name
 * made ROOTLIBL, which that program loads by `LoadLibrary`. It does
 * nothing; where it was found from is its module's file.
 */

#include <windows.h>

int FAR PASCAL _export RootHere(void)
{
    return 1;
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
