/*
 * Whose the current directory is when programs run together. The program
 * started, CURDIRC.EXE (`curdir.child.c`), writes a line to
 * C:\ORACLE\CURDIR.TXT as it starts, as it changes directory, and for each
 * WM_USER it takes, each with its current directory.
 *
 * KERNEL keeps a drive and a directory in each task's database (TDB 66h and
 * 67h): it reads DOS's into the task's as the task gives up the processor,
 * and sets DOS's from the next task's before that task's next call on a path
 * (`KRNL386.EXE` seg1 `8170` and `1c64`). This is what a program sees of it.
 *
 * * `cwd`: the probe's current directory at each point.
 * * `exec`: WinExec's answer, `inst` for an instance, else the error: for
 *   the other program by its whole path, and for a copy of it by its name
 *   alone, from the directory the copy is in and nowhere else WinExec looks.
 * * `made`: where a file the other program made by a relative name is:
 *   `CB` in the directory it changed to, `ORACLE` in the probe's, `none`.
 * * `child`: the other program's lines, at the end.
 */

#include "probe.h"
#include <direct.h>

#define OUTPUT "C:\\ORACLE\\CURDIR.OUT"
#define LOG "C:\\ORACLE\\CURDIR.TXT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static char text[1200];

static void cwd(LPCSTR when)
{
    char directory[80];

    directory[0] = '\0';
    getcwd(directory, sizeof(directory));
    probe("cwd", when, directory);
}

/* Lets the others run for a while. */
static void settle(void)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < 500) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* Lets the others run until the other program's window is there. */
static HWND waitFor(void)
{
    DWORD start = GetTickCount();
    MSG msg;
    HWND found;

    for (;;) {
        found = FindWindow("CurDirChild", NULL);

        if (found || GetTickCount() - start > 5000) {
            return found;
        }

        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* A file copied, a kilobyte at a time. */
static void copy(LPCSTR from, LPCSTR to)
{
    char buffer[1024];
    HFILE in = _lopen(from, OF_READ);
    HFILE out = _lcreat(to, 0);
    UINT got;

    while (in != HFILE_ERROR && out != HFILE_ERROR &&
           (got = _lread(in, buffer, sizeof(buffer))) > 0 && got != (UINT)HFILE_ERROR) {
        _lwrite(out, buffer, got);
    }

    _lclose(in);
    _lclose(out);
}

static BOOL there(LPCSTR path)
{
    OFSTRUCT of;

    return OpenFile(path, &of, OF_EXIST) != HFILE_ERROR;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT answer;
    HWND child;
    HFILE file;
    OFSTRUCT of;
    int length;

    probeOpen(OUTPUT);

    file = _lcreat(LOG, 0);
    _lclose(file);
    OpenFile("C:\\ORACLE\\CB\\REL.TXT", &of, OF_DELETE);
    OpenFile("C:\\ORACLE\\REL.TXT", &of, OF_DELETE);
    mkdir("C:\\ORACLE\\PA");
    mkdir("C:\\ORACLE\\CB");

    cwd("at start");
    chdir("C:\\ORACLE\\PA");
    cwd("changed to PA");

    /* By its whole path, from PA: the other program's own folder is
     * C:\WINDOWS, where the recorder puts it beside the probe, so where it
     * starts tells the two apart. */
    answer = WinExec("C:\\WINDOWS\\CURDIRC.EXE", SW_SHOWMINNOACTIVE);
    probe("exec", "child", (LPSTR)(answer > 32 ? "inst" : "error"));
    child = waitFor();
    probe("exec", "its window", (LPSTR)(child ? "there" : "missing"));

    /* The other program has changed to CB, and waits for a message. */
    cwd("after the child changed to CB");

    chdir("C:\\ORACLE");
    cwd("changed to ORACLE");

    SendMessage(child, WM_USER, 1, 0L);
    cwd("after a message sent to the child");

    PostMessage(child, WM_USER, 2, 0L);
    settle();
    cwd("after a message posted to the child");

    probe("made", "REL.TXT",
          (LPSTR)(there("C:\\ORACLE\\CB\\REL.TXT")
                      ? "CB"
                      : there("C:\\ORACLE\\REL.TXT") ? "ORACLE" : "none"));

    SendMessage(child, WM_CLOSE, 0, 0L);
    settle();
    cwd("after the child ended");

    /* A copy of it by its name alone, from C:\ORACLE, where the copy is:
     * not Windows' directory, nor its system directory, nor the probe's. */
    copy("C:\\WINDOWS\\CURDIRC.EXE", "C:\\ORACLE\\CDHERE.EXE");
    answer = WinExec("CDHERE.EXE", SW_SHOWMINNOACTIVE);
    if (answer > 32) {
        lstrcpy(probeResult, "inst");
    } else {
        wsprintf(probeResult, "%u", answer);
    }
    probe("exec", "by name, in the current directory", probeResult);
    child = waitFor();
    if (child) {
        SendMessage(child, WM_CLOSE, 0, 0L);
        settle();
    }
    OpenFile("C:\\ORACLE\\CDHERE.EXE", &of, OF_DELETE);

    file = _lopen(LOG, OF_READ);
    length = file == HFILE_ERROR ? 0 : _lread(file, text, sizeof(text) - 1);
    if (file != HFILE_ERROR) {
        _lclose(file);
    }
    text[length < 0 ? 0 : length] = '\0';
    probe("child", "all", text);

    OpenFile("C:\\ORACLE\\CB\\REL.TXT", &of, OF_DELETE);
    OpenFile("C:\\ORACLE\\REL.TXT", &of, OF_DELETE);
    rmdir("C:\\ORACLE\\PA");
    rmdir("C:\\ORACLE\\CB");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
