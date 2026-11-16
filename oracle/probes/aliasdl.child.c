/*
 * The program `aliasdl.c` puts in the root of C:, C:\ALIASDLC.EXE. It
 * imports ALIASDLD (`aliasdl.dll.c`), whose file C:\ALIASDLD.DLL holds the
 * module ALIASDLX, and writes a line for each thing to
 * C:\ORACLE\ALIASDLC.TXT, the function and what it found:
 *
 * * `call`: what the import answers, in hex (1234 is the library's);
 * * `handle`: `GetModuleHandle` of ALIASDLD, the name imported, and of
 *   ALIASDLX, the module's: `0` or `found`;
 * * `file`: the module ALIASDLX's file;
 * * `usage`: its count, as the program started, and after
 *   `LoadLibrary("ALIASDLD.DLL")`;
 * * `loadlib`: whether that `LoadLibrary`'s module is ALIASDLX (`same`).
 */

#define IMPORTS_PROBE_LIBRARY

#include <windows.h>

int FAR PASCAL AliasHere(void);

#define LOG "C:\\ORACLE\\ALIASDLC.TXT"

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
    char text[160];
    HMODULE module;
    HINSTANCE library;

    SetErrorMode(SEM_NOOPENFILEERRORBOX | SEM_FAILCRITICALERRORS);

    wsprintf(text, "%x", AliasHere());
    note("call", text);

    note("handle ALIASDLD", GetModuleHandle("ALIASDLD") ? "found" : "0");
    module = GetModuleHandle("ALIASDLX");
    note("handle ALIASDLX", module ? "found" : "0");

    text[0] = '\0';
    if (module) {
        GetModuleFileName(module, text, sizeof(text));
    }
    note("file", text);

    wsprintf(text, "%d", module ? GetModuleUsage(module) : -1);
    note("usage", text);

    library = LoadLibrary("ALIASDLD.DLL");
    if ((UINT)library < 32) {
        wsprintf(text, "error=%u", (UINT)library);
    } else {
        lstrcpy(text, GetModuleHandle((LPCSTR)MAKELP(0, library)) == module ? "same" : "other");
    }
    note("loadlib", text);

    wsprintf(text, "%d", module ? GetModuleUsage(module) : -1);
    note("usage after", text);

    if ((UINT)library >= 32) {
        FreeLibrary(library);
    }

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
