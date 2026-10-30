/*
 * KERNEL's internal calls WinBox answers as Windows does, each reached by
 * its ordinal through GetProcAddress and called with AX 1234h and DX 5678h:
 * AX and DX after, and `left`, the bytes of arguments the call left on the
 * stack (nought where it pops what was pushed).
 *
 * * `noop`: WriteOutProfiles (315; AX `kernel-data` where it is the
 *   selector of GetLPErrMode's pointer, KERNEL's data), FlushCachedFileHandle
 *   (319) of nought and of the probe's module, DiagOutput (340) of a line,
 *   BUNNY_351, ValidateFreeSpaces (200), ReplaceInst (201) of three noughts,
 *   A20Proc (165) of 1 (EMSCopy is `emscopy`'s), SwapRecording (204) of 0, 2,
 *   3 and 1234h, and RegisterPtrace (202) of ValidateFreeSpaces' address and
 *   of nought (AX `given` where it is the selector given).
 * * `gp`: HasGPHandler (338) of an address in the probe's code, of the
 *   probe's data at nought, and of nought.
 * * `winoldap`: RegisterWinOldApHook (343) and GetWinOldApHooks (344) with
 *   two records of the probe's, A and B: the head first; A added, its link
 *   and the head; B added, its link and the head; A taken (flag nought), B's
 *   link and the head; A taken again; B taken with a flag of 100h, whose low
 *   byte is nought; B taken; the head last. Records and heads are named `A`,
 *   `B` or `0`, else their number.
 * * `inittask1`: InitTask1 (141) of a procedure of the probe's, then a
 *   second instance of the probe started (WinExec, it ends at once) and
 *   KINTRNLC.EXE, whose header has flag 08h (`kintrnl.child.c`), each
 *   waited for: how many times the procedure was called after each, whether
 *   ES was a task (IsTask) and not the probe's; InitTask1 of nought.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KINTRNL.OUT"

typedef DWORD(FAR PASCAL *DwordOfVoid)(void);

static HMODULE kernel;

static FARPROC entry(UINT ordinal)
{
    return GetProcAddress(kernel, MAKEINTRESOURCE(ordinal));
}

static UINT ourDS(void)
{
    UINT value;

    _asm mov value, ds
    return value;
}

/* A call with its argument words pushed in order, AX 1234h and DX 5678h. */
static FARPROC target;
static WORD argv[8];
static WORD argc;
static WORD rax, rdx, spBefore, spAfter;

static void callRaw(void)
{
    _asm {
        push si
        push di
        push es
        push bx
        push cx
        mov spBefore, sp
        mov cx, argc
        lea si, argv
    next:
        jcxz ready
        push word ptr [si]
        add si, 2
        dec cx
        jmp next
    ready:
        mov ax, 1234h
        mov dx, 5678h
        call dword ptr target
        mov rax, ax
        mov rdx, dx
        mov spAfter, sp
        mov sp, spBefore
        pop cx
        pop bx
        pop es
        pop di
        pop si
    }
}

static void call0(UINT ordinal)
{
    target = entry(ordinal);
    argc = 0;
    callRaw();
}

static void call1(UINT ordinal, WORD a)
{
    target = entry(ordinal);
    argv[0] = a;
    argc = 1;
    callRaw();
}

/* A far pointer: its selector pushed first. */
static void callFar(UINT ordinal, DWORD pointer)
{
    target = entry(ordinal);
    argv[0] = HIWORD(pointer);
    argv[1] = LOWORD(pointer);
    argc = 2;
    callRaw();
}

static void say(LPCSTR section, LPCSTR name, WORD expected, LPCSTR expectedName)
{
    char ax[16];

    if (expectedName && rax == expected) {
        lstrcpy(ax, expectedName);
    } else {
        wsprintf(ax, "%x", rax);
    }

    wsprintf(probeResult, "ax=%s,dx=%x,left=%u", (LPSTR)ax, rdx, spBefore - spAfter);
    probe(section, name, probeResult);
}

static void noops(void)
{
    WORD kernelData = HIWORD(((DwordOfVoid)entry(99))());
    DWORD retf = (DWORD)entry(200);
    char line[] = "kintrnl\r\n";

    call0(315);
    say("noop", "WriteOutProfiles", kernelData, "kernel-data");

    call1(319, 0);
    say("noop", "FlushCachedFileHandle 0", 0, NULL);
    call1(319, (WORD)GetModuleHandle("KINTRNL"));
    say("noop", "FlushCachedFileHandle module", 0, NULL);

    callFar(340, (DWORD)(LPSTR)line);
    say("noop", "DiagOutput", 0, NULL);

    call0(351);
    say("noop", "BUNNY_351", 0, NULL);

    call0(200);
    say("noop", "ValidateFreeSpaces", 0, NULL);

    target = entry(201);
    argv[0] = argv[1] = argv[2] = 0;
    argc = 3;
    callRaw();
    say("noop", "ReplaceInst", 0, NULL);

    call1(165, 1);
    say("noop", "A20Proc", 0, NULL);

    call1(204, 0);
    say("noop", "SwapRecording 0", 0, NULL);
    call1(204, 2);
    say("noop", "SwapRecording 2", 0, NULL);
    call1(204, 3);
    say("noop", "SwapRecording 3", 0, NULL);
    call1(204, 0x1234);
    say("noop", "SwapRecording 1234", 0, NULL);

    /* A procedure that is a lone RETF in Windows, for as long as it is set. */
    callFar(202, retf);
    say("noop", "RegisterPtrace", HIWORD(retf), "given");
    callFar(202, 0);
    say("noop", "RegisterPtrace 0", 0, NULL);
}

static void here(void)
{
}

static void gp(void)
{
    callFar(338, (DWORD)(FARPROC)here);
    say("gp", "code", 0, NULL);
    callFar(338, MAKELONG(0, ourDS()));
    say("gp", "data", 0, NULL);
    callFar(338, 0);
    say("gp", "null", 0, NULL);
}

static BYTE recordA[8];
static BYTE recordB[8];

static LPCSTR nameOf(DWORD pointer, char *buffer)
{
    if (pointer == 0) {
        return "0";
    }

    if (pointer == (DWORD)(LPVOID)recordA) {
        return "A";
    }

    if (pointer == (DWORD)(LPVOID)recordB) {
        return "B";
    }

    wsprintf(buffer, "%lx", pointer);
    return buffer;
}

static void head(LPCSTR name)
{
    char buffer[16];
    DWORD value = ((DwordOfVoid)entry(344))();

    probe("winoldap", name, nameOf(value, buffer));
}

static void link(LPCSTR name, BYTE *record)
{
    char buffer[16];

    probe("winoldap", name, nameOf(*(DWORD *)record, buffer));
}

static void hook(LPCSTR name, BYTE *record, WORD flag)
{
    DWORD pointer = (DWORD)(LPVOID)record;

    target = entry(343);
    argv[0] = HIWORD(pointer);
    argv[1] = LOWORD(pointer);
    argv[2] = flag;
    argc = 3;
    callRaw();
    say("winoldap", name, 0, NULL);
}

static void winoldap(void)
{
    /* Each record's procedure, after its link: the probe's `here`. */
    *(DWORD *)recordA = 0xeeeeeeeeL;
    *(DWORD *)(recordA + 4) = (DWORD)(FARPROC)here;
    *(DWORD *)recordB = 0xeeeeeeeeL;
    *(DWORD *)(recordB + 4) = (DWORD)(FARPROC)here;

    head("head before");
    hook("add A", recordA, 1);
    link("A's link", recordA);
    head("head after A");
    hook("add B", recordB, 1);
    link("B's link", recordB);
    head("head after B");
    hook("take A", recordA, 0);
    link("B's link after", recordB);
    head("head after taking A");
    hook("take A again", recordA, 0);
    hook("take B with 100h", recordB, 0x100);
    head("head after 100h");
    hook("take B", recordB, 0);
    head("head last");
}

static WORD calls;
static WORD seenES;
static WORD seenTask;

void FAR PASCAL _export Started(void)
{
    WORD value;

    _asm mov value, es
    calls++;
    seenES = value;
    seenTask = IsTask((HTASK)value);
}

static void wait(UINT answer)
{
    DWORD start = GetTickCount();
    MSG msg;

    if (answer <= 32) {
        return;
    }

    while (GetTickCount() - start < 10000 && GetModuleUsage((HINSTANCE)answer)) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

static void inittask1(HINSTANCE self)
{
    FARPROC proc = MakeProcInstance((FARPROC)Started, self);
    UINT answer;

    callFar(141, (DWORD)proc);
    say("inittask1", "set", HIWORD((DWORD)proc), "given");

    answer = WinExec("KINTRNL.EXE quit", SW_SHOWNORMAL);
    wait(answer);
    wsprintf(probeResult, "exec=%s,calls=%u", (LPSTR)(answer > 32 ? "inst" : "error"), calls);
    probe("inittask1", "second instance", probeResult);

    answer = WinExec("KINTRNLC.EXE", SW_SHOWNORMAL);
    wait(answer);
    wsprintf(probeResult, "exec=%s,calls=%u,istask=%s,own=%s",
             (LPSTR)(answer > 32 ? "inst" : "error"), calls, (LPSTR)(seenTask ? "yes" : "no"),
             (LPSTR)(seenES == (WORD)GetCurrentTask() ? "yes" : "no"));
    probe("inittask1", "flag 08h", probeResult);

    callFar(141, 0);
    say("inittask1", "nought", 0, NULL);

    FreeProcInstance(proc);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    if (command && command[0] == 'q') {
        return 0;
    }

    probeOpen(OUTPUT);
    kernel = GetModuleHandle("KERNEL");

    noops();
    gp();
    winoldap();
    inittask1(instance);

    probeFinish();

    (void)previous;
    (void)show;
    return 0;
}
