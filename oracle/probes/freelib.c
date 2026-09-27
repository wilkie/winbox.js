/*
 * `LoadLibrary`, `FreeLibrary` and `GetModuleUsage`, on Control Panel's own
 * `MAIN.CPL`, which it loads, asks and frees: how a library's count goes,
 * when it goes away, and what becomes of the libraries it brought.
 *
 * * `load`: whether the library came (`ok` or the error), whether a second
 *   load gave the same handle, and its count after each.
 * * `free`: after each `FreeLibrary`, whether `GetModuleHandle` still finds
 *   it by its module name, `MAINCPL`, and if so its count.
 * * `named`: whether `GetModuleHandle` finds it, loaded, by its module name,
 *   by its file's name without the extension, and with it: `found`, `other`
 *   for another module, or `not`.
 * * `brought`: whether `COMMDLG`, which `MAIN.CPL` imports and the probe does
 *   not, is loaded, and its count: before, after the load, after the free.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FREELIB.OUT"

static void loaded(LPCSTR what, LPCSTR module)
{
    HMODULE handle;

    handle = GetModuleHandle(module);

    if (handle) {
        wsprintf(probeResult, "loaded,%d", GetModuleUsage(handle));
    } else {
        lstrcpy(probeResult, "gone");
    }

    probe(what[0] == 'b' ? "brought" : "free", what, probeResult);
}

/* Whether a name finds a module, and whether it is the library's: the same file. */
static void named(LPCSTR name, HINSTANCE library)
{
    HMODULE handle;
    char found[128];
    char wanted[128];

    handle = GetModuleHandle(name);

    if (!handle) {
        probe("named", name, "not");
        return;
    }

    GetModuleFileName(handle, found, sizeof(found));
    GetModuleFileName(library, wanted, sizeof(wanted));
    probe("named", name, (LPSTR)(lstrcmpi(found, wanted) == 0 ? "found" : "other"));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE first;
    HINSTANCE second;

    probeOpen(OUTPUT);

    loaded("brought-before", "COMMDLG");

    first = LoadLibrary("MAIN.CPL");

    if ((UINT)first < 32) {
        wsprintf(probeResult, "%u", (UINT)first);
        probe("load", "first", probeResult);
        probeFinish();
        return 0;
    }

    wsprintf(probeResult, "ok,%d", GetModuleUsage(first));
    probe("load", "first", probeResult);
    loaded("brought-loaded", "COMMDLG");
    named("MAINCPL", first);
    named("MAIN", first);
    named("MAIN.CPL", first);

    second = LoadLibrary("MAIN.CPL");
    wsprintf(probeResult, "%s,%d", (LPSTR)(second == first ? "same" : "other"), GetModuleUsage(first));
    probe("load", "second", probeResult);

    FreeLibrary(second);
    loaded("free-once", "MAINCPL");
    FreeLibrary(first);
    loaded("free-twice", "MAINCPL");
    loaded("brought-freed", "COMMDLG");

    first = LoadLibrary("MAIN.CPL");
    wsprintf(probeResult, "%s,%d", (LPSTR)((UINT)first >= 32 ? "ok" : "failed"),
             (UINT)first >= 32 ? GetModuleUsage(first) : 0);
    probe("load", "again", probeResult);
    FreeLibrary(first);
    loaded("free-again", "MAINCPL");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
