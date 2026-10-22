/*
 * KERNEL's modules found by number: `GetModuleHandle` given a handle in the
 * pointer's offset and nought in its segment, which KERNEL hands to
 * `GetExePtr` (`KRNL386.EXE` seg2 `07c6`, `082e`); `FreeModule`, the same
 * code as `FreeLibrary` (seg2 `0176`, `018a`); and both words of
 * `GetExpWinVer` (seg1 `4f02`-`4f27`), the high one the module's flag 2000h.
 *
 * * `bynumber`: what `GetModuleHandle` answers for a number, as the module's
 *   handle found by its name (`module`), nought (`zero`), else `other`. Asked
 *   of the probe's instance, USER's module and the instance
 *   `LoadLibrary` gives for `USER.EXE`, SHELL's instance, and `MAIN.CPL`'s
 *   instance and module. `bytask` the same, for the probe's task.
 * * `expwinver`: both words of `GetExpWinVer`, found by its ordinal, for the
 *   probe's instance, SHELL's, USER's, KERNEL's and `MAIN.CPL`'s.
 * * `usage`: `GetModuleUsage` of `MAIN.CPL` loaded twice, after `FreeModule`
 *   of its instance, and after `FreeModule` of its module; and whether its
 *   name finds it then (`found` or `gone`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MODNUM.OUT"

typedef DWORD(FAR PASCAL *EXPWINVERPROC)(HINSTANCE);
typedef BOOL(FAR PASCAL *FREEMODULEPROC)(HINSTANCE);

static void asked(LPCSTR function, LPCSTR what, UINT number, LPCSTR name)
{
    UINT named = (UINT)GetModuleHandle(name);
    UINT found = (UINT)GetModuleHandle((LPCSTR)MAKELP(0, number));

    lstrcpy(probeResult, found == named ? "module" : found == 0 ? "zero" : "other");
    probe(function, what, probeResult);
}

#define bynumber(what, number, name) asked("bynumber", what, number, name)

static void expwinver(EXPWINVERPROC expWinVer, LPCSTR what, HINSTANCE instance)
{
    DWORD answer = expWinVer(instance);

    wsprintf(probeResult, "%x %x", LOWORD(answer), HIWORD(answer));
    probe("expwinver", what, probeResult);
}

static void usage(LPCSTR what)
{
    HMODULE module = GetModuleHandle("MAINCPL");

    wsprintf(probeResult, "%d %s", module ? GetModuleUsage(module) : 0,
             (LPSTR)(module ? "found" : "gone"));
    probe("usage", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE user;
    HINSTANCE shell;
    HINSTANCE cpl;
    HINSTANCE again;
    UINT cplModule;
    EXPWINVERPROC expWinVer;
    FREEMODULEPROC freeModule;

    probeOpen(OUTPUT);

    user = LoadLibrary("USER.EXE");
    shell = LoadLibrary("SHELL.DLL");
    cpl = LoadLibrary("C:\\WINDOWS\\SYSTEM\\MAIN.CPL");
    cplModule = (UINT)GetModuleHandle("MAINCPL");

    bynumber("own instance", (UINT)instance, "MODNUM");
    asked("bytask", "own task", (UINT)GetCurrentTask(), "MODNUM");
    bynumber("user module", (UINT)GetModuleHandle("USER"), "USER");
    bynumber("user instance", (UINT)user, "USER");
    bynumber("shell instance", (UINT)shell, "SHELL");
    bynumber("cpl instance", (UINT)cpl, "MAINCPL");
    bynumber("cpl module", cplModule, "MAINCPL");

    expWinVer = (EXPWINVERPROC)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(167));
    expwinver(expWinVer, "own", instance);
    expwinver(expWinVer, "shell", shell);
    expwinver(expWinVer, "user", user);
    expwinver(expWinVer, "kernel", GetModuleHandle("KERNEL"));
    expwinver(expWinVer, "cpl", cpl);

    /* By its ordinal, 46: the import library knows it as `FreeModule`. */
    freeModule = (FREEMODULEPROC)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(46));
    again = LoadLibrary("C:\\WINDOWS\\SYSTEM\\MAIN.CPL");
    usage("loaded twice");
    freeModule(again);
    usage("freed by instance");
    freeModule((HINSTANCE)cplModule);
    usage("freed by module");

    FreeLibrary(shell);
    FreeLibrary(user);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
