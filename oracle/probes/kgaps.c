/*
 * The last of KERNEL's internal exports a program can reach, each found by
 * its ordinal through GetProcAddress and called with known registers: what
 * it answers in each register, `left`, the bytes of arguments the call left
 * on the stack (nought where it pops what was pushed), and what it changed.
 * Values that name something the probe knows are named: `kernel-data`
 * (KERNEL's data selector, the selector of GetLPErrMode's pointer), `ours`
 * (the probe's DS), `task`, `head` (GetCurrentTask's AX and DX), `given`.
 *
 * * `master`: GlobalMasterHandle (28): AX, DX and how they relate.
 * * `thhook`: the address GetProcAddress gives for THHOOK (332), and the
 *   words there that the probe can name: the global heap's block (218h,
 *   21Ah), the first module (21Ch), the first prefix (222h), the first and
 *   the running task (226h, 228h), the task being made (22Ah).
 * * `sig`: SetSigHandler (140) of signal 2; of signal 1 with action 2,
 *   twice; DoSignal (139) with the probe's window focused and with none;
 *   action 0, then 2 again; action 4 twice; action 2 with no pointer for
 *   the old handler (SI the probe's DS, DI 5A5Ah going in); the first
 *   action and handler put back.
 * * `dosignalds`: DS as each handler called found it.
 * * `winoldap`: WinOldApCall (151) of nought and of 1.
 * * `kernelpdb`: KERNEL's own prefix, as THHOOK's 220h and WinOldApCall(1)'s
 *   DX give it, named against the parent (word 16h) of the probe's.
 * * `initlib`: InitLib (116) with CX nought, and with CX 200h and DS a
 *   block of the probe's.
 * * `patch`: PatchCodeHandle (110) of the probe's code segment, its data
 *   segment, a block of its own and nought; an exported procedure's first
 *   three bytes before and after.
 * * `tlhook`: ToolHelpHook (341) of a procedure, then of what it answered.
 * * `k327`: K327 reached as USER's checks reach it -- BP and the offset of
 *   the API's RETF pushed, then a far return into the check -- with a
 *   warning (BX 8008h) and an error (7008h).
 * * `cvw`: CVWBreak (205) called with the flags as one word.
 * * `dosproc`: GetSetKernelDOSProc (311) of a procedure, then of what it
 *   answered: the procedure; `dosprocold`, what it answered first --
 *   neither nought nor KERNEL's code.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KGAPS.OUT"

typedef DWORD(FAR PASCAL *DwordOfVoid)(void);

static HMODULE kernel;
static WORD kernelData;
static WORD dseg;

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

/* A call with its argument words pushed in order and every register set:
 * what each register holds after, DS among them, and SP. */
static FARPROC target;
static WORD argv[10];
static WORD argc;
static WORD iax, ibx, icx, idx, isi, idi, ies, ids;
static WORD oax, obx, ocx, odx, osi, odi, oes, ods, spBefore, spAfter;

static void callRegs(void)
{
    _asm {
        push si
        push di
        push es
        push bx
        push cx
        push dx
        push bp
        push ds
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
        mov ax, ies
        mov es, ax
        mov ax, iax
        mov bx, ibx
        mov cx, icx
        mov dx, idx
        mov si, isi
        mov di, idi
        mov bp, ids
        or bp, bp
        jz keep
        mov ds, bp
    keep:
        call dword ptr ss:target
        mov ss:oax, ax
        mov ss:obx, bx
        mov ss:ocx, cx
        mov ss:odx, dx
        mov ss:osi, si
        mov ss:odi, di
        mov ss:oes, es
        mov ss:ods, ds
        mov ss:spAfter, sp
        push ss
        pop ds
        mov sp, spBefore
        pop ds
        pop bp
        pop dx
        pop cx
        pop bx
        pop es
        pop di
        pop si
    }
}

static void setup(UINT ordinal, WORD count)
{
    target = entry(ordinal);
    argc = count;
    iax = 0x1234;
    ibx = 0x2345;
    icx = 0x3456;
    idx = 0x5678;
    isi = 0x6789;
    idi = 0x789a;
    ies = dseg;
    ids = 0;
}

static WORD task;
static WORD head;
static WORD pdb;
static WORD parentPdb;

/* A word named where the probe knows it. */
static LPSTR named(WORD value, LPSTR buffer)
{
    if (value == kernelData) {
        return "kernel-data";
    }

    if (value == dseg) {
        return "ours";
    }

    if (task && value == task) {
        return "task";
    }

    if (head && value == head && head != task) {
        return "head";
    }

    if (pdb && value == pdb) {
        return "our-pdb";
    }

    if (parentPdb && value == parentPdb) {
        return "our-parent-pdb";
    }

    wsprintf(buffer, "%x", value);
    return buffer;
}

static WORD left(void)
{
    return spBefore - spAfter;
}

/* ------------------------------------------------------------------ */

static void master(void)
{
    DWORD answer = ((DwordOfVoid)entry(28))();
    WORD ax = LOWORD(answer);
    WORD dx = HIWORD(answer);
    DWORD handle = GlobalHandle(dx);

    wsprintf(probeResult, "ax-odd=%u,dx-odd=%u,ax-is-handle=%s,dx-is-selector=%s,ax-dx=%d",
             ax & 1, dx & 1, (LPSTR)(LOWORD(handle) == ax ? "yes" : "no"),
             (LPSTR)(HIWORD(handle) == dx ? "yes" : "no"), (int)(dx - ax));
    probe("master", "GlobalMasterHandle", probeResult);
}

static void thhook(void)
{
    DWORD address = (DWORD)entry(332);
    DWORD masterPair = ((DwordOfVoid)entry(28))();
    WORD FAR *words = (WORD FAR *)address;
    char buffer[16];
    char one[16];

    wsprintf(probeResult, "selector=%s,offset=%x", named(HIWORD(address), buffer), LOWORD(address));
    probe("thhook", "address", probeResult);

    if (HIWORD(address) != kernelData) {
        return;
    }

    wsprintf(probeResult, "%s", (LPSTR)(words[0] == LOWORD(masterPair) ? "master-handle" : named(words[0], buffer)));
    probe("thhook", "218 heap handle", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(words[1] == HIWORD(masterPair) ? "master-selector" : named(words[1], buffer)));
    probe("thhook", "21a heap selector", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(words[2] == (WORD)GetModuleHandle("KERNEL") ? "kernel-module" : named(words[2], buffer)));
    probe("thhook", "21c first module", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)named(words[4], buffer));
    probe("kernelpdb", "thhook 220", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)named(words[5], buffer));
    probe("thhook", "222 first pdb", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)named(words[7], buffer));
    probe("thhook", "226 first task", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)named(words[8], one));
    probe("thhook", "228 running task", probeResult);
    wsprintf(probeResult, "%x", words[9]);
    probe("thhook", "22a task being made", probeResult);
}

/* ------------------------------------------------------------------ */

static WORD sigCalls, sigDS, sigFirst, sigSecond, sigAX, sigBX;

/* The handler DoSignal calls: two words pushed, DS the task's database. */
static void __declspec(naked) __far SigHandler(void)
{
    _asm {
        push bp
        mov bp, sp
        inc word ptr ss:sigCalls
        mov ss:sigDS, ds
        mov ss:sigAX, ax
        mov ss:sigBX, bx
        mov ax, [bp+8]
        mov ss:sigFirst, ax
        mov ax, [bp+6]
        mov ss:sigSecond, ax
        pop bp
        retf 4
    }
}

static DWORD oldHandler;
static WORD oldAction;
static DWORD kernelCode;

static LPSTR handlerName(DWORD value, LPSTR buffer)
{
    if (value == 0xeeeeeeeeL) {
        return "untouched";
    }

    if (value == (DWORD)SigHandler) {
        return "given";
    }

    if (value == 0) {
        return "0";
    }

    if (HIWORD(value) == HIWORD(kernelCode)) {
        return "kernel-code";
    }

    wsprintf(buffer, "%lx", value);
    return buffer;
}

static void setSig(LPCSTR name, DWORD handler, BOOL pointers, WORD action, WORD signal)
{
    char a[24];
    char b[24];
    char c[24];

    oldHandler = 0xeeeeeeeeL;
    oldAction = 0xeeee;
    setup(140, 8);
    argv[0] = HIWORD(handler);
    argv[1] = LOWORD(handler);
    argv[2] = pointers ? dseg : 0;
    argv[3] = pointers ? (WORD)(DWORD)(LPVOID)&oldHandler : 0;
    argv[4] = dseg;
    argv[5] = (WORD)(DWORD)(LPVOID)&oldAction;
    argv[6] = action;
    argv[7] = signal;
    isi = dseg;
    idi = 0x5a5a;
    callRegs();

    wsprintf(probeResult, "ax=%x,dx=%s,old=%s,action=%x,left=%u", oax,
             (LPSTR)(odx == HIWORD((DWORD)SigHandler) ? "given" : odx == HIWORD(kernelCode) ? "kernel-code" : named(odx, a)),
             handlerName(oldHandler, b), oldAction, left());
    probe("sig", name, probeResult);

    if (!pointers) {
        wsprintf(probeResult, "ds=%s,si=%s,di=%s", named(ods, a), named(osi, b), named(odi, c));
        probe("sig", "registers after no pointer", probeResult);
    }
}

static void doSignal(LPCSTR name)
{
    char a[16];

    sigCalls = 0;
    sigDS = sigFirst = sigSecond = sigAX = sigBX = 0xeeee;
    setup(139, 0);
    callRegs();

    wsprintf(probeResult, "calls=%u,first=%x,second=%x,ax=%x,bx=%x", sigCalls, sigFirst,
             sigSecond, sigAX, sigBX);
    probe("dosignal", name, probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(sigCalls ? named(sigDS, a) : "-"));
    probe("dosignalds", name, probeResult);
    wsprintf(probeResult, "ax=%x,bx=%x,cx=%x,dx=%x,si=%x,di=%x,es=%s,left=%u", oax, obx, ocx, odx,
             osi, odi, (LPSTR)(oes == dseg ? "ours" : "other"), left());
    probe("dosignal", "registers", probeResult);
}

long FAR PASCAL _export ProbeWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void sig(HINSTANCE instance)
{
    WNDCLASS wc;
    HWND hwnd;
    DWORD firstHandler;
    WORD firstAction;

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = ProbeWndProc;
    wc.hInstance = instance;
    wc.lpszClassName = "KGapsWindow";
    RegisterClass(&wc);
    hwnd = CreateWindow("KGapsWindow", "kgaps", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 200, 100,
                        NULL, NULL, instance, NULL);
    SetFocus(hwnd);

    setSig("signal 2", (DWORD)SigHandler, TRUE, 2, 2);
    setSig("action 2", (DWORD)SigHandler, TRUE, 2, 1);
    firstHandler = oldHandler;
    firstAction = oldAction;
    setSig("action 2 again", (DWORD)SigHandler, TRUE, 2, 1);

    SetFocus(hwnd);
    doSignal("focused");
    SetFocus(NULL);
    doSignal("no focus");
    SetFocus(hwnd);

    setSig("action 0", (DWORD)SigHandler, TRUE, 0, 1);
    setSig("action 2 after 0", (DWORD)SigHandler, TRUE, 2, 1);
    doSignal("after 0");
    setSig("action 1", (DWORD)SigHandler, TRUE, 1, 1);
    doSignal("action 1");

    setSig("action 4", (DWORD)SigHandler, TRUE, 4, 1);
    setSig("action 4 again", 0, TRUE, 4, 1);

    setSig("no pointer", (DWORD)SigHandler, FALSE, 2, 1);
    doSignal("no pointer");

    setSig("put back", firstHandler, TRUE, firstAction, 1);

    DestroyWindow(hwnd);
}

/* ------------------------------------------------------------------ */

static void winoldap(void)
{
    char a[16];
    char b[16];

    setup(151, 1);
    argv[0] = 0;
    callRegs();
    wsprintf(probeResult, "ax=%x,bx=%x,cx=%x,dx=%x,di=%s,left=%u", oax, obx, ocx, odx,
             named(odi, a), left());
    probe("winoldap", "0", probeResult);

    setup(151, 1);
    argv[0] = 1;
    callRegs();
    wsprintf(probeResult, "ax=%s,bx=%s,cx=%x,di=%x,left=%u", named(oax, a),
             (LPSTR)(obx == spBefore - 8 ? "sp" : "other"), ocx, odi, left());
    probe("winoldap", "1", probeResult);
    wsprintf(probeResult, "%s", named(odx, b));
    probe("kernelpdb", "winoldapcall 1 dx", probeResult);
}

/* ------------------------------------------------------------------ */

static void initlib(void)
{
    char a[16];
    char b[16];
    HGLOBAL block;
    WORD selector;

    setup(116, 0);
    icx = 0;
    callRegs();
    wsprintf(probeResult, "ax=%x,cx=%x,dx=%x,si=%x,di=%x,es=%s,ds=%s,left=%u", oax, ocx, odx, osi,
             odi, named(oes, a), named(ods, b), left());
    probe("initlib", "cx 0", probeResult);

    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 0x400);
    selector = HIWORD((DWORD)GlobalLock(block));
    setup(116, 0);
    icx = 0x200;
    ids = selector;
    callRegs();
    wsprintf(probeResult, "ax=%x,cx=%x,si=%x,di=%x,es=%s,ds=%s,left=%u", oax, ocx, osi, odi,
             named(oes, a), (LPSTR)(ods == selector ? "block" : named(ods, b)), left());
    probe("initlib", "cx 200 block", probeResult);
    wsprintf(probeResult, "%x %x %x %x %x %x %x %x", ((WORD FAR *)MAKELP(selector, 0))[0],
             ((WORD FAR *)MAKELP(selector, 0))[1], ((WORD FAR *)MAKELP(selector, 0))[2],
             ((WORD FAR *)MAKELP(selector, 0))[3], ((WORD FAR *)MAKELP(selector, 0))[4],
             ((WORD FAR *)MAKELP(selector, 0))[5], ((WORD FAR *)MAKELP(selector, 0))[6],
             ((WORD FAR *)MAKELP(selector, 0))[7]);
    probe("initlib", "block header", probeResult);
    GlobalUnlock(block);
    GlobalFree(block);
}

/* ------------------------------------------------------------------ */

void FAR PASCAL _export Exported(void)
{
}

static void patchOne(LPCSTR name, WORD handle, WORD selector)
{
    setup(110, 1);
    argv[0] = handle;
    callRegs();
    wsprintf(probeResult, "ax=%s,dx=%s,left=%u",
             (LPSTR)(oax == handle ? "handle" : oax == 0 ? "0" : "other"),
             (LPSTR)(odx == selector && selector ? "selector" : odx == 0 ? "0" : odx == handle ? "handle" : "other"),
             left());
    probe("patch", name, probeResult);
}

static void patch(void)
{
    BYTE FAR *code = (BYTE FAR *)(FARPROC)Exported;
    WORD codeSelector = HIWORD((DWORD)(FARPROC)Exported);
    DWORD codeHandle = GlobalHandle(codeSelector);
    DWORD dataHandle = GlobalHandle(dseg);
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE, 0x100);
    WORD blockSelector = HIWORD((DWORD)GlobalLock(block));

    GlobalUnlock(block);
    wsprintf(probeResult, "%02x %02x %02x", code[0], code[1], code[2]);
    probe("patch", "prologue before", probeResult);

    patchOne("code", LOWORD(codeHandle), codeSelector);
    wsprintf(probeResult, "%02x %02x %02x", code[0], code[1], code[2]);
    probe("patch", "prologue after", probeResult);
    patchOne("data", LOWORD(dataHandle), dseg);
    patchOne("block", (WORD)block, blockSelector);
    patchOne("nought", 0, 0);

    GlobalFree(block);
}

/* ------------------------------------------------------------------ */

static void __declspec(naked) __far Hook(void)
{
    _asm {
        xor ax, ax
        retf
    }
}

static LPSTR procName(DWORD value, DWORD given, LPSTR buffer)
{
    if (value == given) {
        return "given";
    }

    if (value == 0) {
        return "0";
    }

    if (HIWORD(value) == HIWORD(kernelCode)) {
        return "kernel-code";
    }

    wsprintf(buffer, "other");
    return buffer;
}

static void tlhook(void)
{
    char a[16];
    DWORD old;
    DWORD back;

    setup(341, 2);
    argv[0] = HIWORD((DWORD)Hook);
    argv[1] = LOWORD((DWORD)Hook);
    callRegs();
    old = MAKELONG(oax, odx);
    wsprintf(probeResult, "old=%s,bx=%s,cx=%x,left=%u", procName(old, (DWORD)Hook, a),
             (LPSTR)(obx == (LOWORD((DWORD)Hook) | HIWORD((DWORD)Hook)) ? "offset-or-selector" : "other"),
             ocx, left());
    probe("tlhook", "set", probeResult);

    setup(341, 2);
    argv[0] = HIWORD(old);
    argv[1] = LOWORD(old);
    callRegs();
    back = MAKELONG(oax, odx);
    wsprintf(probeResult, "old=%s,left=%u", procName(back, (DWORD)Hook, a), left());
    probe("tlhook", "put back", probeResult);
}

/* ------------------------------------------------------------------ */

static WORD kcode, kpath, kbp;

static void k327(LPCSTR name, WORD code)
{
    target = entry(327);
    kcode = code;
    kpath = 0;
    oax = obx = ocx = odx = oes = 0xeeee;

    _asm {
        push si
        push di
        push es
        push bx
        push cx
        push dx
        push bp
        push ds
        mov spBefore, sp
        mov ax, dseg
        mov es, ax
        mov ax, 1235h
        push ax
        call pushReturn
    unwound:
        mov ss:kpath, 2
        jmp captured
    pushReturn:
        push cs
        call pushCheck
    warned:
        mov ss:kpath, 1
        jmp captured
    pushCheck:
        mov bx, kcode
        mov cx, 0abcdh
        mov ax, 1234h
        mov dx, 5678h
        jmp dword ptr ss:target
    captured:
        mov ss:oax, ax
        mov ss:obx, bx
        mov ss:ocx, cx
        mov ss:odx, dx
        mov ss:oes, es
        mov ss:kbp, bp
        mov ss:spAfter, sp
        push ss
        pop ds
        mov sp, spBefore
        pop ds
        pop bp
        pop dx
        pop cx
        pop bx
        pop es
        pop di
        pop si
    }

    wsprintf(probeResult, "path=%s,ax=%x,bx=%x,cx=%x,dx=%x,es=%s,bp=%x,above=%d",
             (LPSTR)(kpath == 1 ? "warning" : kpath == 2 ? "unwound" : "none"), oax, obx, ocx, odx,
             (LPSTR)(oes == dseg ? "ours" : oes == 0 ? "0" : "other"), kpath == 2 ? kbp : 0,
             (int)(spBefore - spAfter));
    probe("k327", name, probeResult);
}

/* ------------------------------------------------------------------ */

static void cvw(void)
{
    WORD flags;

    _asm {
        pushf
        pop ax
        mov flags, ax
    }

    setup(205, 1);
    argv[0] = flags;
    callRegs();
    wsprintf(probeResult, "ax=%x,bx=%x,cx=%x,dx=%x,si=%x,di=%x,left=%u", oax, obx, ocx, odx, osi,
             odi, left());
    probe("cvw", "flags", probeResult);
}

/* ------------------------------------------------------------------ */

static void __declspec(naked) __far DosProc(void)
{
    _asm {
        iret
    }
}

static void dosproc(void)
{
    char a[16];
    DWORD old;
    DWORD back;

    setup(311, 2);
    argv[0] = HIWORD((DWORD)DosProc);
    argv[1] = LOWORD((DWORD)DosProc);
    callRegs();
    old = MAKELONG(oax, odx);

    setup(311, 2);
    argv[0] = HIWORD(old);
    argv[1] = LOWORD(old);
    callRegs();
    back = MAKELONG(oax, odx);

    wsprintf(probeResult, "left=%u", left());
    probe("dosproc", "set", probeResult);
    wsprintf(probeResult, "%s", procName(old, (DWORD)DosProc, a));
    probe("dosprocold", "first", probeResult);
    wsprintf(probeResult, "old=%s", procName(back, (DWORD)DosProc, a));
    probe("dosproc", "put back", probeResult);
}

/* ------------------------------------------------------------------ */

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD current;

    probeOpen(OUTPUT);
    kernel = GetModuleHandle("KERNEL");
    kernelData = HIWORD(((DwordOfVoid)entry(99))());
    kernelCode = (DWORD)entry(139);
    dseg = ourDS();
    current = ((DwordOfVoid)entry(36))();
    task = LOWORD(current);
    head = HIWORD(current);
    pdb = (WORD)((DwordOfVoid)entry(37))();
    parentPdb = *(WORD FAR *)MAKELP(pdb, 0x16);

    master();
    thhook();
    sig(instance);
    winoldap();
    initlib();
    patch();
    tlhook();
    k327("warning 8008", 0x8008);
    k327("error 7008", 0x7008);
    cvw();
    dosproc();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
