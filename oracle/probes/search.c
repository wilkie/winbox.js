/*
 * Where KERNEL looks for a file named without a directory: a library a
 * program imports, one `LoadLibrary` loads, a program `WinExec` starts, and
 * a file `OpenFile` opens. A copy is put in each place it might look, and
 * the copy found is deleted, and so on until none is left:
 *
 * * `cur`, C:\ORACLE\SC, the current directory;
 * * `win`, C:\WINDOWS, and `sys`, C:\WINDOWS\SYSTEM;
 * * `own`, C:\ORACLE\OWN, the directory of the program that looks,
 *   SEARCHC.EXE (`search.child.c`), started from there;
 * * `path1` and `path2`, C:\ORACLE\SP and C:\ORACLE\SQ, on PATH, which this
 *   probe sets in its own environment before it starts the other program.
 *
 * `OpenFile` looks in the current directory, Windows', the system
 * directory, the directory of the task's module, then PATH's from the
 * task's environment (`KRNL386.EXE` seg1 `5390`, the list at data `0aed`,
 * the PATH at seg1 `588e`); `LoadModule` opens a program or a library
 * through it (seg2 `1747`).
 *
 * * `winonly`: where SEARCHC.EXE finds a file only in Windows' directory,
 *   before PATH is set and after; `windir`: `GetWindowsDirectory`, the
 *   same two times (see `setPath` for why).
 * * `env`: PATH, as the environment holds it once set.
 * * `placed`: the places each file was copied to.
 * * `import`: where SEARCHD.DLL is found from as SEARCHC.EXE is started,
 *   each round, or WinExec's error once none is left; then with the
 *   library only in SEARCHC.EXE's directory, and only in Windows'.
 * * `exec`: WinExec's answer for SEARCHC.EXE doing the rest.
 * * `library`, `program`, `openfile`, `pathonly`, `ofsearch`,
 *   `lastletter`, `firstletter`: what SEARCHC.EXE found, each round (see
 *   `search.child.c`).
 */

#define PROBE_FLUSH
#include "probe.h"
#include <direct.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\SEARCH.OUT"
#define PATH_VALUE "C:\\ORACLE\\SP;C:\\ORACLE\\SQ"

static LPCSTR places[] = {
    "C:\\ORACLE\\SC", "C:\\WINDOWS", "C:\\WINDOWS\\SYSTEM",
    "C:\\ORACLE\\OWN", "C:\\ORACLE\\SP", "C:\\ORACLE\\SQ",
};
static LPCSTR labels[] = { "cur", "win", "sys", "own", "path1", "path2" };
static LPCSTR made[] = {
    "C:\\ORACLE\\SC", "C:\\ORACLE\\OWN", "C:\\ORACLE\\SP", "C:\\ORACLE\\SQ", "C:\\ORACLE\\SS",
    "C:\\ORACLE\\OWX", "C:\\ORACLE\\XWN",
};
static LPCSTR names[] = {
    "SEARCHD.DLL", "SEARCHL.DLL", "SEARCHT.EXE", "SEARCH.DAT", "SEARCH2.DAT",
};

static char buffer[1024];
static char text[2400];
static char where[160];

/* Which of the places a file is in, or its path if none. */
static LPCSTR label(LPCSTR path)
{
    int slash = -1;
    int at;
    int i;

    lstrcpy(where, path);

    for (at = 0; where[at]; at++) {
        if (where[at] == '\\') {
            slash = at;
        }
    }

    if (slash < 0) {
        return path;
    }

    where[slash] = '\0';

    for (i = 0; i < 6; i++) {
        if (lstrcmpi(where, places[i]) == 0) {
            return labels[i];
        }
    }

    lstrcpy(where, path);
    return where;
}

static void gone(LPCSTR path)
{
    OFSTRUCT of;

    OpenFile(path, &of, OF_DELETE);
}

/*
 * A file copied, a kilobyte at a time; with `last` not nought, the last
 * letter of its module's name, the first in its resident-name table,
 * changed to it, so that the copy is another module.
 */
static void copyAs(LPCSTR from, LPCSTR to, char last)
{
    HFILE in = _lopen(from, OF_READ);
    HFILE out = _lcreat(to, 0);
    long at = 0;
    long letter = -1;
    WORD header;
    WORD table;
    BYTE length;
    UINT got;

    if (in == HFILE_ERROR || out == HFILE_ERROR) {
        _lclose(in);
        _lclose(out);
        return;
    }

    if (last) {
        _llseek(in, 0x3cL, 0);
        _lread(in, &header, 2);
        _llseek(in, (long)header + 0x26, 0);
        _lread(in, &table, 2);
        _llseek(in, (long)header + table, 0);
        _lread(in, &length, 1);
        letter = (long)header + table + length;
        _llseek(in, 0L, 0);
    }

    while ((got = _lread(in, buffer, sizeof(buffer))) > 0 && got != (UINT)HFILE_ERROR) {
        if (letter >= at && letter < at + (long)got) {
            buffer[(int)(letter - at)] = last;
        }

        _lwrite(out, buffer, got);
        at += got;
    }

    _lclose(in);
    _lclose(out);
}

/* A copy of a stashed file in each place; recorded, those there after. */
static void everywhere(LPCSTR name)
{
    char from[80];
    char to[80];
    char there[60];
    HFILE file;
    int i;

    wsprintf(from, "C:\\ORACLE\\SS\\%s", name);
    there[0] = '\0';

    for (i = 0; i < 6; i++) {
        wsprintf(to, "%s\\%s", places[i], name);
        copyAs(from, to, 0);

        file = _lopen(to, OF_READ);
        if (file != HFILE_ERROR) {
            _lclose(file);
            if (there[0]) {
                lstrcat(there, " ");
            }
            lstrcat(there, labels[i]);
        }
    }

    probe("placed", name, there);
}

/*
 * PATH set in this task's own environment, where `GetDOSEnvironment` finds
 * it. This block is the one KERNEL was given, and KERNEL keeps Windows'
 * directory as a pointer to `windir`'s value in it (`KRNL386.EXE` seg1
 * `ab63`): moved or written over, `GetWindowsDirectory` answers what is
 * there instead and the Windows directory drops out of every search. So
 * the variables before `windir` are made PATH, and the room left over a
 * variable of nothing but `Z`s, `windir` and what follows it untouched.
 * Under DOSBox there is room, PATH, COMSPEC and BLASTER coming before
 * `windir`; where there is not, the block is made again of PATH, `windir`
 * and what followed the variables.
 */
static void setPath(void)
{
    LPSTR environment = GetDOSEnvironment();
    LPSTR at = environment;
    LPSTR windir = NULL;
    LPSTR rest;
    int before = 0;
    int length;
    int i;

    while (*at) {
        if (_fstrncmp(at, "windir=", 7) == 0) {
            windir = at;
            before = (int)(at - environment);
        }
        at += lstrlen(at) + 1;
    }

    lstrcpy(text, "PATH=" PATH_VALUE);
    i = lstrlen(text) + 1;

    if (windir && before >= i + 3) {
        text[i++] = 'Z';
        text[i++] = '=';
        while (i < before - 1) {
            text[i++] = 'Z';
        }
        text[i++] = '\0';
        _fmemcpy(environment, text, i);
        return;
    }

    /* The count and the path, after the nought that ends the variables. */
    rest = at + 1;
    length = 2 + lstrlen(rest + 2) + 1;

    if (windir) {
        lstrcpy(text + i, windir);
        i += lstrlen(windir) + 1;
    }

    text[i++] = '\0';
    _fmemcpy(text + i, rest, length);
    i += length;
    _fmemcpy(environment, text, i);
}

/* PATH's value, as the environment holds it. */
static LPSTR pathOf(void)
{
    LPSTR at = GetDOSEnvironment();

    while (*at) {
        if (_fstrncmp(at, "PATH=", 5) == 0) {
            return at + 5;
        }
        at += lstrlen(at) + 1;
    }

    return "none";
}

/* Lets the others run until a module is gone, or a while has passed. */
static void waitGone(LPCSTR module, DWORD wait)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetModuleHandle(module) && GetTickCount() - start < wait) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* A file's text. */
static int readText(LPCSTR file, LPSTR into, int size)
{
    HFILE in = _lopen(file, OF_READ);
    int got = 0;

    if (in != HFILE_ERROR) {
        got = _lread(in, into, size - 1);
        _lclose(in);
    }

    if (got < 0) {
        got = 0;
    }

    into[got] = '\0';
    return got;
}

/* The other program's lines, each a record: function, round, where. */
static void recordLines(void)
{
    LPSTR line = text;
    LPSTR at;
    LPSTR fields[3];
    int field;

    readText("C:\\ORACLE\\SEARCHC.TXT", text, sizeof(text));

    while (*line) {
        field = 0;
        fields[0] = line;
        fields[1] = fields[2] = "";

        for (at = line; *at && *at != '\r' && *at != '\n'; at++) {
            if (*at == '\t' && field < 2) {
                *at = '\0';
                fields[++field] = at + 1;
            }
        }

        while (*at == '\r' || *at == '\n') {
            *at++ = '\0';
        }

        probe(fields[0], fields[1], fields[2]);
        line = at;
    }
}

/* The other program started to do a thing, and what it wrote recorded. */
static void started(LPCSTR mode, LPCSTR args)
{
    char line[60];
    char path[160];
    UINT answer;

    gone("C:\\ORACLE\\SEARCHI.TXT");
    wsprintf(line, "C:\\ORACLE\\OWN\\SEARCHC.EXE %s", mode);
    answer = WinExec(line, SW_SHOWMINNOACTIVE);

    if (answer < 32) {
        wsprintf(probeResult, "error=%u", answer);
    } else {
        waitGone("SEARCHC", 3000);
        readText("C:\\ORACLE\\SEARCHI.TXT", path, sizeof(path));
        lstrcpy(probeResult, path[0] ? path : "nothing");
    }

    probe(mode, args, probeResult);
}

/* The other program started with its library in one place alone. */
static void implicitFrom(LPCSTR place, LPCSTR args)
{
    char path[160];
    UINT answer;

    copyAs("C:\\ORACLE\\SS\\SEARCHD.DLL", place, 0);
    gone("C:\\ORACLE\\SEARCHI.TXT");
    answer = WinExec("C:\\ORACLE\\OWN\\SEARCHC.EXE implicit", SW_SHOWMINNOACTIVE);

    if (answer < 32) {
        wsprintf(probeResult, "error=%u", answer);
    } else {
        waitGone("SEARCHC", 3000);
        readText("C:\\ORACLE\\SEARCHI.TXT", path, sizeof(path));
        lstrcpy(probeResult, path[0] ? label(path) : "nothing");
    }

    probe("import", args, probeResult);
    gone(place);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char path[160];
    char args[8];
    UINT answer;
    int round;
    int i;
    int j;

    probeOpen(OUTPUT);
    SetErrorMode(SEM_NOOPENFILEERRORBOX | SEM_FAILCRITICALERRORS);

    for (i = 0; i < 7; i++) {
        mkdir(made[i]);
    }

    /* The library and the program as built, and copies of each made other
     * modules; and a file of data. */
    copyAs("C:\\WINDOWS\\SEARCHD.DLL", "C:\\ORACLE\\SS\\SEARCHD.DLL", 0);
    copyAs("C:\\WINDOWS\\SEARCHD.DLL", "C:\\ORACLE\\SS\\SEARCHL.DLL", 'L');
    copyAs("C:\\WINDOWS\\SEARCHC.EXE", "C:\\ORACLE\\OWN\\SEARCHC.EXE", 0);
    copyAs("C:\\WINDOWS\\SEARCHC.EXE", "C:\\ORACLE\\SS\\SEARCHT.EXE", 'T');
    gone("C:\\WINDOWS\\SEARCHC.EXE");
    copyAs("C:\\WINDOWS\\WIN.INI", "C:\\ORACLE\\SS\\SEARCH.DAT", 0);
    copyAs("C:\\WINDOWS\\WIN.INI", "C:\\ORACLE\\SS\\SEARCH2.DAT", 0);

    chdir("C:\\ORACLE\\SC");

    /* A file in Windows' directory alone, found by the other program
     * before PATH is set and after; and Windows' directory as KERNEL gives
     * it, before and after. */
    copyAs("C:\\ORACLE\\SS\\SEARCHD.DLL", "C:\\ORACLE\\OWN\\SEARCHD.DLL", 0);
    copyAs("C:\\WINDOWS\\WIN.INI", "C:\\WINDOWS\\SEARCH4.DAT", 0);
    started("winonly", "before PATH");
    GetWindowsDirectory(path, sizeof(path));
    probe("windir", "before PATH", path);

    setPath();
    probe("env", "PATH", pathOf());

    GetWindowsDirectory(path, sizeof(path));
    probe("windir", "after PATH", path);
    started("winonly", "after PATH");
    gone("C:\\WINDOWS\\SEARCH4.DAT");
    gone("C:\\ORACLE\\OWN\\SEARCHD.DLL");

    /* The library the other program imports, found as it is started. */
    everywhere("SEARCHD.DLL");

    for (round = 1; round <= 8; round++) {
        wsprintf(args, "%d", round);
        gone("C:\\ORACLE\\SEARCHI.TXT");
        answer = WinExec("C:\\ORACLE\\OWN\\SEARCHC.EXE implicit", SW_SHOWMINNOACTIVE);

        if (answer < 32) {
            wsprintf(probeResult, "error=%u", answer);
            probe("import", args, probeResult);
            break;
        }

        waitGone("SEARCHC", 3000);
        readText("C:\\ORACLE\\SEARCHI.TXT", path, sizeof(path));
        probe("import", args, path[0] ? label(path) : "nothing");

        if (!path[0]) {
            break;
        }

        gone(path);
    }

    /* The library in one place alone: the other program's own directory,
     * then Windows'. */
    implicitFrom("C:\\ORACLE\\OWN\\SEARCHD.DLL", "own only");
    implicitFrom("C:\\WINDOWS\\SEARCHD.DLL", "win only");

    /* The rest, which the other program finds itself, run from its own
     * directory with its library in the system directory. */
    copyAs("C:\\ORACLE\\SS\\SEARCHD.DLL", "C:\\WINDOWS\\SYSTEM\\SEARCHD.DLL", 0);
    everywhere("SEARCHL.DLL");
    everywhere("SEARCHT.EXE");
    everywhere("SEARCH.DAT");
    everywhere("SEARCH2.DAT");
    gone("C:\\ORACLE\\SEARCHC.TXT");

    answer = WinExec("C:\\ORACLE\\OWN\\SEARCHC.EXE explicit", SW_SHOWMINNOACTIVE);
    if (answer < 32) {
        wsprintf(probeResult, "error=%u", answer);
    } else {
        lstrcpy(probeResult, "inst");
    }
    probe("exec", "explicit", probeResult);
    waitGone("SEARCHC", 60000);
    recordLines();

    chdir("C:\\ORACLE");

    for (i = 0; i < 6; i++) {
        for (j = 0; j < 5; j++) {
            wsprintf(path, "%s\\%s", places[i], (LPSTR)names[j]);
            gone(path);
        }
    }

    for (j = 0; j < 5; j++) {
        wsprintf(path, "C:\\ORACLE\\SS\\%s", (LPSTR)names[j]);
        gone(path);
    }

    gone("C:\\ORACLE\\OWN\\SEARCHC.EXE");
    gone("C:\\ORACLE\\SEARCHI.TXT");
    gone("C:\\ORACLE\\SEARCHT.TXT");
    gone("C:\\ORACLE\\SEARCHC.TXT");

    for (i = 0; i < 7; i++) {
        rmdir(made[i]);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
