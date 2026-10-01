/*
 * Where `WritePrivateProfileString` puts a file that is not there yet, as
 * FIBS/W writes its first settings to `FIBSW.INI`, a name with no path, and
 * reads them back to size its window.
 *
 * Each file is deleted before and after, in the Windows directory and in
 * `C:\ORACLE`.
 *
 * * `write`: the answer of writing `[S] k=440` to `PROFNEW.INI`, a name with
 *   no path, and to `C:\ORACLE\PROFNEW2.INI`, a full path to a file not
 *   there.
 * * `exists`: then, for each, whether `OpenFile(OF_EXIST)` finds the file in
 *   the Windows directory, and in `C:\ORACLE`.
 * * `read`: `GetPrivateProfileInt` of the entry with a default of 350,
 *   straight after the write, and after the files are flushed with
 *   `WritePrivateProfileString(NULL, NULL, NULL, ...)`.
 * * `text`: the file's bytes as written, read where `exists` found it, in
 *   hexadecimal.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PROFNEW.OUT"

static const char HEX[] = "0123456789abcdef";

static char windows[144];

static void inWindows(LPSTR out, LPCSTR name)
{
    lstrcpy(out, windows);

    if (out[lstrlen(out) - 1] != '\\') {
        lstrcat(out, "\\");
    }

    lstrcat(out, name);
}

static void removeBoth(LPCSTR name)
{
    OFSTRUCT of;
    char path[160];

    inWindows(path, name);
    OpenFile(path, &of, OF_DELETE);
    lstrcpy(path, "C:\\ORACLE\\");
    lstrcat(path, name);
    OpenFile(path, &of, OF_DELETE);
}

static BOOL there(LPCSTR path)
{
    OFSTRUCT of;

    return OpenFile(path, &of, OF_EXIST) != HFILE_ERROR;
}

static void dump(LPCSTR label, LPCSTR path)
{
    HFILE file = _lopen(path, OF_READ);
    BYTE bytes[60];
    UINT count;
    UINT at;

    if (file == HFILE_ERROR) {
        probe("text", label, "none");
        return;
    }

    count = _lread(file, bytes, sizeof(bytes));
    _lclose(file);

    if (count == (UINT)-1) {
        count = 0;
    }

    for (at = 0; at < count; at++) {
        probeResult[at * 2] = HEX[bytes[at] >> 4];
        probeResult[at * 2 + 1] = HEX[bytes[at] & 15];
    }

    probeResult[count * 2] = '\0';
    probe("text", label, probeResult);
}

static void run(LPCSTR label, LPCSTR name, LPCSTR given)
{
    char path[160];

    wsprintf(probeResult, "%d", (int)WritePrivateProfileString("S", "k", "440", given));
    probe("write", label, probeResult);

    inWindows(path, name);
    wsprintf(probeArgs, "%s,windows", label);
    probe("exists", probeArgs, there(path) ? "yes" : "no");

    if (there(path)) {
        wsprintf(probeArgs, "%s,windows", label);
        dump(probeArgs, path);
    }

    lstrcpy(path, "C:\\ORACLE\\");
    lstrcat(path, name);
    wsprintf(probeArgs, "%s,oracle", label);
    probe("exists", probeArgs, there(path) ? "yes" : "no");

    if (there(path)) {
        wsprintf(probeArgs, "%s,oracle", label);
        dump(probeArgs, path);
    }

    wsprintf(probeArgs, "%s,held", label);
    wsprintf(probeResult, "%d", GetPrivateProfileInt("S", "k", 350, given));
    probe("read", probeArgs, probeResult);

    WritePrivateProfileString(NULL, NULL, NULL, given);
    wsprintf(probeArgs, "%s,flushed", label);
    wsprintf(probeResult, "%d", GetPrivateProfileInt("S", "k", 350, given));
    probe("read", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    GetWindowsDirectory(windows, sizeof(windows));

    removeBoth("PROFNEW.INI");
    removeBoth("PROFNEW2.INI");

    run("bare", "PROFNEW.INI", "PROFNEW.INI");
    run("full", "PROFNEW2.INI", "C:\\ORACLE\\PROFNEW2.INI");

    removeBoth("PROFNEW.INI");
    removeBoth("PROFNEW2.INI");
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
