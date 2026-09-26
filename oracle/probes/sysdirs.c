/*
 * The Windows and system directories, and loading a library by name.
 *
 * * `dir`: what `GetWindowsDirectory` and `GetSystemDirectory` answer, and
 *   copy, into a buffer of each size: the answer, then the buffer.
 * * `load`: what `LoadLibrary` answers for libraries found each way and for
 *   one not there -- a handle as `ok`, or the error number -- and whether
 *   loading one again gives the same handle. With `SEM_NOOPENFILEERRORBOX`,
 *   so that a library not found is not asked for in a box.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYSDIRS.OUT"

static void dir(LPCSTR name, UINT (FAR PASCAL *get)(LPSTR, UINT), UINT size)
{
    char buffer[260];
    UINT answer;

    lstrcpy(buffer, "untouched");
    answer = get(buffer, size);
    wsprintf(probeArgs, "%s,%u", name, size);
    wsprintf(probeResult, "%u,%s", answer, (LPSTR)buffer);
    probe("dir", probeArgs, probeResult);
}

static void load(LPCSTR name, LPCSTR file)
{
    HINSTANCE first = LoadLibrary(file);
    HINSTANCE second;

    if ((UINT)first < 32) {
        wsprintf(probeResult, "error=%u", (UINT)first);
    } else {
        second = LoadLibrary(file);
        wsprintf(probeResult, "ok,again=%s", (LPSTR)(second == first ? "same" : "different"));
        FreeLibrary(second);
        FreeLibrary(first);
    }

    probe("load", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    dir("windows", GetWindowsDirectory, 260);
    dir("windows", GetWindowsDirectory, 5);
    dir("windows", GetWindowsDirectory, 1);
    dir("windows", GetWindowsDirectory, 0);
    dir("system", GetSystemDirectory, 260);
    dir("system", GetSystemDirectory, 5);
    dir("system", GetSystemDirectory, 1);
    dir("system", GetSystemDirectory, 0);

    /* A library not found would otherwise put up Windows' own box asking
     * for it, and wait. */
    SetErrorMode(SEM_NOOPENFILEERRORBOX | SEM_FAILCRITICALERRORS);

    load("system-name", "MAIN.CPL");
    load("system-path", "C:\\WINDOWS\\SYSTEM\\MAIN.CPL");
    load("windows-dll", "COMMDLG.DLL");
    load("no-extension", "COMMDLG");
    load("missing", "NOSUCH.DLL");
    load("missing-path", "C:\\NOWHERE\\NOSUCH.DLL");
    load("not-a-library", "C:\\WINDOWS\\WIN.INI");

    probeFinish();

    return 0;
}
