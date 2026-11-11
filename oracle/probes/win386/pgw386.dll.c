/*
 * A WATCOM Win386 library, `PGW386D.DLL`, made as `w386lib.dll.c` is
 * (`build-probes.mjs`, `buildWin386`), with `w386lib`'s routine 2: given a
 * far pointer to the caller's buffer as a `DLL_PTR`, which the supervisor
 * passes through unchanged and the 32-bit routine takes as an offset in its
 * flat data segment (`kb/topics/win386.md`, "Libraries"). Called by
 * `pgw386.c`.
 *
 * * 2, `Fill`: a string copied through the pointer, and its length back.
 */

#include <stdlib.h>
#include <string.h>
#include <windows.h>

long FAR PASCAL Fill(char *buffer)
{
    strcpy(buffer, "from 32 bits");
    return (long)strlen(buffer);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DefineDLLEntry(2, (void *)Fill, DLL_PTR, DLL_ENDLIST);

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 1;
}
