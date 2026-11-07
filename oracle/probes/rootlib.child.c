/*
 * The program `rootlib.c` puts in the root of C:, C:\ROOTLIBC.EXE, and
 * starts from there with C:\ORACLE the current directory. It imports
 * ROOTLIBD.DLL (`rootlib.dll.c`), which is in the root alone, and writes a
 * line for each thing to C:\ORACLE\ROOTLIBC.TXT, the function and what it
 * found:
 *
 * * `self`: its own module's file;
 * * `import`: ROOTLIBD's module's file, where it was found from as this
 *   program was started;
 * * `library`: ROOTLIBL.DLL, loaded by `LoadLibrary` by its name alone, a
 *   file in the root alone: its module's file, or the error;
 * * `openfile`: ROOTLIB.DAT, opened by `OpenFile` with `OF_EXIST` by its
 *   name alone, a file in the root alone: the path found, or the error.
 */

#define IMPORTS_PROBE_LIBRARY

#include <windows.h>

int FAR PASCAL RootHere(void);

#define LOG "C:\\ORACLE\\ROOTLIBC.TXT"

static void note(LPCSTR function, LPCSTR result)
{
    char line[240];
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    wsprintf(line, "%s\t%s\r\n", function, result);
    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char path[160];
    HINSTANCE library;
    OFSTRUCT of;
    HFILE file;

    SetErrorMode(SEM_NOOPENFILEERRORBOX | SEM_FAILCRITICALERRORS);

    GetModuleFileName(instance, path, sizeof(path));
    note("self", path);

    RootHere();
    GetModuleFileName(GetModuleHandle("ROOTLIBD"), path, sizeof(path));
    note("import", path);

    library = LoadLibrary("ROOTLIBL.DLL");
    if ((UINT)library < 32) {
        wsprintf(path, "error=%u", (UINT)library);
    } else {
        GetModuleFileName(library, path, sizeof(path));
        FreeLibrary(library);
    }
    note("library", path);

    file = OpenFile("ROOTLIB.DAT", &of, OF_EXIST);
    if (file == HFILE_ERROR) {
        wsprintf(path, "error=%u", of.nErrCode);
    } else {
        lstrcpy(path, of.szPathName);
    }
    note("openfile", path);

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
