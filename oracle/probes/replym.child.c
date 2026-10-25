/*
 * The program `replym.c` starts: it finds the probe's window, sends it
 * WM_USER + 1 and WM_USER + 2, posts it WM_USER + 3 and notes in
 * C:\ORACLE\REPLYM.TXT what each send answered, then posts WM_USER + 9 to
 * say it is done, and ends.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\REPLYM.TXT"

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
    HWND probe = FindWindow("ReplyProbe", NULL);
    char line[80];
    LRESULT answer;

    if (!probe) {
        note("no probe window");
        return 0;
    }

    answer = SendMessage(probe, WM_USER + 1, 0x11, 0x22223333L);
    wsprintf(line, "send 1 answered %ld", answer);
    note(line);
    answer = SendMessage(probe, WM_USER + 2, 0x12, 0x44445555L);
    wsprintf(line, "send 2 answered %ld", answer);
    note(line);
    PostMessage(probe, WM_USER + 3, 0x13, 0x66667777L);
    PostMessage(probe, WM_USER + 9, 0, 0);

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
