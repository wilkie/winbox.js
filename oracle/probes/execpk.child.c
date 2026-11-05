/*
 * The program `execpk.c` starts: it writes a line to C:\ORACLE\CHILD.TXT as
 * it starts, then gives up the processor four times in the way its command
 * line names -- `P` by PeekMessage with PM_REMOVE, `Y` by Yield, `N` by
 * PeekMessage with PM_NOYIELD, `X` not at all -- writing a line after each,
 * and a last line as it ends. It makes no window, so nothing is ever in its
 * queue.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\CHILD.TXT"

static void note(LPCSTR text)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, text, lstrlen(text));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char line[40];
    char mode = command[0];
    MSG msg;
    int i;

    wsprintf(line, "%c start", mode);
    note(line);

    for (i = 1; i <= 4; i++) {
        if (mode == 'P') {
            PeekMessage(&msg, NULL, 0, 0, PM_REMOVE);
        } else if (mode == 'Y') {
            Yield();
        } else if (mode == 'N') {
            PeekMessage(&msg, NULL, 0, 0, PM_REMOVE | PM_NOYIELD);
        }

        wsprintf(line, "%c %d", mode, i);
        note(line);
    }

    wsprintf(line, "%c end", mode);
    note(line);

    (void)instance;
    (void)previous;
    (void)show;
    return 0;
}
