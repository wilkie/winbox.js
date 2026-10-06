/*
 * The program `search.c` starts from C:\ORACLE\OWN, so that its own
 * directory is none of the others KERNEL looks in. It imports SEARCHD.DLL
 * (`search.dll.c`), and does one of four things, as its command line says:
 *
 * * `implicit`: writes where SEARCHD was found from, its module's file, to
 *   C:\ORACLE\SEARCHI.TXT, and ends.
 * * `winonly`: writes where it finds SEARCH4.DAT, a file in Windows'
 *   directory alone, to C:\ORACLE\SEARCHI.TXT, and ends.
 * * `target`: started by itself as SEARCHT.EXE, a copy with its module's
 *   name changed, writes its own file to C:\ORACLE\SEARCHT.TXT, and ends.
 * * `explicit`: finds SEARCHL.DLL by `LoadLibrary`, SEARCHT.EXE by
 *   `WinExec`, SEARCH.DAT by `OpenFile` and SEARCH2.DAT by `OpenFile` with
 *   `OF_SEARCH` and a directory not there, each again and again, deleting
 *   each copy found until none is left. A line for each to
 *   C:\ORACLE\SEARCHC.TXT, the function, the round and where: `cur`, `win`,
 *   `sys`, `own`, `path1`, `path2`, or the error.
 */

#define IMPORTS_PROBE_LIBRARY

#include <windows.h>
#include <direct.h>

int FAR PASCAL SearchHere(void);

#define LOG "C:\\ORACLE\\SEARCHC.TXT"

static LPCSTR places[] = {
    "C:\\ORACLE\\SC", "C:\\WINDOWS", "C:\\WINDOWS\\SYSTEM",
    "C:\\ORACLE\\OWN", "C:\\ORACLE\\SP", "C:\\ORACLE\\SQ",
};
static LPCSTR labels[] = { "cur", "win", "sys", "own", "path1", "path2" };

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

static void note(LPCSTR function, int round, LPCSTR result)
{
    char line[240];
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    wsprintf(line, "%s\t%d\t%s\r\n", function, round, result);
    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);
}

static void written(LPCSTR file, LPCSTR text)
{
    HFILE out = _lcreat(file, 0);

    _lwrite(out, text, lstrlen(text));
    _lclose(out);
}

static void gone(LPCSTR path)
{
    OFSTRUCT of;

    OpenFile(path, &of, OF_DELETE);
}

/* Lets the others run until a module is gone, or a while has passed. */
static void waitGone(LPCSTR module)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetModuleHandle(module) && GetTickCount() - start < 3000) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* A file's text, the first line of it. */
static void readText(LPCSTR file, LPSTR text, int size)
{
    HFILE in = _lopen(file, OF_READ);
    int got = 0;

    if (in != HFILE_ERROR) {
        got = _lread(in, text, size - 1);
        _lclose(in);
    }

    text[got < 0 ? 0 : got] = '\0';
}

static void explicit(void)
{
    char path[160];
    char result[200];
    HINSTANCE library;
    HINSTANCE again;
    UINT answer;
    OFSTRUCT of;
    HFILE file;
    int round;

    for (round = 1; round <= 8; round++) {
        library = LoadLibrary("SEARCHL.DLL");

        if ((UINT)library < 32) {
            wsprintf(result, "error=%u", (UINT)library);
            note("library", round, result);
            break;
        }

        GetModuleFileName(library, path, sizeof(path));
        note("library", round, label(path));

        /* Loaded, it is found by its module's name from another place. */
        if (round == 1) {
            again = LoadLibrary("C:\\ORACLE\\SQ\\SEARCHL.DLL");
            if ((UINT)again < 32) {
                wsprintf(result, "error=%u", (UINT)again);
            } else {
                GetModuleFileName(again, result, sizeof(result));
                lstrcpy(result, again == library ? "same" : label(result));
                FreeLibrary(again);
            }
            note("library", 0, result);
        }

        FreeLibrary(library);
        gone(path);
    }

    for (round = 1; round <= 8; round++) {
        gone("C:\\ORACLE\\SEARCHT.TXT");
        answer = WinExec("SEARCHT.EXE target", SW_SHOWMINNOACTIVE);

        if (answer < 32) {
            wsprintf(result, "error=%u", answer);
            note("program", round, result);
            break;
        }

        waitGone("SEARCHT");
        readText("C:\\ORACLE\\SEARCHT.TXT", path, sizeof(path));
        note("program", round, path[0] ? label(path) : "nothing");

        if (!path[0]) {
            break;
        }

        gone(path);
    }

    for (round = 1; round <= 8; round++) {
        file = OpenFile("SEARCH.DAT", &of, OF_EXIST);

        if (file == HFILE_ERROR) {
            wsprintf(result, "error=%u", of.nErrCode);
            note("openfile", round, result);
            break;
        }

        note("openfile", round, label(of.szPathName));
        lstrcpy(path, of.szPathName);
        gone(path);
    }

    /* A path of a directory that is there, without OF_SEARCH, and with it:
     * the directory named is looked in first, not the current one. */
    file = OpenFile("C:\\ORACLE\\SN\\SEARCH2.DAT", &of, OF_EXIST);
    if (file == HFILE_ERROR) {
        wsprintf(result, "error=%u", of.nErrCode);
    } else {
        lstrcpy(result, label(of.szPathName));
    }
    note("pathonly", 0, result);

    for (round = 1; round <= 8; round++) {
        file = OpenFile("C:\\ORACLE\\SQ\\SEARCH2.DAT", &of, OF_EXIST | OF_SEARCH);

        if (file == HFILE_ERROR) {
            wsprintf(result, "error=%u", of.nErrCode);
            note("ofsearch", round, result);
            break;
        }

        note("ofsearch", round, label(of.szPathName));
        lstrcpy(path, of.szPathName);
        gone(path);
    }

    /* A file in this program's own directory alone, from a current one of
     * the same length that differs from it in its last letter, then in its
     * first: KERNEL passes over a directory it takes for one it has looked
     * in already (seg1 `5637`). */
    written("C:\\ORACLE\\OWN\\SEARCH3.DAT", "x");
    chdir("C:\\ORACLE\\OWX");
    file = OpenFile("SEARCH3.DAT", &of, OF_EXIST);
    wsprintf(result, "error=%u", of.nErrCode);
    note("lastletter", 0, file == HFILE_ERROR ? result : label(of.szPathName));
    chdir("C:\\ORACLE\\XWN");
    file = OpenFile("SEARCH3.DAT", &of, OF_EXIST);
    wsprintf(result, "error=%u", of.nErrCode);
    note("firstletter", 0, file == HFILE_ERROR ? result : label(of.szPathName));
    chdir("C:\\ORACLE\\SC");
    gone("C:\\ORACLE\\OWN\\SEARCH3.DAT");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char path[160];
    OFSTRUCT of;
    HFILE file;

    SetErrorMode(SEM_NOOPENFILEERRORBOX | SEM_FAILCRITICALERRORS);

    if (lstrcmpi(command, "implicit") == 0) {
        path[0] = '\0';
        if (SearchHere()) {
            GetModuleFileName(GetModuleHandle("SEARCHD"), path, sizeof(path));
        }
        written("C:\\ORACLE\\SEARCHI.TXT", path);
    } else if (lstrcmpi(command, "winonly") == 0) {
        file = OpenFile("SEARCH4.DAT", &of, OF_EXIST);
        wsprintf(path, "error=%u", of.nErrCode);
        written("C:\\ORACLE\\SEARCHI.TXT", file == HFILE_ERROR ? path : label(of.szPathName));
    } else if (lstrcmpi(command, "target") == 0) {
        GetModuleFileName(instance, path, sizeof(path));
        written("C:\\ORACLE\\SEARCHT.TXT", path);
    } else if (lstrcmpi(command, "explicit") == 0) {
        explicit();
    }

    (void)previous;
    (void)show;
    return 0;
}
