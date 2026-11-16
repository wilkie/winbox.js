/*
 * The program `execlib.c` starts: EXECLIBC.EXE, which imports `MISSING`
 * from `NOLIBQI` (`execlib.child.lnk`), a module no file is. Windows does
 * not start it; were it started, it would call the import and end.
 */

#include <windows.h>

void FAR PASCAL MISSING(void);

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    MISSING();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
