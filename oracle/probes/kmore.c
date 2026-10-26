/*
 * The rest of KERNEL's documented small calls, each reached by its ordinal
 * through GetProcAddress:
 *
 * * `errmode`: GetLPErrMode -- whether its selector is KERNEL's data
 *   segment's, its offset, and the byte there.
 * * `longptr`: LongPtrAdd of a selector of the probe's own copied from a
 *   block, offset 1234h, adding 10h: the offset answered, whether the
 *   selector is the one given, how far its base moved, its limit; adding
 *   1000000h (refused); and on a block of 20000h, two selectors, adding
 *   100h: how far each selector's base moved, and each limit.
 * * `netbios`: NetBIOSCall with AX 1234h, CX 5678h, DX 9ABCh and ES:BX an
 *   NCB whose command is 7Fh: the registers after, the carry, and the NCB's
 *   first two bytes.
 * * `handles`: DefineHandleTable of a table of three entries filled with
 *   EEEEh, then of nought: each answer, and the table after.
 * * `dos`: GlobalDosAlloc of 100h and of 20h: whether the selector's base,
 *   from __0000H's, is the segment's paragraph, whether it is below the
 *   first megabyte, GlobalSize, GlobalFlags, whether GlobalHandle is the
 *   selector, the limit; the first segment less the second, and the first
 *   segment; of 100000h (refused), 10000h and 40000h; GlobalDosFree of
 *   each, and again; then 20h more, and its segment less the first's.
 * * `cpi`: CallProcInstance of a procedure answering AX and DS as it found
 *   them, through an instance of nought, of 1234h and of 1235h: AX against
 *   the probe's DS, and DS.
 * * `stack`: SwitchStackTo a block of the probe's from a frame of three
 *   words (1111h, 2222h, 3333h under BP), at 0F00h, its top 100h, and
 *   back: SS, SP and BP between and the frame's words read through BP
 *   there; SS, SP and BP after, and AX as SwitchStackBack leaves it; the
 *   block's words 0 to 0Eh between and after.
 * * `path`: OpenPathName of a file there (C:\ORACLE\KMORE.TXT, mode 0, and
 *   3D02h), of WIN.INI with no directory (Windows' directory current), of
 *   a name that is nowhere (PATH, under DOSBox, is Z:\); DeletePathName of
 *   the file, and again.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <string.h>

#define OUTPUT "C:\\ORACLE\\KMORE.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);
DWORD FAR PASCAL GetSelectorLimit(UINT);
UINT FAR PASCAL AllocSelector(UINT);
UINT FAR PASCAL FreeSelector(UINT);

typedef DWORD(FAR PASCAL *DwordOfVoid)(void);
typedef DWORD(FAR PASCAL *DwordOfWord)(WORD);
typedef DWORD(FAR PASCAL *DwordOfDword)(DWORD);
typedef DWORD(FAR PASCAL *DwordOfDwordDword)(DWORD, DWORD);
typedef DWORD(FAR PASCAL *DwordOfFarWord)(LPCSTR, WORD);
typedef DWORD(FAR PASCAL *DwordOfFar)(LPCSTR);
typedef void(FAR PASCAL *VoidOfWords)(WORD, WORD, WORD);
typedef void(FAR PASCAL *VoidOfVoid)(void);

static HMODULE kernel;

static FARPROC entry(UINT ordinal)
{
    return GetProcAddress(kernel, MAKEINTRESOURCE(ordinal));
}

static WORD ourDS(void)
{
    WORD value;

    _asm mov value, ds
    return value;
}

static void errmode(void)
{
    HINSTANCE data = LoadLibrary("KERNEL");
    DWORD answer = ((DwordOfVoid)entry(99))();

    wsprintf(probeResult, "sel=%s,off=%x,byte=%x",
             (LPSTR)((WORD)(answer >> 16) == (WORD)data ? "kernel" : "other"), (WORD)answer,
             (WORD) * (BYTE FAR *)answer);
    probe("errmode", "GetLPErrMode", probeResult);
    FreeLibrary(data);
}

static void longptr(void)
{
    HGLOBAL block = GlobalAlloc(GMEM_FIXED, 0x2000);
    UINT copy = AllocSelector((UINT)block);
    DWORD base = GetSelectorBase(copy);
    DWORD answer;
    HGLOBAL big;
    DWORD first;
    DWORD second;

    answer = ((DwordOfDwordDword)entry(180))((DWORD)MAKELP(copy, 0x1234), 0x10);
    wsprintf(probeResult, "off=%x,sel=%s,moved=%lx,limit=%lx", (WORD)answer,
             (LPSTR)((WORD)(answer >> 16) == copy ? "same" : "other"),
             GetSelectorBase(copy) - base, GetSelectorLimit(copy));
    probe("longptr", "add-10", probeResult);

    base = GetSelectorBase(copy);
    answer = ((DwordOfDwordDword)entry(180))((DWORD)MAKELP(copy, 0x20), 0x1000000L);
    wsprintf(probeResult, "%lx,moved=%lx", answer, GetSelectorBase(copy) - base);
    probe("longptr", "add-1000000", probeResult);

    FreeSelector(copy);
    GlobalFree(block);

    big = GlobalAlloc(GMEM_FIXED, 0x20000L);
    first = GetSelectorBase((UINT)big);
    second = GetSelectorBase((UINT)big + 8);
    answer = ((DwordOfDwordDword)entry(180))((DWORD)MAKELP(big, 0), 0x100);
    wsprintf(probeResult, "off=%x,sel=%s,moved=%lx,%lx,limit=%lx,%lx", (WORD)answer,
             (LPSTR)((WORD)(answer >> 16) == (WORD)big ? "same" : "other"),
             GetSelectorBase((UINT)big) - first, GetSelectorBase((UINT)big + 8) - second,
             GetSelectorLimit((UINT)big), GetSelectorLimit((UINT)big + 8));
    probe("longptr", "huge", probeResult);
    GlobalFree(big);
}

static BYTE ncb[64];
static FARPROC target;
static WORD rax, rbx, rcx, rdx, rcarry, res;

static void netbiosCall(void)
{
    WORD dseg = ourDS();

    _fmemset(ncb, 0, sizeof(ncb));
    ncb[0] = 0x7f;
    ncb[1] = 0xee;
    target = entry(103);

    _asm {
        push es
        push si
        push di
        mov es, dseg
        lea bx, ncb
        mov ax, 1234h
        mov cx, 5678h
        mov dx, 09abch
        call dword ptr target
        pushf
        mov rax, ax
        mov rbx, bx
        mov rcx, cx
        mov rdx, dx
        mov ax, es
        mov res, ax
        pop ax
        and ax, 1
        mov rcarry, ax
        pop di
        pop si
        pop es
    }

    wsprintf(probeResult, "ax=%x,bx=%s,cx=%x,dx=%x,es=%s,cf=%x,ncb=%x %x", rax,
             (LPSTR)(rbx == (WORD)(DWORD)(LPVOID)ncb ? "ncb" : "other"), rcx, rdx,
             (LPSTR)(res == dseg ? "ds" : "other"), rcarry, (WORD)ncb[0], (WORD)ncb[1]);
    probe("netbios", "7f", probeResult);
}

static WORD table[6];

static void handles(void)
{
    DWORD first;
    DWORD second;

    table[0] = 3;
    table[1] = table[2] = table[3] = table[4] = table[5] = 0xeeee;
    first = ((DwordOfWord)entry(94))((WORD)(DWORD)(LPVOID)table);
    wsprintf(probeResult, "%x:%x %x %x %x %x %x", (WORD)first, table[0], table[1], table[2],
             table[3], table[4], table[5]);
    probe("handles", "table", probeResult);

    second = ((DwordOfWord)entry(94))(0);
    wsprintf(probeResult, "%s", (LPSTR)((WORD)second == ourDS() ? "ds" : "other"));
    probe("handles", "0", probeResult);
}

static void dosOne(LPCSTR name, DWORD size, DWORD *kept)
{
    DWORD answer = ((DwordOfDword)entry(184))(size);
    WORD selector = (WORD)answer;
    WORD segment = (WORD)(answer >> 16);
    DWORD base;

    *kept = answer;

    if (!selector) {
        wsprintf(probeResult, "%lx", answer);
        probe("dos", name, probeResult);
        return;
    }

    /* From where the first megabyte is, as KERNEL's __0000H reaches it: nought
     * on Windows, the machine's elsewhere (kconst). */
    base = GetSelectorBase(selector) - GetSelectorBase((UINT)(DWORD)GetProcAddress(kernel, MAKEINTRESOURCE(183)));
    wsprintf(probeResult, "base=%s,low=%s,size=%lx,flags=%x,handle=%s,limit=%lx",
             (LPSTR)(base == (DWORD)segment * 16 ? "segment" : "other"),
             (LPSTR)(base < 0x100000L ? "yes" : "no"), GlobalSize((HGLOBAL)selector),
             GlobalFlags((HGLOBAL)selector),
             (LPSTR)((WORD)GlobalHandle(selector) == selector ? "selector" : "other"),
             GetSelectorLimit(selector));
    probe("dos", name, probeResult);
}

static void dos(void)
{
    DWORD first;
    DWORD second;
    DWORD big;

    dosOne("100", 0x100, &first);
    dosOne("20", 0x20, &second);

    if ((WORD)first && (WORD)second) {
        wsprintf(probeResult, "%x", (WORD)((first >> 16) - (second >> 16)));
        probe("dos", "first-less-second", probeResult);
    }

    wsprintf(probeResult, "%x", (WORD)(first >> 16));
    probe("dos", "first-segment", probeResult);

    dosOne("100000", 0x100000L, &big);
    dosOne("10000", 0x10000L, &big);
    if ((WORD)big) {
        ((DwordOfWord)entry(185))((WORD)big);
    }
    dosOne("40000", 0x40000L, &big);
    if ((WORD)big) {
        ((DwordOfWord)entry(185))((WORD)big);
    }

    wsprintf(probeResult, "%x", (WORD)((DwordOfWord)entry(185))((WORD)first));
    probe("dos", "free-100", probeResult);
    wsprintf(probeResult, "%x", (WORD)((DwordOfWord)entry(185))((WORD)second));
    probe("dos", "free-20", probeResult);
    wsprintf(probeResult, "%x", (WORD)((DwordOfWord)entry(185))((WORD)first));
    probe("dos", "free-again", probeResult);

    dosOne("20-after", 0x20, &big);
    if ((WORD)big) {
        wsprintf(probeResult, "%x", (WORD)((big >> 16) - (first >> 16)));
        probe("dos", "after-less-first", probeResult);
        ((DwordOfWord)entry(185))((WORD)big);
    }
}

/* What a procedure finds as it is called: AX, and DS in DX. */
static void __declspec(naked) __far Peek(void)
{
    _asm {
        mov dx, ds
        retf
    }
}

static struct {
    WORD instance;
    void(__far *proc)(void);
} cpiBlock;

static void cpiOne(WORD instance)
{
    WORD ax, dx;
    WORD dseg = ourDS();

    cpiBlock.instance = instance;
    cpiBlock.proc = Peek;
    target = entry(53);

    _asm {
        push es
        push ds
        mov es, dseg
        lea bx, cpiBlock
        call dword ptr target
        pop ds
        pop es
        mov ax, ax
        mov rax, ax
        mov rdx, dx
    }

    ax = rax;
    dx = rdx;
    wsprintf(probeArgs, "%x", instance);

    if (ax == dseg) {
        wsprintf(probeResult, "ax=ds,ds=%s", (LPSTR)(dx == dseg ? "ds" : "other"));
    } else {
        wsprintf(probeResult, "ax=%x,ds=%s", ax, (LPSTR)(dx == dseg ? "ds" : "other"));
    }

    probe("cpi", probeArgs, probeResult);
}

static void cpi(void)
{
    cpiOne(0);
    cpiOne(0x1234);
    cpiOne(0x1235);
}

static WORD stackBlock;
static WORD ss1, sp1, bp1, v2, v4, v6, ss2, sp2, bp2, axBack, spBefore, bpBefore;
static WORD between[8];
static WORD after[8];
static VoidOfWords switchTo;
static VoidOfVoid switchBack;

/*
 * A frame of its own, three words under BP, switched to the block at 0F00h
 * and back, all in one piece of assembly, so that the compiler's frame is
 * not what is copied.
 */
static void stack(void)
{
    WORD FAR *words;
    int at;

    stackBlock = (WORD)((DWORD)GlobalLock(GlobalAlloc(GMEM_FIXED | GMEM_ZEROINIT, 0x1000)) >> 16);
    switchTo = (VoidOfWords)entry(108);
    switchBack = (VoidOfVoid)entry(109);
    words = (WORD FAR *)MAKELP(stackBlock, 0);

    _asm {
        push bp
        push si
        push di
        mov bp, sp
        mov ax, 1111h
        push ax
        mov ax, 2222h
        push ax
        mov ax, 3333h
        push ax
        mov spBefore, sp
        mov bpBefore, bp
        push stackBlock
        mov ax, 0f00h
        push ax
        mov ax, 0100h
        push ax
        call dword ptr switchTo
        mov ss1, ss
        mov sp1, sp
        mov bp1, bp
        mov ax, [bp-2]
        mov v2, ax
        mov ax, [bp-4]
        mov v4, ax
        mov ax, [bp-6]
        mov v6, ax
    }

    /* BP is the new stack's: nothing of the compiler's frame here. */
    _asm {
        push es
        mov es, stackBlock
        mov ax, es:[0]
        mov between+0, ax
        mov ax, es:[2]
        mov between+2, ax
        mov ax, es:[4]
        mov between+4, ax
        mov ax, es:[6]
        mov between+6, ax
        mov ax, es:[8]
        mov between+8, ax
        mov ax, es:[10]
        mov between+10, ax
        mov ax, es:[12]
        mov between+12, ax
        mov ax, es:[14]
        mov between+14, ax
        pop es
        mov ax, 7777h
        call dword ptr switchBack
        mov axBack, ax
        mov ss2, ss
        mov sp2, sp
        mov bp2, bp
        add sp, 6
        pop di
        pop si
        pop bp
    }

    for (at = 0; at < 8; at++) {
        after[at] = words[at];
    }

    wsprintf(probeResult, "ss=%s,sp=%x,bp=%x,frame=%x %x %x",
             (LPSTR)(ss1 == stackBlock ? "block" : "other"), sp1, bp1, v2, v4, v6);
    probe("stack", "switch", probeResult);

    wsprintf(probeResult, "ss=%s,sp=%s,bp=%s,ax=%x", (LPSTR)(ss2 == ourDS() ? "ds" : "other"),
             (LPSTR)(sp2 == spBefore ? "before" : "other"),
             (LPSTR)(bp2 == bpBefore ? "before" : "other"), axBack);
    probe("stack", "back", probeResult);

    wsprintf(probeResult, "%x %s %s %x %x %x %x %x", between[0],
             (LPSTR)(between[1] == spBefore - 2 ? "sp-2" : between[1] == spBefore ? "sp" : "other"),
             (LPSTR)(between[2] == ourDS() ? "ds" : "other"), between[3], between[4], between[5],
             between[6], between[7]);
    probe("stack", "between", probeResult);

    wsprintf(probeResult, "%x %x %x %x %x %x %x %x", after[0], after[1], after[2], after[3],
             after[4], after[5], after[6], after[7]);
    probe("stack", "after", probeResult);

    GlobalFree((HGLOBAL)GlobalHandle(stackBlock));
}

static void path(void)
{
    HFILE made = _lcreat("C:\\ORACLE\\KMORE.TXT", 0);
    DWORD answer;

    _lwrite(made, "kmore", 5);
    _lclose(made);

    answer = ((DwordOfFarWord)entry(75))("C:\\ORACLE\\KMORE.TXT", 0);
    wsprintf(probeResult, "%s", (LPSTR)((WORD)answer == 0xffff ? "ffff" : "handle"));
    probe("path", "open-there", probeResult);

    if ((WORD)answer != 0xffff) {
        _lclose((HFILE)answer);
    }

    answer = ((DwordOfFarWord)entry(75))("WIN.INI", 0);
    wsprintf(probeResult, "%s", (LPSTR)((WORD)answer == 0xffff ? "ffff" : "handle"));
    probe("path", "open-win.ini", probeResult);

    if ((WORD)answer != 0xffff) {
        _lclose((HFILE)answer);
    }

    answer = ((DwordOfFarWord)entry(75))("NOWHERE.XYZ", 0);
    wsprintf(probeResult, "%x", (WORD)answer);
    probe("path", "open-nowhere", probeResult);

    answer = ((DwordOfFarWord)entry(75))("C:\\ORACLE\\KMORE.TXT", 0x3d02);
    wsprintf(probeResult, "%s", (LPSTR)((WORD)answer == 0xffff ? "ffff" : "handle"));
    probe("path", "open-3d02", probeResult);

    if ((WORD)answer != 0xffff) {
        _lclose((HFILE)answer);
    }

    answer = ((DwordOfFar)entry(76))("C:\\ORACLE\\KMORE.TXT");
    wsprintf(probeResult, "%x", (WORD)answer);
    probe("path", "delete", probeResult);

    answer = ((DwordOfFar)entry(76))("C:\\ORACLE\\KMORE.TXT");
    wsprintf(probeResult, "%x", (WORD)answer);
    probe("path", "delete-again", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    kernel = GetModuleHandle("KERNEL");

    probeOpen(OUTPUT);

    errmode();
    longptr();
    netbiosCall();
    handles();
    dos();
    cpi();
    probeNote("stack");
    stack();
    probeNote("path");
    path();

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
