/*
 * KERNEL's own files asked for as libraries. InstallShield's `~TMPnnnn`
 * setups ask `GetWinFlags` for the mode and load `KRNL286.EXE` in
 * standard mode for three of KERNEL's procedures by `GetProcAddress` (the
 * compatibility catalog's `TRAINS_WIN`, `LAUGHS_WIN`). On a 386 Windows
 * runs KRNL386.EXE in both modes; both files are in the system directory.
 *
 * * `file`: `GetModuleFileName` of KERNEL.
 * * `load`: `LoadLibrary`'s answer for each file: `kernel` where its
 *   module is KERNEL, else `other`, or the error's number.
 * * `module`: the answer's module's file, as `GetModuleFileName` gives it.
 *   The answer is let go again (`FreeLibrary`).
 *
 * Then copies, under names of their own in C:\ORACLE, of KRNL386.EXE
 * (`KCOPY.EXE`) and of a library loaded already, VER.DLL (`VERCOPY.DLL`,
 * its module VER), each loaded as a library: `copy` is the answer,
 * `same` where it is the loaded module's instance (KERNEL's, VER's),
 * `other` for another, or the error's number.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KRNLFILE.OUT"

static HMODULE kernel;
static char path[144];

static void loaded(LPCSTR file)
{
    HINSTANCE answer = LoadLibrary(file);
    HMODULE module;

    if ((UINT)answer < 32) {
        wsprintf(probeResult, "%u", (UINT)answer);
        probe("load", file, probeResult);
        return;
    }

    module = GetModuleHandle((LPCSTR)MAKELONG(answer, 0));
    probe("load", file, (LPSTR)(module == kernel ? "kernel" : "other"));
    path[0] = 0;
    GetModuleFileName(module, path, sizeof path);
    probe("module", file, path);
    FreeLibrary(answer);
}

static char buffer[4096];

/* A file copied, whole. */
static BOOL copied(LPCSTR from, LPCSTR to)
{
    HFILE in = _lopen(from, OF_READ);
    HFILE out;
    UINT got;

    if (in == HFILE_ERROR) {
        return FALSE;
    }

    out = _lcreat(to, 0);

    if (out == HFILE_ERROR) {
        _lclose(in);
        return FALSE;
    }

    while ((got = _lread(in, buffer, sizeof buffer)) != 0 && got != (UINT)HFILE_ERROR) {
        _lwrite(out, buffer, got);
    }

    _lclose(in);
    _lclose(out);
    return TRUE;
}

static void copy(LPCSTR from, LPCSTR to, HINSTANCE loaded)
{
    HINSTANCE answer;

    if (!copied(from, to)) {
        probe("copy", to, "not copied");
        return;
    }

    answer = LoadLibrary(to);

    if ((UINT)answer < 32) {
        wsprintf(probeResult, "%u", (UINT)answer);
    } else {
        lstrcpy(probeResult, GetModuleHandle((LPCSTR)MAKELONG(answer, 0)) ==
                                     GetModuleHandle((LPCSTR)MAKELONG(loaded, 0))
                                 ? "same"
                                 : "other");
        FreeLibrary(answer);
    }

    probe("copy", to, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    kernel = GetModuleHandle("KERNEL");
    GetModuleFileName(kernel, path, sizeof path);
    probe("file", "KERNEL", path);
    loaded("KRNL386.EXE");
    loaded("KRNL286.EXE");
    loaded("C:\\WINDOWS\\SYSTEM\\KRNL286.EXE");

    {
        HINSTANCE ver = LoadLibrary("VER.DLL");

        copy("C:\\WINDOWS\\SYSTEM\\KRNL386.EXE", "C:\\ORACLE\\KCOPY.EXE", (HINSTANCE)kernel);
        copy("C:\\WINDOWS\\SYSTEM\\VER.DLL", "C:\\ORACLE\\VERCOPY.DLL", ver);
        FreeLibrary(ver);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
