/*
 * `_lwrite`, `_lread` and DOS's own write and read (`INT 21h` 40h and 3Fh)
 * with a buffer that runs past the end of its segment's first 64 KiB: a
 * block of 128 KiB, its first selector's limit the whole block, written
 * from offset F000h for F000h bytes, as Paintbrush saves a picture of
 * 141,440 bytes in 61,440-byte pieces through one far pointer moved on.
 *
 * The block's bytes say where they are: each KiB of the first 64 holds its
 * number, 00h to 3Fh, and each of the second 64 its number and 40h, 40h to
 * 7Fh. A byte from past offset FFFFh is 40h or more where it was taken
 * from the second 64 KiB, and under 40h where the offset went round.
 *
 * Records:
 *
 * * `write`: what the call answered, the file's size, then its bytes at
 *   0FFFh, 1000h and EFFFh -- where the buffer's offsets FFFFh, 10000h and
 *   1EFFFh went.
 * * `read`: what the call answered, then the block's bytes, after a file
 *   of 55h bytes was read into it from F000h, at offset FFFFh through the
 *   first selector, at nought through the next (`__AHINCR`) and at nought
 *   through the first -- 55h where it was read into, else as filled.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LWRHUGE.OUT"
#define DATA "C:\\ORACLE\\LWRHUGE.DAT"

extern WORD _AHINCR;

static WORD selector;

/* Each KiB its number, as above. */
static void fill(void)
{
    BYTE __huge *at = (BYTE __huge *)MAKELP(selector, 0);
    long i;

    for (i = 0; i < 0x20000L; i++) {
        at[i] = (BYTE)(i >> 10);
    }
}

/* A byte of the block through a selector, the first or the next. */
static BYTE byteAt(WORD step, WORD offset)
{
    return *(BYTE FAR *)MAKELP(selector + step, offset);
}

/* DOS's function 40h or 3Fh on the handle, CX bytes at DS:DX: what AX
 * came back with, or FFFFh with the carry set. */
static WORD dos(BYTE function, HFILE handle, WORD at, WORD count)
{
    WORD answer = 0;
    WORD segment = selector;
    WORD failed = 0;

    _asm {
        push ds
        mov ah, function
        mov bx, handle
        mov cx, count
        mov dx, at
        mov ds, segment
        int 21h
        pop ds
        mov answer, ax
        sbb ax, ax
        mov failed, ax
    }

    return failed ? 0xffff : answer;
}

/* The file's byte at a place. */
static BYTE fileAt(HFILE file, LONG at)
{
    BYTE one = 0xee;

    _llseek(file, at, 0);
    _lread(file, &one, 1);
    return one;
}

/* The file's size and its bytes at three places, written as the record's
 * tail. */
static void written(LPCSTR name, WORD answer)
{
    HFILE file = _lopen(DATA, OF_READ);
    LONG size = _llseek(file, 0L, 2);
    BYTE first = fileAt(file, 0xfffL);
    BYTE second = fileAt(file, 0x1000L);
    BYTE last = fileAt(file, 0xefffL);

    _lclose(file);
    wsprintf(probeResult, "%x %lx %02x %02x %02x", answer, size, first, second, last);
    probe("write", name, probeResult);
}

static void writeWith(LPCSTR name, BOOL viaDos)
{
    HFILE file = _lcreat(DATA, 0);
    WORD answer;

    if (viaDos) {
        answer = dos(0x40, file, 0xf000, 0xf000);
    } else {
        answer = _lwrite(file, (LPCSTR)MAKELP(selector, 0xf000), 0xf000);
    }

    _lclose(file);
    written(name, answer);
}

static void readWith(LPCSTR name, BOOL viaDos)
{
    static BYTE pattern[0x400];
    HFILE file = _lcreat(DATA, 0);
    WORD answer;
    int i;

    for (i = 0; i < sizeof(pattern); i++) {
        pattern[i] = 0x55;
    }

    for (i = 0; i < 0x3c; i++) {
        _lwrite(file, (LPCSTR)pattern, sizeof(pattern));
    }

    _lclose(file);
    fill();

    file = _lopen(DATA, OF_READ);

    if (viaDos) {
        answer = dos(0x3f, file, 0xf000, 0xf000);
    } else {
        answer = _lread(file, (LPSTR)MAKELP(selector, 0xf000), 0xf000);
    }

    _lclose(file);
    wsprintf(probeResult, "%x %02x %02x %02x", answer, byteAt(0, 0xffff),
             byteAt((WORD)(&_AHINCR), 0), byteAt(0, 0));
    probe("read", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_MOVEABLE, 0x20000L);
    selector = HIWORD((DWORD)GlobalLock(block));
    fill();

    wsprintf(probeResult, "%lx", GetSelectorLimit(selector));
    probe("limit", "first", probeResult);

    writeWith("lwrite", FALSE);
    writeWith("int21", TRUE);
    readWith("lread", FALSE);
    readWith("int21", TRUE);

    GlobalUnlock(block);
    GlobalFree(block);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
