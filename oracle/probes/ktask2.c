/*
 * More of KERNEL's small calls, each reached by its ordinal through
 * GetProcAddress: a code segment found from a procedure, a heap's room,
 * and calls that answer little.
 *
 * * `code`: GetCodeHandle of a procedure of the probe's and of its
 *   instance thunk: whether AX is the code segment's handle and DX its
 *   selector; GetCodeInfo of the procedure and of the probe's module and
 *   segment 2: AX, and the SEGINFO's fields -- not the flags, which KERNEL
 *   keeps its own bits in -- beside the probe's segment table's.
 * * `heap`: GetHeapSpaces of the probe's module: the room and the free
 *   space against LocalHeapSize and LocalCountFree.
 * * `small`: GetLastDiskChange, MemoryFreed of nought, SetSwapAreaSize of
 *   nought, DefineHandleTable of nought, SetTaskSignalProc of a procedure
 *   and back, GlobalLRUOldest and GlobalLRUNewest of a block.
 * * `dos`: NoHookDosCall and DOS3Call with AH 19h, the current drive.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KTASK2.OUT"

typedef DWORD(FAR PASCAL *DwordOfVoid)(void);
typedef DWORD(FAR PASCAL *DwordOfWord)(WORD);
typedef DWORD(FAR PASCAL *DwordOfWordWord)(WORD, WORD);
typedef DWORD(FAR PASCAL *DwordOfFar)(LPVOID);
typedef DWORD(FAR PASCAL *DwordOfFarFar)(LPVOID, LPVOID);
typedef DWORD(FAR PASCAL *DwordOfWordFar)(WORD, LPVOID);

static HMODULE kernel;
static HINSTANCE self;

static FARPROC entry(UINT ordinal)
{
    return GetProcAddress(kernel, MAKEINTRESOURCE(ordinal));
}

static UINT ourCS(void)
{
    UINT value;

    _asm mov value, cs
    return value;
}

void FAR PASCAL __export Target(void)
{
}

static void code(void)
{
    FARPROC thunk = MakeProcInstance((FARPROC)Target, self);
    DWORD answer;
    WORD info[6];
    WORD cs = (WORD)((DWORD)(LPVOID)Target >> 16);

    answer = ((DwordOfFar)entry(93))((LPVOID)Target);
    wsprintf(probeResult, "ax=%s,dx=%s",
             (LPSTR)((WORD)answer == (WORD)GlobalHandle(cs) ? "handle" : "other"),
             (LPSTR)((WORD)(answer >> 16) == cs ? "selector" : "other"));
    probe("code", "GetCodeHandle", probeResult);

    answer = ((DwordOfFar)entry(93))((LPVOID)thunk);
    wsprintf(probeResult, "ax=%s,dx=%s",
             (LPSTR)((WORD)answer == (WORD)GlobalHandle(cs) ? "handle" : "other"),
             (LPSTR)((WORD)(answer >> 16) == cs ? "selector" : "other"));
    probe("code", "GetCodeHandle-thunk", probeResult);

    _fmemset(info, 0xee, sizeof(info));
    answer = ((DwordOfFarFar)entry(104))((LPVOID)Target, (LPVOID)info);
    wsprintf(probeResult, "%x:offset=%x,size=%x,alloc=%x,handle=%s,shift=%x", (WORD)answer,
             info[0], info[1], info[3],
             (LPSTR)(info[4] == (WORD)GlobalHandle(cs) ? "handle"
                     : info[4] == cs                   ? "selector"
                                                       : "other"),
             info[5]);
    probe("code", "GetCodeInfo-proc", probeResult);

    _fmemset(info, 0xee, sizeof(info));
    answer = ((DwordOfFarFar)entry(104))(MAKELP(GetModuleHandle("KTASK2"), 2), (LPVOID)info);
    wsprintf(probeResult, "%x:offset=%x,size=%x,alloc=%x,shift=%x", (WORD)answer, info[0],
             info[1], info[3], info[5]);
    probe("code", "GetCodeInfo-2", probeResult);

    FreeProcInstance(thunk);
    (void)ourCS;
}

static void heap(void)
{
    DWORD answer = ((DwordOfWord)entry(138))((WORD)GetModuleHandle("KTASK2"));

    wsprintf(probeResult, "free=%x,room=%x,count=%x,size=%x", (WORD)answer, (WORD)(answer >> 16),
             (WORD)((DwordOfVoid)entry(161))(), (WORD)((DwordOfVoid)entry(162))());
    probe("heap", "GetHeapSpaces", probeResult);
}

BOOL FAR PASCAL __export Signal(HTASK task, WORD code, WORD a, HANDLE b, HANDLE c)
{
    (void)task;
    (void)code;
    (void)a;
    (void)b;
    (void)c;
    return 0;
}

static void small(void)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DISCARDABLE, 64);
    FARPROC proc = MakeProcInstance((FARPROC)Signal, self);
    DWORD first;
    DWORD second;

    wsprintf(probeResult, "%x", (WORD)((DwordOfVoid)entry(98))());
    probe("small", "GetLastDiskChange", probeResult);

    wsprintf(probeResult, "%lx", ((DwordOfWord)entry(126))(0));
    probe("small", "MemoryFreed", probeResult);

    wsprintf(probeResult, "%lx", ((DwordOfWord)entry(106))(0));
    probe("small", "SetSwapAreaSize", probeResult);

    first = ((DwordOfWordFar)entry(38))(0, (LPVOID)proc);
    second = ((DwordOfWordFar)entry(38))(0, (LPVOID)first);
    wsprintf(probeResult, "first=%s,second=%s", (LPSTR)(first ? "set" : "0"),
             (LPSTR)(second == (DWORD)proc ? "proc" : "other"));
    probe("small", "SetTaskSignalProc", probeResult);

    wsprintf(probeResult, "oldest=%s,newest=%s,bad=%x",
             (LPSTR)((WORD)((DwordOfWord)entry(163))((WORD)block) == (WORD)block ? "block" : "other"),
             (LPSTR)((WORD)((DwordOfWord)entry(164))((WORD)block) == (WORD)block ? "block" : "other"),
             (WORD)((DwordOfWord)entry(163))(0x1234));
    probe("small", "GlobalLRU", probeResult);

    FreeProcInstance(proc);
    GlobalFree(block);
}

static FARPROC target;

static WORD drive(UINT ordinal)
{
    WORD value;

    target = entry(ordinal);

    _asm {
        push ds
        mov ax, 1900h
        call dword ptr target
        pop ds
        mov value, ax
    }

    return value;
}

static void dos(void)
{
    wsprintf(probeResult, "nohook=%x,dos3=%x", drive(101), drive(102));
    probe("dos", "drive", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    kernel = GetModuleHandle("KERNEL");
    self = instance;

    probeOpen(OUTPUT);

    code();
    heap();
    small();
    dos();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
