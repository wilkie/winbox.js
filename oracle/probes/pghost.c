/*
 * Where Windows' own code faults on a program's pointer to a page that is
 * not present (`kb/guides/paging.md`, "WinBox's own code"). A 0501h block
 * of four pages has page 1 written and is freed: its first page, page 0,
 * is then not present in 386 enhanced mode (`pgfree`). A selector of the
 * probe's own based at the block points at it, and each call below is
 * given that pointer under an exception 0Eh handler of the probe's own
 * (0203h). The handler notes the error code and CS:IP and sends the
 * program on to a `Throw` back to the call's `Catch`.
 *
 * A record: "no fault" and the call's answer's low word (a selector is
 * the host's own), or the handler's calls and the error code, then a
 * record of the group's `at` (`kernel at`) of where CS:IP was: the export
 * of KERNEL or USER whose
 * entry is in the same segment and nearest below IP, by its ordinal, and
 * IP's distance from it (`KERNEL!#353+0024`); `probe` for the probe's own
 * code, `other` for a segment none of them is in. Selectors are the
 * host's own, so only the segment's export and the distance are recorded.
 *
 * Recorded in each mode (`record.mjs --mode enhanced`); in standard mode
 * nothing faults.
 *
 * * `setup`: 0501h, 0502h, and a read of pages 0 and 1 through the
 *   selector (`pgreach.h`'s handler): whether each faults.
 * * `kernel`: lstrlen, lstrcpy to and from it, lstrcat, lstrcpyn,
 *   hmemcpy to and from it, _lread into it, _lwrite from it,
 *   GetModuleFileName and GetProfileString into it.
 * * `user`: wsprintf into it, lstrcmp, AnsiUpper, AnsiLower,
 *   GetWindowText and GetClassName into it, SetWindowText from it.
 * * `box`: `PGHOSTC.EXE` (`pghost.child.c`), with no handler of its own,
 *   calls lstrlen with a pointer to its own freed block's first page:
 *   whether its window is there after, whether it runs, and its calls
 *   and lstrlen's answer. In enhanced mode no box shows: KERNEL's fault
 *   handler finds the place in KERNEL's `__GP` table and lstrlen answers
 *   nought.
 *
 * DPMI's own copies are not called here. A first version called 0500h
 * with ES:DI the pointer after the `user` group: in 386 enhanced mode
 * Windows wrote no record after it, and DOSBox was stopped after 300
 * seconds.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\PGHOST.OUT"

static WORD hostCalls, hostCode, hostIP, hostCS;
static CATCHBUF hostCatch;
static FARPROC recoverAt;

/* Where the handler sends the program on: back to the call's `Catch`. DS
 * is the program's own, the handler set it. */
static void __far hostRecover(void)
{
    Throw(hostCatch, 1);
}

/* The handler: the error code and CS:IP noted, DS made the faulting
 * stack's (the program's own: KERNEL and USER run on the caller's stack),
 * and CS:IP made `hostRecover`. */
static void __declspec(naked) __far hostHandler(void)
{
    _asm {
        push bp
        mov bp, sp
        push ax
        mov ax, [bp+10h]
        mov ds, ax
        inc word ptr hostCalls
        mov ax, [bp+6]
        mov hostCode, ax
        mov ax, [bp+8]
        mov hostIP, ax
        mov ax, [bp+0Ah]
        mov hostCS, ax
        mov ax, word ptr recoverAt
        mov [bp+8], ax
        mov ax, word ptr recoverAt+2
        mov [bp+0Ah], ax
        pop ax
        pop bp
        retf
    }
}

/* `place` made the export nearest below CS:IP in its segment, by its
 * ordinal: every ordinal up to 700 asked of. */
static void nearest(char *place, WORD *best, LPCSTR module)
{
    HMODULE handle = GetModuleHandle(module);
    UINT ordinal;

    for (ordinal = 1; ordinal <= 700; ordinal++) {
        DWORD at = (DWORD)GetProcAddress(handle, MAKEINTRESOURCE(ordinal));

        if (at && HIWORD(at) == hostCS && LOWORD(at) <= hostIP &&
            (*best == 0xFFFF || hostIP - LOWORD(at) < *best)) {
            *best = hostIP - LOWORD(at);
            wsprintf(place, "%s!#%u", module, ordinal);
        }
    }
}

static void say(LPCSTR group, LPCSTR name, UINT faulted, DWORD answer)
{
    char place[64];
    WORD best = 0xFFFF;

    if (!faulted) {
        wsprintf(probeResult, "no fault answer=%04x", LOWORD(answer));
        probe(group, name, probeResult);
        return;
    }

    lstrcpy(place, "other");
    nearest(place, &best, "KERNEL");
    nearest(place, &best, "USER");
    if (best == 0xFFFF && hostCS == ourCS()) {
        lstrcpy(place, "probe");
    }
    wsprintf(probeResult, "fault calls=%u code=%04x", hostCalls, hostCode);
    probe(group, name, probeResult);
    if (best == 0xFFFF) {
        lstrcpy(probeResult, place);
    } else {
        wsprintf(probeResult, "%s+%04x", (LPSTR)place, best);
    }
    wsprintf(probeArgs, "%s at", group);
    probe(probeArgs, name, probeResult);
}

static UINT put(FARPROC handler)
{
    set(0x0203, 0x0E, HIWORD((DWORD)handler), LOWORD((DWORD)handler), 0, 0);
    dpmi();
    return !rCarry;
}

/* One call, under `Catch`. */
#define TRY(group, name, expr)                                                                     \
    do {                                                                                           \
        hostCalls = 0;                                                                             \
        put((FARPROC)hostHandler);                                                                 \
        if (Catch(hostCatch) == 0) {                                                               \
            DWORD answer = (DWORD)(expr);                                                          \
            put((FARPROC)handler0E);                                                               \
            say(group, name, 0, answer);                                                           \
        } else {                                                                                   \
            put((FARPROC)handler0E);                                                               \
            say(group, name, 1, 0);                                                                \
        }                                                                                          \
    } while (0)

static char buffer[64] = "abcdefghijklmnop";

static DWORD setText(HWND window, LPSTR text)
{
    SetWindowText(window, text);
    return 0;
}

static DWORD copyHuge(LPSTR to, LPSTR from)
{
    hmemcpy(to, from, 16);
    return 0;
}

/* Lets the other tasks run until the program's window is gone, or `span`
 * has passed. */
static void settleUntilGone(DWORD span)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < span && FindWindow("PgHostChild", NULL)) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* `PGHOSTC.EXE` told to call lstrlen with a pointer to its own freed
 * block's first page, with no handler of its own: whether it goes on, and
 * its answer, or that KERNEL ended it. */
static void box(void)
{
    UINT answer = WinExec("PGHOSTC.EXE", SW_SHOWNORMAL);
    HINSTANCE started = (HINSTANCE)answer;
    HWND program;
    DWORD state;

    probe("box", "exec", (LPSTR)(answer > 32 ? "inst" : "error"));
    program = FindWindow("PgHostChild", NULL);
    if (!program) {
        probe("box", "window", "none");
        return;
    }

    PostMessage(program, WM_USER, 0, 0L);
    probe("box", "posted", "lstrlen");
    settleUntilGone(20000);

    program = FindWindow("PgHostChild", NULL);
    probe("box", "window", (LPSTR)(program ? "there" : "gone"));
    probe("box", "usage", (LPSTR)(GetModuleUsage(started) ? "running" : "ended"));
    if (program) {
        state = SendMessage(program, WM_USER + 1, 0, 0L);
        wsprintf(probeResult, "calls=%u answer=%04x", LOWORD(state), HIWORD(state));
        probe("box", "after", probeResult);
        PostMessage(program, WM_CLOSE, 0, 0L);
        settleUntilGone(5000);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    LPSTR bad;
    DWORD base;
    HFILE file;
    HWND window;

    probeOpen(OUTPUT);
    recoverAt = (FARPROC)hostRecover;

    if (!reachOpen(REACH_0E)) {
        probe("setup", "0000h", "refused");
        probeFinish();
        return 0;
    }

    /* --- setup: a freed block's first page --- */
    set(0x0501, 0, 0x4000, 0, 0, 0);
    dpmi();
    report("setup", "0501h 4 pages");
    if (rCarry) {
        reachClose();
        probeFinish();
        return 0;
    }
    base = ((DWORD)rBX << 16) | rCX;
    {
        UINT si = rSI, di = rDI;

        reachValue = 0x41;
        reach(base + 0x1000, (FARPROC)writeByte);
        set(0x0502, 0, 0, 0, si, di);
        dpmi();
        report("setup", "0502h");
    }
    reachSay(reach(base, (FARPROC)readByte), (FARPROC)readByte);
    probe("setup", "page 0", probeResult);
    reachSay(reach(base + 0x1000, (FARPROC)readByte), (FARPROC)readByte);
    probe("setup", "page 1", probeResult);
    based(base);
    bad = (LPSTR)MAKELP(probeSel, 0);

    /* --- kernel --- */
    TRY("kernel", "lstrlen", lstrlen(bad));
    TRY("kernel", "lstrcpy to", lstrcpy(bad, "abc"));
    TRY("kernel", "lstrcpy from", lstrcpy(buffer, bad));
    TRY("kernel", "lstrcat", lstrcat(bad, "x"));
    TRY("kernel", "lstrcpyn", lstrcpyn(bad, "abc", 4));
    TRY("kernel", "hmemcpy to", copyHuge(bad, buffer));
    TRY("kernel", "hmemcpy from", copyHuge(buffer, bad));
    file = _lopen("C:\\WINDOWS\\WIN.INI", OF_READ);
    TRY("kernel", "_lread", _lread(file, bad, 16));
    _lclose(file);
    file = _lcreat("C:\\ORACLE\\PGHOST.TMP", 0);
    TRY("kernel", "_lwrite", _lwrite(file, bad, 16));
    _lclose(file);
    TRY("kernel", "GetModuleFileName", GetModuleFileName(instance, bad, 4));
    TRY("kernel", "GetProfileString", GetProfileString("windows", "nonesuch", "abc", bad, 16));

    /* --- user --- */
    window = CreateWindow("STATIC", "Hello", WS_POPUP, 0, 0, 10, 10, NULL, NULL, instance, NULL);
    TRY("user", "wsprintf", wsprintf(bad, "abc"));
    TRY("user", "lstrcmp", lstrcmp(bad, "abc"));
    TRY("user", "AnsiUpper", AnsiUpper(bad));
    TRY("user", "AnsiLower", AnsiLower(bad));
    TRY("user", "GetWindowText", GetWindowText(window, bad, 16));
    TRY("user", "GetClassName", GetClassName(window, bad, 16));
    TRY("user", "SetWindowText", setText(window, bad));
    DestroyWindow(window);

    reachClose();

    /* --- box: a program with no handler of its own --- */
    box();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
