/*
 * KERNEL's pointer checks: IsBadReadPtr, IsBadWritePtr, IsBadCodePtr,
 * IsBadStringPtr, IsBadHugeReadPtr and IsBadHugeWritePtr, over pointers
 * whose selectors and limits are known.
 *
 * The blocks: `small`, 40 bytes of moveable global memory, whose selector's
 * limit is its size rounded to 32 less one, 3Fh; and `huge`, 70000 bytes
 * over two selectors. Each record is the case and the answer.
 *
 * KERNEL answers by touching the memory (`KRNL386.EXE` seg1 `4b62` on): it
 * loads the pointer, reads or writes the last byte of the range -- the last
 * of each 64 KiB tile too, for the huge forms -- or scans a string for its
 * nought, and answers 1 when that faults. `fault` are the cases whose answer
 * rests on a fault DOSBox, which the recording is made under, does not raise:
 * the null selector, an offset past a segment's limit, and a write to code.
 * There DOSBox answers 0 and a real processor 1. `check` are the rest.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BADPTR.OUT"

static void answer(LPCSTR function, LPCSTR name, BOOL result)
{
    wsprintf(probeResult, "%d", result);
    probe(function, name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL smallBlock = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 40);
    HGLOBAL hugeBlock = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 70000L);
    BYTE FAR *small = (BYTE FAR *)GlobalLock(smallBlock);
    BYTE __huge *big = (BYTE __huge *)GlobalLock(hugeBlock);
    WORD selector = HIWORD((DWORD)small);
    FARPROC code = (FARPROC)WinMain;
    int i;

    probeOpen(OUTPUT);

    for (i = 0; i < 0x40; i++) {
        small[i] = 'a';
    }
    small[10] = '\0';

    answer("check", "read-start", IsBadReadPtr(small, 4));
    answer("check", "read-to-limit", IsBadReadPtr(small + 0x3c, 4));
    answer("fault", "read-past-limit", IsBadReadPtr(small + 0x3d, 4));
    answer("check", "read-at-limit", IsBadReadPtr(small + 0x3f, 1));
    answer("fault", "read-beyond", IsBadReadPtr(small + 0x40, 1));
    answer("check", "read-none", IsBadReadPtr(small, 0));
    answer("check", "read-none-beyond", IsBadReadPtr(small + 0x80, 0));
    answer("fault", "read-null", IsBadReadPtr(NULL, 1));
    answer("fault", "read-null-offset", IsBadReadPtr(MAKELP(0, 0x1234), 1));
    answer("check", "read-nonsense", IsBadReadPtr(MAKELP(0xfff7, 0), 1));
    answer("check", "read-code", IsBadReadPtr((void FAR *)code, 1));
    answer("check", "read-handle", IsBadReadPtr(MAKELP(selector & ~1, 0), 1));

    answer("check", "write-start", IsBadWritePtr(small, 4));
    answer("fault", "write-past-limit", IsBadWritePtr(small + 0x3d, 4));
    answer("fault", "write-code", IsBadWritePtr((void FAR *)code, 1));
    answer("fault", "write-null", IsBadWritePtr(NULL, 1));

    answer("check", "code-code", IsBadCodePtr(code));
    answer("check", "code-data", IsBadCodePtr((FARPROC)small));
    answer("check", "code-null", IsBadCodePtr(NULL));
    answer("check", "code-past-limit", IsBadCodePtr((FARPROC)MAKELP(selector, 0x40)));

    answer("check", "string-ended", IsBadStringPtr(small, 100));
    answer("check", "string-short", IsBadStringPtr(small, 5));
    answer("fault", "string-unended", IsBadStringPtr(small + 11, 100));
    answer("check", "string-unended-short", IsBadStringPtr(small + 11, 20));
    answer("fault", "string-null", IsBadStringPtr(NULL, 5));

    answer("check", "huge-read", IsBadHugeReadPtr(big, 70000L));
    answer("fault", "huge-read-past", IsBadHugeReadPtr(big, 70050L));
    answer("check", "huge-read-small", IsBadHugeReadPtr(small, 0x40));
    answer("fault", "huge-read-small-past", IsBadHugeReadPtr(small, 0x41));
    answer("check", "huge-write", IsBadHugeWritePtr(big, 70000L));
    answer("fault", "huge-write-code", IsBadHugeWritePtr((void FAR *)code, 1));

    GlobalUnlock(smallBlock);
    GlobalUnlock(hugeBlock);
    GlobalFree(smallBlock);
    GlobalFree(hugeBlock);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
