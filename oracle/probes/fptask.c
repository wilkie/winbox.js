/*
 * Whose the floating-point state is when two programs run together. The
 * probe sets its own control word, gathers an exception and leaves a value
 * on the stack; it starts FPTASKC.EXE (`fptask.child.c`), which sets its
 * own when it is sent a message, and each side reads what it then has.
 *
 * Recorded without a coprocessor (`record.mjs`'s `WITHOUT_COPROCESSOR`),
 * where each floating-point instruction is an interrupt WIN87EM's emulator
 * answers. WIN87EM keeps the emulator's state in its one data segment
 * (`WIN87EM.DLL` seg2), and `__FPMATH` 0, which each program's runtime
 * calls as it starts, resets it (seg1 `44`, `b3`). KERNEL's task switch
 * keeps a task's control word, in its database at 14h, only where SYSTEM's
 * `Get80x87SaveSize` answers a size (`KRNL386.EXE` seg1 `818b`, `8216`).
 *
 * Each view is `cw` the control word `FSTCW` stores, `sw` the status word
 * `FSTSW` stores, then `__FPMATH`'s answers: 5 the control word, 8 the
 * exceptions gathered, 10 the values on the stack.
 *
 * * `view`: the probe's at each point.
 * * `value`: the value the probe left on the stack, popped at the end where
 *   `__FPMATH` 10 counts one, times a thousand; or `none`.
 * * `child`: the other program's lines: its view as it starts, as it takes
 *   the first message, after it has set its own, and as it takes the second.
 */

#include "probe.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\FPTASK.OUT"
#define LOG "C:\\ORACLE\\FPTASK.TXT"
#define CHILD "C:\\WINDOWS\\FPTASKC.EXE"
#endif

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static char text[1200];
static FARPROC fpmathEntry;
static WORD fpWord;
static WORD fpStatus;
static WORD fpAnswer;
static double fpResult;

/* `__FPMATH` with BX the function: AX. */
static WORD fpmath(WORD function)
{
    _asm {
        push bx
        push cx
        push dx
        push si
        push di
        push es
        mov bx, function
        call dword ptr fpmathEntry
        mov fpAnswer, ax
        pop es
        pop di
        pop si
        pop dx
        pop cx
        pop bx
    }
    return fpAnswer;
}

static void view(LPCSTR when)
{
    _asm {
        fstcw fpWord
        fstsw fpStatus
    }
    wsprintf(probeResult, "cw %04x sw %04x fpmath5 %04x fpmath8 %04x fpmath10 %u", fpWord, fpStatus,
             fpmath(5), fpmath(8), fpmath(10));
    probe("view", when, probeResult);
}

/* Lets the others run for a while. */
static void settle(void)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < 500) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* Lets the others run until the other program's window is there. */
static HWND waitFor(void)
{
    DWORD start = GetTickCount();
    MSG msg;
    HWND found;

    for (;;) {
        found = FindWindow("FpTaskChild", NULL);

        if (found || GetTickCount() - start > 5000) {
            return found;
        }

        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT answer;
    HWND child;
    HFILE file;
    int length;

    probeOpen(OUTPUT);

    file = _lcreat(LOG, 0);
    _lclose(file);

    fpmathEntry = GetProcAddress(GetModuleHandle("WIN87EM"), "__FPMATH");
    probe("entry", "__FPMATH", (LPSTR)(fpmathEntry ? "there" : "missing"));

    view("at start");

    /* Its own: rounding down, every exception masked; 1 / 0, a division by
     * nought gathered, but where `QUIET` is defined; 7 left on the stack. */
    fpWord = 0x173f;
    _asm {
        fldcw fpWord
    }
#ifndef QUIET
    _asm {
        fldz
        fld1
        fdivrp st(1), st
        fstp fpResult
    }
#endif
    _asm {
        mov fpWord, 7
        fild fpWord
    }
    view("its own set");

    answer = WinExec(CHILD, SW_SHOWMINNOACTIVE);
    probe("exec", "child", (LPSTR)(answer > 32 ? "inst" : "error"));
    child = waitFor();
    probe("exec", "its window", (LPSTR)(child ? "there" : "missing"));

    view("after the child started");

    SendMessage(child, WM_USER, 1, 0L);
    view("after the child set its own");

    SendMessage(child, WM_USER, 2, 0L);
    view("after the child's second message");

    if (fpmath(10) > 0) {
        _asm {
            fstp fpResult
        }
        wsprintf(probeResult, "%ld", (long)(fpResult * 1000.0 + (fpResult < 0 ? -0.5 : 0.5)));
        probe("value", "left on the stack", probeResult);
    } else {
        probe("value", "left on the stack", "none");
    }

    SendMessage(child, WM_CLOSE, 0, 0L);
    settle();
    view("after the child ended");

    file = _lopen(LOG, OF_READ);
    length = file == HFILE_ERROR ? 0 : _lread(file, text, sizeof(text) - 1);
    if (file != HFILE_ERROR) {
        _lclose(file);
    }
    text[length < 0 ? 0 : length] = '\0';
    probe("child", "all", text);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
