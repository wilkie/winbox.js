/*
 * The program `loadenv.c` starts: it writes its environment to
 * C:\ORACLE\CHILD.TXT, a line for each string, then a line for the word
 * after the strings and one for the path after that, and ends.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\CHILD.TXT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    LPSTR at = GetDOSEnvironment();
    char line[300];
    HFILE file = _lcreat(LOG, 0);

    while (*at) {
        lstrcpy(line, at);
        lstrcat(line, "\r\n");
        _lwrite(file, line, lstrlen(line));
        at += lstrlen(at) + 1;
    }

    at++;
    wsprintf(line, "count=%u\r\n", *(UINT FAR *)at);
    _lwrite(file, line, lstrlen(line));
    at += 2;
    wsprintf(line, "path=%s\r\n", at);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
