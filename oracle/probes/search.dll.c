/*
 * The library `search.c` puts in each place KERNEL looks: SEARCHD.DLL,
 * which the program `search.child.c` imports, and copied with its module's
 * name made SEARCHL, which that program loads by `LoadLibrary`. It does
 * nothing; where it was found from is its module's file.
 */

#include <windows.h>

int FAR PASCAL _export SearchHere(void)
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
