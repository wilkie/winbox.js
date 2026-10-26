/*
 * The system driver, SYSTEM.DRV, called by its ordinals as KERNEL and USER
 * call it:
 *
 * * `inquire`: InquireSystem for a code and a drive, DX:AX in hexadecimal.
 * * `msec`: whether GetSystemMSecCount agrees with GetTickCount, taken
 *   together.
 * * `x87`: Get80x87SaveSize; what Save80x87State writes after FNINIT, FLD1
 *   and FLDPI -- the control, status and tag words, and ST(0) and ST(1) as
 *   their ten bytes each; and the two values Restore80x87State puts back,
 *   stored as doubles.
 * * `timer`: CreateSystemTimer's handles, whether the procedure is called
 *   with its handle in AX, and KillSystemTimer's answers; how many can be
 *   made at once.
 * * `misc`: A20_Proc and WEP.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYSDRV.OUT"

typedef DWORD(FAR PASCAL *INQUIREPROC)(WORD, WORD);
typedef WORD(FAR PASCAL *CREATEPROC)(WORD, FARPROC);
typedef WORD(FAR PASCAL *KILLPROC)(WORD);
typedef DWORD(FAR PASCAL *MSECPROC)(void);
typedef WORD(FAR PASCAL *SIZEPROC)(void);
typedef void(FAR PASCAL *STATEPROC)(LPVOID);
typedef WORD(FAR PASCAL *WORDPROC)(WORD);

static HMODULE driver;
static BYTE FAR *data;
static FARPROC code;
static BYTE state[200];
static double first;
static double second;

static FARPROC entry(int ordinal)
{
    return GetProcAddress(driver, MAKEINTRESOURCE(ordinal));
}

/* The timer's procedure: keeps AX at [0] and counts its calls at [2]. */
static void build(WORD selector)
{
    static const BYTE body[] = {
        0x1e,                   /* push ds         */
        0x50,                   /* push ax         */
        0xb8, 0, 0,             /* mov ax, <data>  */
        0x8e, 0xd8,             /* mov ds, ax      */
        0x58,                   /* pop ax          */
        0xa3, 0x00, 0x00,       /* mov [0], ax     */
        0xff, 0x06, 0x02, 0x00, /* inc word [2]    */
        0x1f,                   /* pop ds          */
        0xcb                    /* retf            */
    };
    int i;

    for (i = 0; i < sizeof(body); i++) {
        data[0x40 + i] = body[i];
    }

    data[0x40 + 3] = LOBYTE(selector);
    data[0x40 + 4] = HIBYTE(selector);
}

static WORD word(int at)
{
    return *(WORD FAR *)(data + at);
}

/* Lets the timer run until it has been called `calls` times, or two seconds. */
static void await(WORD calls)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (word(2) < calls && GetTickCount() - start < 2000) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        }
    }
}

static void inquire(WORD code, WORD drive)
{
    DWORD answer = ((INQUIREPROC)entry(1))(code, drive);

    wsprintf(probeArgs, "%u,%u", code, drive);
    wsprintf(probeResult, "%08lx", answer);
    probe("inquire", probeArgs, probeResult);
}

static void hexOf(LPSTR out, BYTE *bytes, int count)
{
    int i;

    for (i = 0; i < count; i++) {
        wsprintf(out + i * 2, "%02x", bytes[i]);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block;
    WORD selector;
    WORD alias;
    WORD handles[12];
    WORD handle;
    DWORD a, b, c;
    int i;
    int count;

    probeOpen(OUTPUT);
    driver = GetModuleHandle("SYSTEM");
    wsprintf(probeResult, "%s", (LPSTR)(driver ? "found" : "none"));
    probe("module", "SYSTEM", probeResult);

    inquire(0, 0);
    inquire(0, 7);
    inquire(1, 0);
    inquire(1, 1);
    inquire(1, 2);
    inquire(1, 3);
    inquire(1, 25);
    inquire(2, 0);
    inquire(2, 1);
    inquire(3, 0);
    inquire(100, 0);

    a = GetTickCount();
    b = ((MSECPROC)entry(6))();
    c = GetTickCount();
    wsprintf(probeResult, "%s", (LPSTR)(a <= b && b <= c ? "yes" : "no"));
    probe("msec", "between GetTickCounts", probeResult);

    wsprintf(probeResult, "%u", ((SIZEPROC)entry(7))());
    probe("x87", "Get80x87SaveSize", probeResult);

    _asm {
        fninit
        fld1
        fldpi
    }
    ((STATEPROC)entry(8))((LPVOID)state);
    hexOf(probeResult, state, 6);
    probe("x87", "Save80x87State words", probeResult);
    hexOf(probeResult, state + 14, 20);
    probe("x87", "Save80x87State st0 st1", probeResult);
    _asm {
        fninit
    }
    ((STATEPROC)entry(9))((LPVOID)state);
    _asm {
        fstp qword ptr first
        fstp qword ptr second
    }
    wsprintf(probeResult, "%ld,%ld", (long)(first * 100000.0), (long)(second * 100000.0));
    probe("x87", "Restore80x87State", probeResult);
    _asm {
        fninit
    }

    wsprintf(probeResult, "%u", ((WORDPROC)entry(20))(0));
    probe("misc", "A20_Proc 0", probeResult);
    wsprintf(probeResult, "%u", ((WORDPROC)entry(20))(1));
    probe("misc", "A20_Proc 1", probeResult);
    wsprintf(probeResult, "%u", ((WORDPROC)entry(10))(0));
    probe("misc", "WEP", probeResult);

    block = GlobalAlloc(GMEM_FIXED | GMEM_ZEROINIT, 256);
    data = (BYTE FAR *)GlobalLock(block);
    selector = HIWORD((DWORD)data);
    alias = AllocDStoCSAlias(selector);
    code = (FARPROC)MAKELONG(0x40, alias);
    build(selector);

    handle = ((CREATEPROC)entry(2))(110, code);
    wsprintf(probeResult, "%04x", handle);
    probe("timer", "CreateSystemTimer 110", probeResult);
    await(3);
    wsprintf(probeResult, "%s,%s", (LPSTR)(word(2) >= 3 ? "called" : "not"),
             (LPSTR)(word(0) == handle ? "ax=handle" : "ax=other"));
    probe("timer", "called", probeResult);
    wsprintf(probeResult, "%04x", ((KILLPROC)entry(3))(handle));
    probe("timer", "KillSystemTimer", probeResult);
    wsprintf(probeResult, "%04x", ((KILLPROC)entry(3))(handle));
    probe("timer", "KillSystemTimer again", probeResult);
    wsprintf(probeResult, "%04x", ((KILLPROC)entry(3))(0x1234));
    probe("timer", "KillSystemTimer 1234", probeResult);
    wsprintf(probeResult, "%04x", ((KILLPROC)entry(3))(0));
    probe("timer", "KillSystemTimer 0", probeResult);

    *(WORD FAR *)(data + 2) = 0;
    handle = ((CREATEPROC)entry(2))(0, code);
    wsprintf(probeResult, "%04x", handle);
    probe("timer", "CreateSystemTimer 0", probeResult);
    await(3);
    wsprintf(probeResult, "%s", (LPSTR)(word(2) >= 3 ? "called" : "not"));
    probe("timer", "called 0", probeResult);
    wsprintf(probeResult, "%04x", ((KILLPROC)entry(3))(handle));
    probe("timer", "KillSystemTimer 0 rate", probeResult);

    count = 0;

    for (i = 0; i < 12; i++) {
        handles[i] = ((CREATEPROC)entry(2))(60000, code);

        if (!handles[i]) {
            break;
        }

        count++;
    }

    probeResult[0] = '\0';

    for (i = 0; i < count; i++) {
        wsprintf(probeResult + lstrlen(probeResult), "%04x,", handles[i]);
    }

    wsprintf(probeResult + lstrlen(probeResult), "then %04x", i < 12 ? handles[i] : 0xffff);
    probe("timer", "all", probeResult);

    for (i = count - 1; i >= 0; i--) {
        ((KILLPROC)entry(3))(handles[i]);
    }

    handle = ((CREATEPROC)entry(2))(60000, code);
    wsprintf(probeResult, "%04x", handle);
    probe("timer", "after all", probeResult);
    ((KILLPROC)entry(3))(handle);

    FreeSelector(alias);
    GlobalUnlock(block);
    GlobalFree(block);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
