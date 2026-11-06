/*
 * `WritePrivateProfileString` and `WriteProfileString` given NULL, or an
 * empty string, for the entry or the value.
 *
 * SimTower's setup calls `WriteProfileString("WinG", NULL, NULL)` on a
 * `WIN.INI` with no `[WinG]`. Each case here writes its own file first,
 * through the file API so its bytes are exactly what is laid down, under a
 * name of its own, so KERNEL loads it afresh; makes one call; and records the
 * answer and the file's bytes as they are after it (the read of them is the
 * next DOS call, which writes out what the call left to write).
 *
 * * `write`: the call's arguments and its answer.
 * * `file`: the file's bytes after it, carriage returns and line feeds shown
 *   as `\r` and `\n`. A file nothing was written to keeps the spacing it was
 *   laid down with; one KERNEL wrote back has its lines compacted.
 * * `read`: a value read back after the call, where it says something the
 *   bytes do not.
 * * `WIN.INI`: a section deleted that is not there, and one written and
 *   deleted; whether `[ProbeNul]` is in the file after, and whether its
 *   length changed. And how many `WM_WININICHANGE` messages a window of the
 *   probe's is sent or posted across the calls.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PROFNUL.OUT"

/* Sections around the one deleted, a comment within it, a value with
 * trailing blanks (compacted to `y=two\r \r\n` as the file is loaded), and
 * blank lines between sections. */
static const char BASE[] =
    "[First]\r\n"
    "a=1\r\n"
    "\r\n"
    "[Gone]\r\n"
    "x=1\r\n"
    "; kept comment\r\n"
    "y=  two  \r\n"
    "\r\n"
    "[Last]\r\n"
    "z=3\r\n";

/* No line ending after the last line. */
static const char OPEN[] =
    "[A]\r\n"
    "a=1\r\n"
    "[B]\r\n"
    "b=2";

/* A section twice. */
static const char TWICE[] =
    "[D]\r\n"
    "a=1\r\n"
    "[E]\r\n"
    "e=1\r\n"
    "[D]\r\n"
    "b=2\r\n";

static int case_number = 0;
static char path[64];
static int changes = 0;

static void layDown(LPCSTR text)
{
    HFILE handle;

    case_number++;
    wsprintf(path, "C:\\ORACLE\\PN%d.INI", case_number);
    handle = _lcreat(path, 0);

    if (handle != HFILE_ERROR) {
        _lwrite(handle, text, lstrlen(text));
        _lclose(handle);
    }
}

static void dumpFile(LPCSTR label)
{
    static char text[1024];
    HFILE file = _lopen(path, OF_READ);
    int length;

    if (file == HFILE_ERROR) {
        probe("file", label, "none");
        return;
    }

    length = _lread(file, text, sizeof(text) - 1);
    _lclose(file);

    if (length < 0) {
        length = 0;
    }

    text[length] = '\0';
    probe("file", label, text);
}

static LPCSTR shown(LPCSTR text)
{
    return text == NULL ? "NULL" : text;
}

static void one(LPCSTR label, LPCSTR base, LPCSTR section, LPCSTR entry, LPCSTR value)
{
    int answer;

    layDown(base);
    answer = (int)WritePrivateProfileString(section, entry, value, path);
    wsprintf(probeArgs, "%s,\"%s\",\"%s\",\"%s\"", label, shown(section), shown(entry),
             shown(value));
    wsprintf(probeResult, "%d", answer);
    probe("write", probeArgs, probeResult);
    dumpFile(label);
}

static void readBack(LPCSTR label, LPCSTR section, LPCSTR entry)
{
    char buffer[64];
    int count = GetPrivateProfileString(section, entry, "<default>", buffer, sizeof(buffer), path);

    wsprintf(probeArgs, "%s,\"%s\",\"%s\"", label, shown(section), shown(entry));
    wsprintf(probeResult, "%d,\"%s\"", count, (LPSTR)buffer);
    probe("read", probeArgs, probeResult);
}

/* Whether WIN.INI holds `[ProbeNul]`, and its length. */
static long windowsIni(BOOL *holds)
{
    static char text[16384];
    char windows[144];
    HFILE file;
    long length;
    int at;

    GetWindowsDirectory(windows, sizeof(windows));

    if (windows[lstrlen(windows) - 1] != '\\') {
        lstrcat(windows, "\\");
    }

    lstrcat(windows, "WIN.INI");
    *holds = FALSE;
    file = _lopen(windows, OF_READ);

    if (file == HFILE_ERROR) {
        return -1;
    }

    length = _llseek(file, 0L, 2);
    _llseek(file, 0L, 0);
    at = _lread(file, text, sizeof(text) - 1);
    _lclose(file);

    if (at < 0) {
        at = 0;
    }

    text[at] = '\0';

    for (at = 0; text[at] != '\0'; at++) {
        static const char NAME[] = "[probenul]";
        int i;

        for (i = 0; NAME[i] != '\0'; i++) {
            char c = text[at + i];

            if (c >= 'A' && c <= 'Z') {
                c += 'a' - 'A';
            }

            if (c != NAME[i]) {
                break;
            }
        }

        if (NAME[i] == '\0') {
            *holds = TRUE;
        }
    }

    return length;
}

LRESULT CALLBACK _export Listener(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_WININICHANGE) {
        changes++;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HWND hwnd;
    BOOL holds;
    long before;
    long after;
    int answer;
    int i;

    probeOpen(OUTPUT);

    wc.style = 0;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hIcon = NULL;
    wc.hCursor = NULL;
    wc.hbrBackground = NULL;
    wc.lpszMenuName = NULL;
    wc.lpfnWndProc = Listener;
    wc.hInstance = instance;
    wc.lpszClassName = "ProfNul";
    RegisterClass(&wc);
    hwnd = CreateWindow("ProfNul", "ProfNul", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance,
                        NULL);
    pump();

    probeNote("a NULL entry");
    one("section", BASE, "Gone", NULL, NULL);
    one("last", BASE, "Last", NULL, NULL);
    one("first", BASE, "First", NULL, NULL);
    one("value given", BASE, "Gone", NULL, "v");
    one("missing", BASE, "Absent", NULL, NULL);
    one("recased", BASE, "gONE", NULL, NULL);
    one("open end", OPEN, "B", NULL, NULL);
    one("twice", TWICE, "D", NULL, NULL);
    readBack("twice", "D", "b");

    probeNote("a NULL value");
    one("entry", BASE, "Gone", "y", NULL);
    one("entry x", BASE, "Gone", "x", NULL);
    one("missing entry", BASE, "First", "k", NULL);
    one("missing section", BASE, "Absent", "k", NULL);
    one("open entry", OPEN, "B", "b", NULL);

    probeNote("empty strings");
    one("empty value", BASE, "First", "a", "");
    one("empty new value", BASE, "First", "k", "");
    one("empty entry", BASE, "First", "", "v");
    readBack("empty entry", "First", "");
    one("empty section", BASE, "", "k", "v");
    one("empty section null", BASE, "", NULL, NULL);
    one("empty entry null", BASE, "First", "", NULL);

    probeNote("WIN.INI");
    pump();
    changes = 0;
    before = windowsIni(&holds);
    answer = (int)WriteProfileString("ProbeNul", NULL, NULL);
    after = windowsIni(&holds);
    pump();
    wsprintf(probeResult, "%d", answer);
    probe("WriteProfileString", "\"ProbeNul\",NULL,NULL", probeResult);
    probe("WIN.INI", "missing,holds", holds ? "yes" : "no");
    probe("WIN.INI", "missing,length", before == after ? "same" : "changed");

    answer = (int)WriteProfileString("ProbeNul", "k", "v");
    after = windowsIni(&holds);
    wsprintf(probeResult, "%d", answer);
    probe("WriteProfileString", "\"ProbeNul\",\"k\",\"v\"", probeResult);
    probe("WIN.INI", "written,holds", holds ? "yes" : "no");

    answer = (int)WriteProfileString("ProbeNul", NULL, NULL);
    after = windowsIni(&holds);
    pump();
    wsprintf(probeResult, "%d", answer);
    probe("WriteProfileString", "\"ProbeNul\",NULL,NULL again", probeResult);
    probe("WIN.INI", "deleted,holds", holds ? "yes" : "no");
    wsprintf(probeResult, "%d", changes);
    probe("WM_WININICHANGE", "count", probeResult);

    DestroyWindow(hwnd);

    for (i = 1; i <= case_number; i++) {
        OFSTRUCT of;

        wsprintf(path, "C:\\ORACLE\\PN%d.INI", i);
        OpenFile(path, &of, OF_DELETE);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
