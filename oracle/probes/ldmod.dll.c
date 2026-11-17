/*
 * The library `ldmod.c` loads with LoadModule and a parameter block, as
 * Math Blaster loads its own libraries (`MB4.EXE` at `177:1512` and
 * `177:157b`): LDMODD.DLL, whose LibMain notes how many times it ran, the
 * instance it was given and the stack it ran on, and whose `LdmodInfo`
 * answers them.
 */

#include <windows.h>

static WORD calls;
static WORD given;
static WORD stack;

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    WORD onStack;

    _asm {
        mov ax, ss
        mov onStack, ax
    }
    calls++;
    given = (WORD)instance;
    stack = onStack;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}

/* 0: LibMain's calls; 1: the instance it was given; 2: its SS. */
WORD FAR PASCAL _export LdmodInfo(int which)
{
    return which == 0 ? calls : which == 1 ? given : stack;
}

int FAR PASCAL _export WEP(int exiting)
{
    (void)exiting;
    return 1;
}
