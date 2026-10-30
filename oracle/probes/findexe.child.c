/*
 * The program `findexe.c` copies to C:\ORACLE\HIDE\FINDEXEX.EXE and has
 * `ShellExecute` start through an association: it adds a line with its
 * command line to C:\ORACLE\FINDEXE.TXT and ends.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\FINDEXE.TXT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char line[200];
    HFILE file;

    wsprintf(line, "args=%s\r\n", command);
    file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);

    (void)instance;
    (void)previous;
    (void)show;
    return 0;
}
