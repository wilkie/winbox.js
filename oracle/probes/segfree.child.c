/*
 * The program `segfree.c` runs twice: it writes down its own selectors --
 * its code and data segments, its instance, its module, its task, its
 * program segment prefix and its environment -- for the probe to compare
 * across the two runs, and ends.
 */

#include <windows.h>

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WORD values[8];
    WORD code;
    WORD data;
    WORD pdb;
    HFILE file;

    _asm {
        mov code, cs
        mov data, ds
    }

    pdb = (WORD)GetCurrentPDB();
    values[0] = code;
    values[1] = data;
    values[2] = (WORD)instance;
    values[3] = (WORD)GetModuleHandle("SEGFREEC");
    values[4] = (WORD)GetCurrentTask();
    values[5] = pdb;
    values[6] = *(WORD FAR *)MAKELP(pdb, 0x2c);
    values[7] = 0x5346;

    file = _lcreat("C:\\ORACLE\\SEGFREE.DAT", 0);

    if (file != HFILE_ERROR) {
        _lwrite(file, (LPCSTR)values, sizeof(values));
        _lclose(file);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
