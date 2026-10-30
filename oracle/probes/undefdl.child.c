/*
 * The program `undefdl.c` starts: UNDEFDLC.EXE, which imports what is not
 * there (`undefdl.child.lnk`) -- KERNEL's ordinal 142, which KERNEL does
 * not export, and a name it does not export, `NOSUCHPROC`; from its own
 * library UNDEFDLD.DLL ordinal 99 and the name `ABSENT`, which it does not
 * export, and `PRESENT`, which it does. Its records are added to the
 * probe's file.
 *
 * * `present`: what UNDEFDLD's `Present` answers, through its import.
 * * `bound`: where each missing import was bound: KERNEL's ordinal 120,
 *   `UndefDynlink`, as GetProcAddress gives it (`undefdynlink`), or
 *   `other`; and `PRESENT`'s.
 * * `getprocaddress`: GetProcAddress of the same four, by ordinal and by
 *   name: nought, or `nonzero`.
 * * `call`: written before the program calls KERNEL's ordinal 142 through
 *   its import. Windows ends it there (the recorder presses Enter at its
 *   box, `record.mjs --shoot call --then Return`); `returned` is written
 *   only if the call comes back.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\UNDEFDL.OUT"

int FAR PASCAL PRESENT(void);
void FAR PASCAL UNDEFORDINAL(void);
void FAR PASCAL UNDEFNAME(void);
void FAR PASCAL ABSENTORDINAL(void);
void FAR PASCAL ABSENTNAME(void);

static FARPROC undefDynlink;

static void bound(LPCSTR name, FARPROC address)
{
    if (address == undefDynlink) {
        probe("bound", name, "undefdynlink");
    } else {
        probe("bound", name, "other");
    }
}

static void looked(LPCSTR name, FARPROC address)
{
    if (address) {
        probe("getprocaddress", name, "nonzero");
    } else {
        probe("getprocaddress", name, "0");
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE kernel = GetModuleHandle("KERNEL");
    HMODULE library = GetModuleHandle("UNDEFDLD");

    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0L, 2);
    lstrcpy(probePath, OUTPUT);

    undefDynlink = GetProcAddress(kernel, MAKEINTRESOURCE(120));
    probe("undefdynlink", "getprocaddress 120", (LPSTR)(undefDynlink ? "nonzero" : "0"));

    wsprintf(probeResult, "%d", PRESENT());
    probe("present", "UNDEFDLD.PRESENT", probeResult);

    bound("KERNEL.142", (FARPROC)UNDEFORDINAL);
    bound("KERNEL.NOSUCHPROC", (FARPROC)UNDEFNAME);
    bound("UNDEFDLD.99", (FARPROC)ABSENTORDINAL);
    bound("UNDEFDLD.ABSENT", (FARPROC)ABSENTNAME);
    bound("UNDEFDLD.PRESENT", (FARPROC)PRESENT);

    looked("KERNEL.142", GetProcAddress(kernel, MAKEINTRESOURCE(142)));
    looked("KERNEL.NOSUCHPROC", GetProcAddress(kernel, "NOSUCHPROC"));
    looked("UNDEFDLD.99", GetProcAddress(library, MAKEINTRESOURCE(99)));
    looked("UNDEFDLD.ABSENT", GetProcAddress(library, "ABSENT"));
    looked("UNDEFDLD.PRESENT", GetProcAddress(library, "PRESENT"));

    probe("call", "KERNEL.142", "now");
    UNDEFORDINAL();
    probe("call", "KERNEL.142", "returned");

    _lclose(probeHandle);

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
