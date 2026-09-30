/*
 * The names `LoadLibrary` takes for a library already loaded: the module's
 * name bare, with a dot and nothing after it -- as the Visual Basic runtime
 * asks for "GDI." -- with its extension, and in small letters.
 *
 * * `load`: for each name, what `LoadLibrary` answered: `same` for the
 *   instance `LoadLibrary("GDI.EXE")` gave, the error for one below 32, or
 *   `other`; each loaded is freed again.
 * * `module`: `GetModuleHandle` of the same names, `same` for GDI's.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOADNAME.OUT"

static HINSTANCE gdi;
static HMODULE gdiModule;

static void load(LPCSTR name)
{
    HINSTANCE loaded = LoadLibrary(name);

    if ((UINT)loaded < 32) {
        wsprintf(probeResult, "error %u", (UINT)loaded);
    } else {
        lstrcpy(probeResult, loaded == gdi ? "same" : "other");
        FreeLibrary(loaded);
    }

    probe("load", name, probeResult);
}

static void module(LPCSTR name)
{
    HMODULE found = GetModuleHandle(name);

    probe("module", name, found == gdiModule ? "same" : found ? "other" : "none");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *names[] = {
        "GDI.", "GDI", "GDI.EXE", "gdi.", "gdi.exe", "USER.", "GDI.DLL", "C:\\WINDOWS\\SYSTEM\\GDI.EXE",
    };
    int i;

    probeOpen(OUTPUT);

    gdi = LoadLibrary("GDI.EXE");
    gdiModule = GetModuleHandle("GDI");

    for (i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        load(names[i]);
    }

    for (i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        module(names[i]);
    }

    FreeLibrary(gdi);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
