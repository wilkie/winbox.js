/*
 * A WATCOM Win386 library, `W386LIBD.DLL`, of the shape of Sierra's
 * `SMACKE16.DLL`: 32-bit code bound by `wbind -d` to the library
 * supervisor (`binw/w386dll.ext`), whose 16-bit side exports `DLL1` to
 * `DLL128` and `Win386LibEntry` (`build-probes.mjs`, `buildWin386`). The
 * 32-bit side's `WinMain` runs as the library is loaded, and names the
 * routines a 16-bit caller reaches by number with `DefineDLLEntry`. Called
 * by `w386lib.c`.
 *
 * * 1, `Sum`: two double words and a word, their sum.
 * * 2, `Fill`: a far pointer to the caller's buffer, which it fills with a
 *   string, and its length back. Defined, not called: called under WIN386,
 *   the program ends with a page fault (`w386lib.c`).
 * * 3, `Flags`: `GetWinFlags`, called from the 32-bit side, and a block of
 *   the C library's, written and freed.
 */

#include <stdlib.h>
#include <string.h>
#include <windows.h>

long FAR PASCAL Sum(long a, long b, short c)
{
    return a + b + c;
}

long FAR PASCAL Fill(char *buffer)
{
    strcpy(buffer, "from 32 bits");
    return (long)strlen(buffer);
}

long FAR PASCAL Flags(void)
{
    char *block = malloc(100000);
    long flags = (long)GetWinFlags();

    if (block == NULL) {
        return -1;
    }

    block[99999] = 1;
    free(block);
    return flags;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DefineDLLEntry(1, (void *)Sum, DLL_DWORD, DLL_DWORD, DLL_WORD, DLL_ENDLIST);
    DefineDLLEntry(2, (void *)Fill, DLL_PTR, DLL_ENDLIST);
    DefineDLLEntry(3, (void *)Flags, DLL_ENDLIST);

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 1;
}
