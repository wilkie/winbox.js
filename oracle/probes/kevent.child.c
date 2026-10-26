/*
 * The program `kevent.c` starts, its command line the probe's task in
 * hexadecimal. First thing, it writes its own events as TOOLHELP counts
 * them to the probe's file (`child` / `events`); then it waits for a
 * timer's message a fifth of a second on, writes the probe's events (`child` /
 * `probe-events`), posts the probe's task an event, writes that it did
 * (`child` / `posted`), and ends.
 */

#include <windows.h>
#include <toolhelp.h>

typedef BOOL(FAR PASCAL *FindHandle)(TASKENTRY FAR *, HTASK);
typedef DWORD(FAR PASCAL *DwordOfWord)(WORD);

static void record(LPCSTR args, LPCSTR result)
{
    char line[80];
    HFILE file = _lopen("C:\\ORACLE\\KEVENT.OUT", OF_WRITE);
    int length;

    if (file == HFILE_ERROR) {
        return;
    }

    _llseek(file, 0L, 2);
    length = wsprintf(line, "child\t%s\t%s\r\n", args, result);
    _lwrite(file, line, length);
    _lclose(file);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    TASKENTRY entry;
    char text[16];
    WORD task = 0;
    LPSTR at;
    MSG message;
    UINT timer;

    HINSTANCE toolhelp = LoadLibrary("TOOLHELP.DLL");
    FindHandle find = (FindHandle)GetProcAddress(toolhelp, "TaskFindHandle");

    entry.dwSize = sizeof(entry);
    entry.wcEvents = 0xffff;
    find(&entry, GetCurrentTask());
    wsprintf(text, "%u", entry.wcEvents);
    record("events", text);

    for (at = command; *at; at++) {
        char c = *at;

        task = (WORD)(task * 16 + (c >= 'a' ? c - 'a' + 10 : c >= 'A' ? c - 'A' + 10 : c - '0'));
    }

    /* Waiting for a message first -- a timer's, a fifth of a second on --
     * so that the probe has gone on from WinExec to wait. */
    timer = SetTimer(NULL, 0, 200, NULL);

    while (GetMessage(&message, NULL, 0, 0) && message.message != WM_TIMER) {
        DispatchMessage(&message);
    }

    KillTimer(NULL, timer);

    entry.wcEvents = 0xffff;
    find(&entry, (HTASK)task);
    wsprintf(text, "%u", entry.wcEvents);
    record("probe-events", text);

    ((DwordOfWord)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(31)))(task);
    record("posted", "yes");

    FreeLibrary(toolhelp);
    (void)instance;
    (void)previous;
    (void)show;
    return 0;
}
