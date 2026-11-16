/*
 * A program whose import names a library that is nowhere: what `WinExec`,
 * `LoadModule` and `LoadLibrary` answer for it. A Visual Basic setup
 * kit's bootstrap starts the `SETUP1.EXE` it has expanded, which imports
 * `VBRUN300`, and says "Could not execute: C:\WINDOWS\SETUP1.exe 2" where
 * the runtime is not installed (the compatibility catalog's
 * `win3_ANDTILES`, `win3_bogle10`).
 *
 * EXECLIBC.EXE (`execlib.child.c`) imports `MISSING` from the module
 * `NOLIBQI` (`execlib.child.lnk`), which no file is. Opening files is
 * asked to put up no box (`SetErrorMode(SEM_NOOPENFILEERRORBOX)`).
 *
 * * `winexec`, `loadmodule`, `loadlibrary`: the answer for EXECLIBC.EXE,
 *   `inst` for an instance.
 * * `nolib`: `LoadLibrary("NOLIBQI.DLL")`'s answer, the library alone.
 * * `module`: whether a module EXECLIBC is loaded after (`GetModuleHandle`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EXECLIB.OUT"

static void answered(LPCSTR function, LPCSTR argument, UINT answer)
{
    if (answer > 32) {
        probe(function, argument, "inst");
    } else {
        wsprintf(probeResult, "%u", answer);
        probe(function, argument, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    struct {
        WORD environment;
        LPSTR command;
        LPVOID show;
        LPVOID reserved;
    } block;
    WORD showing[2] = { 2, SW_SHOWNORMAL };
    char tail[2] = { 0, 0 };

    probeOpen(OUTPUT);
    SetErrorMode(SEM_NOOPENFILEERRORBOX);

    answered("winexec", "EXECLIBC.EXE", WinExec("EXECLIBC.EXE", SW_SHOWNORMAL));

    block.environment = 0;
    block.command = tail;
    block.show = showing;
    block.reserved = NULL;
    answered("loadmodule", "EXECLIBC.EXE", (UINT)LoadModule("EXECLIBC.EXE", &block));
    answered("loadlibrary", "EXECLIBC.EXE", (UINT)LoadLibrary("EXECLIBC.EXE"));
    answered("nolib", "NOLIBQI.DLL", (UINT)LoadLibrary("NOLIBQI.DLL"));
    probe("module", "EXECLIBC", (LPSTR)(GetModuleHandle("EXECLIBC") ? "loaded" : "none"));
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
