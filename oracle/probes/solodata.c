/*
 * A program with a single data segment -- linked `oneautodata`, as Media
 * Player is (its header's flags 0309h) -- handing `COMMDLG.DLL` a hook. A
 * library calls a hook with its own data segment in DS (`COMMDLG.DLL`
 * seg2 `42f4`), so a program's hook finds its own data only through what
 * KERNEL made of its prologue and of `MakeProcInstance`.
 *
 * * `flags`: the module's flags, from its header in memory, in hexadecimal.
 * * `prologue`: the first three bytes of the exported hook in memory, in
 *   hexadecimal, as KERNEL left them once it loaded the segment.
 * * `thunk`: `itself` where `MakeProcInstance` answered the procedure
 *   itself; else the opcodes of what it answered -- `mov ax` and a far
 *   `jmp` -- in hexadecimal, whether the `mov ax` names the program's data
 *   segment, and whether the jump is to the hook.
 * * `hook`: for `GetOpenFileName` with what `MakeProcInstance` answered:
 *   whether the hook, at `WM_INITDIALOG`, read the number the program set
 *   in its data, and whether DS and SS were the program's data segment.
 *   The hook reads through DS and writes only through the far pointer the
 *   dialog's data (`lCustData`) gives it, so a wrong DS would read
 *   another's data and change none.
 *
 * The flags in memory are 243h for the 201h linked: KERNEL marks any
 * module that is not a library as having multiple data (`KRNL386.EXE`
 * seg2 `17ee`), so the prologue is three `nop`s and the thunk names the
 * data segment, as for any program. (The procedure given to
 * `GetOpenFileName` itself, without the thunk, ran with `COMMDLG`'s data
 * segment and Windows never came back from it: it is not asked.)
 */

#define PROBE_SINGLE_DATA
#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>

#define OUTPUT "C:\\ORACLE\\SOLODATA.OUT"

#define MARK 1234

typedef BOOL(FAR PASCAL *OPENPROC)(OPENFILENAME FAR *);

/* What the hook saw. */
struct Seen {
    int called;
    int mark;
    WORD ds;
    WORD ss;
};

static int mark;

UINT FAR PASCAL _export Hook(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    WORD dsNow;
    WORD ssNow;
    int value;
    struct Seen FAR *seen;

    (void)wParam;

    if (message != WM_INITDIALOG) {
        return FALSE;
    }

    _asm {
        mov ax, ds
        mov dsNow, ax
        mov ax, ss
        mov ssNow, ax
        mov ax, word ptr mark
        mov value, ax
    }

    seen = (struct Seen FAR *)((OPENFILENAME FAR *)lParam)->lCustData;
    seen->called = 1;
    seen->mark = value;
    seen->ds = dsNow;
    seen->ss = ssNow;
    PostMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
    return TRUE;
}

static void ask(OPENPROC open, HINSTANCE instance, FARPROC hook, LPCSTR what, WORD ours)
{
    OPENFILENAME ofn;
    struct Seen seen;
    char file[260];

    seen.called = 0;
    seen.mark = 0;
    seen.ds = 0;
    seen.ss = 0;
    file[0] = '\0';
    _fmemset(&ofn, 0, sizeof(ofn));
    ofn.lStructSize = sizeof(ofn);
    ofn.hInstance = instance;
    ofn.lpstrFilter = "Text Files (*.TXT)\0*.txt\0";
    ofn.nFilterIndex = 1;
    ofn.lpstrFile = file;
    ofn.nMaxFile = sizeof(file);
    ofn.lpstrInitialDir = "C:\\WINDOWS";
    ofn.Flags = OFN_ENABLEHOOK | OFN_HIDEREADONLY;
    ofn.lCustData = (LPARAM)(struct Seen FAR *)&seen;
    ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))hook;

    open(&ofn);
    wsprintf(probeResult, "called=%d,mark=%d,ds=%d,ss=%d", seen.called,
             seen.mark == MARK ? 1 : 0, seen.ds == ours ? 1 : 0, seen.ss == ours ? 1 : 0);
    probe("hook", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    OPENPROC open;
    FARPROC thunk;
    BYTE FAR *bytes;
    WORD ours;
    HMODULE module;

    probeOpen(OUTPUT);
    mark = MARK;

    _asm {
        mov ax, ds
        mov ours, ax
    }

    module = GetModuleHandle("SOLODATA");
    wsprintf(probeResult, "%x", module ? *(WORD FAR *)MAKELP(module, 0x0c) : 0);
    probe("flags", "", probeResult);

    bytes = (BYTE FAR *)Hook;
    wsprintf(probeResult, "%02x %02x %02x", bytes[0], bytes[1], bytes[2]);
    probe("prologue", "Hook", probeResult);

    thunk = MakeProcInstance((FARPROC)Hook, instance);

    if (thunk == (FARPROC)Hook) {
        probe("thunk", "", "itself");
    } else {
        bytes = (BYTE FAR *)thunk;
        wsprintf(probeResult, "%02x %02x,ours=%d,hook=%d", bytes[0], bytes[3],
                 *(WORD FAR *)(bytes + 1) == ours ? 1 : 0,
                 *(FARPROC FAR *)(bytes + 4) == (FARPROC)Hook ? 1 : 0);
        probe("thunk", "", probeResult);
    }

    library = LoadLibrary("COMMDLG.DLL");
    open = library >= (HINSTANCE)32 ? (OPENPROC)GetProcAddress(library, "GetOpenFileName") : NULL;
    probe("entry", "GetOpenFileName", open ? "found" : "missing");

    if (open) {
        ask(open, instance, thunk, "thunk", ours);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
