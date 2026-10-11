/*
 * The screen saver `spiidle.c` names in `SYSTEM.INI`: it writes the
 * command line it was started with to C:\ORACLE\SAVER.TXT, a line a start,
 * and ends.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\SAVER.TXT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char line[160];
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    wsprintf(line, "[%s] %d\r\n", command, show);
    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);

    (void)instance;
    (void)previous;
    return 0;
}
