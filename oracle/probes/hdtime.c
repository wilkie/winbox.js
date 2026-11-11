/*
 * How long reads and writes of a file on the hard disk take a program by
 * `timeGetTime`, at more sizes than `cdread` and through each way a program
 * reads -- `_lread`, `_hread` and DOS's function 3Fh -- and writes --
 * `_lwrite` and DOS's 40h; and a seek, and an open and a close. Recorded at
 * a fixed rate (`--cycles 80000`), in 386 enhanced mode and in standard
 * mode, for the instructions Windows spends on each. Timings, not answers:
 * kept in `fixtures/timings/`, not replayed.
 *
 * Each measure is made over and over until half a second by `timeGetTime`
 * has passed: the times made, the bytes, and the milliseconds.
 *
 * * `rate`: `callcost`'s `alu` workload, as instructions a millisecond,
 *   the passes and the milliseconds, for telling a time as instructions.
 * * `empty`: the loop alone, `timeGetTime` and nothing else, its own time
 *   in each of the others.
 * * `read`: the way, then the size: reads one after another from the
 *   file's start, `_llseek` back to it where the next would pass its end
 *   (256 KiB), as seldom as once in 512 reads or as often as every fourth.
 * * `write`: the same for writes, to a second file of 256 KiB.
 * * `seek`: `_llseek` to the file's start.
 * * `open`: `_lopen` of the file to read, then `_lclose`.
 *
 * The buffer is a block of 64 KiB, read into and written from at its
 * offset nought. The file read is `C:\ORACLE\HDTIME.DAT`, which the probe
 * writes first; the file written `C:\ORACLE\HDTIME.WR`.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\HDTIME.OUT"
#define DATA "C:\\ORACLE\\HDTIME.DAT"
#define WRITTEN "C:\\ORACLE\\HDTIME.WR"
#define FILE_SIZE 262144L
#define SPAN 500

#define WAY_LREAD 0
#define WAY_HREAD 1
#define WAY_DOS 2

static BYTE __huge *buffer;
static WORD selector;

static void passAlu(void)
{
    _asm {
        mov cx, 65535
        mov bx, 3
        mov dx, 5
    top:
        add ax, bx
        sub ax, cx
        xor ax, dx
        and ax, bx
        or ax, cx
        shl ax, 1
        inc ax
        dec ax
        loop top
    }
}

static void rate(void)
{
    int run;

    for (run = 1; run <= 3; run++) {
        DWORD start = GetTickCount();
        DWORD elapsed;
        long passes = 0;

        do {
            passAlu();
            passes++;
            elapsed = GetTickCount() - start;
        } while (elapsed < 2000);

        wsprintf(probeArgs, "alu,%d", run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((passes * 65535L * 9L) / (long)elapsed),
                 passes, (long)elapsed);
        probe("rate", probeArgs, probeResult);
    }
}

/* DOS's function 3Fh or 40h on the handle, `count` bytes at the buffer's
 * start: what AX answered, or FFFFh where carry was set. */
static WORD dos(BYTE function, HFILE handle, WORD count)
{
    WORD answer = 0;
    WORD segment = selector;
    WORD failed = 0;

    _asm {
        push ds
        mov ah, function
        mov bx, handle
        mov cx, count
        xor dx, dx
        mov ds, segment
        int 21h
        pop ds
        mov answer, ax
        sbb ax, ax
        mov failed, ax
    }

    return failed ? 0xffff : answer;
}

static void writeData(void)
{
    HFILE file = _lcreat(DATA, 0);
    long at;

    for (at = 0; at < FILE_SIZE; at += 32768L) {
        _lwrite(file, (LPCSTR)buffer, 32768U);
    }

    _lclose(file);
}

static void empty(void)
{
    DWORD start = timeGetTime();
    DWORD elapsed;
    long times = 0;

    do {
        times++;
        elapsed = timeGetTime() - start;
    } while (elapsed < SPAN);

    wsprintf(probeResult, "%ld,0,%ld", times, (long)elapsed);
    probe("empty", "", probeResult);
}

static const char *wayNames[] = {"lread", "hread", "dos"};

static void timeRead(HFILE file, int way, WORD size)
{
    DWORD start;
    DWORD elapsed;
    long times = 0;
    long bytes = 0;
    long at = 0;

    _llseek(file, 0, 0);
    start = timeGetTime();

    do {
        if (at + (long)size > FILE_SIZE) {
            _llseek(file, 0, 0);
            at = 0;
        }

        switch (way) {
        case WAY_LREAD: bytes += _lread(file, (LPVOID)buffer, size); break;
        case WAY_HREAD: bytes += _hread(file, (void __huge *)buffer, (long)size); break;
        default: bytes += dos(0x3f, file, size); break;
        }

        at += size;
        times++;
        elapsed = timeGetTime() - start;
    } while (elapsed < SPAN);

    wsprintf(probeArgs, "%s,%u", (LPSTR)wayNames[way], size);
    wsprintf(probeResult, "%ld,%ld,%ld", times, bytes, (long)elapsed);
    probe("read", probeArgs, probeResult);
}

static void timeWrite(HFILE file, int way, WORD size)
{
    DWORD start;
    DWORD elapsed;
    long times = 0;
    long bytes = 0;
    long at = 0;

    _llseek(file, 0, 0);
    start = timeGetTime();

    do {
        if (at + (long)size > FILE_SIZE) {
            _llseek(file, 0, 0);
            at = 0;
        }

        if (way == WAY_LREAD) {
            bytes += _lwrite(file, (LPCSTR)buffer, size);
        } else {
            bytes += dos(0x40, file, size);
        }

        at += size;
        times++;
        elapsed = timeGetTime() - start;
    } while (elapsed < SPAN);

    wsprintf(probeArgs, "%s,%u", (LPSTR)(way == WAY_LREAD ? "lwrite" : "dos"), size);
    wsprintf(probeResult, "%ld,%ld,%ld", times, bytes, (long)elapsed);
    probe("write", probeArgs, probeResult);
}

static void seek(HFILE file)
{
    DWORD start = timeGetTime();
    DWORD elapsed;
    long times = 0;

    do {
        _llseek(file, 0, 0);
        times++;
        elapsed = timeGetTime() - start;
    } while (elapsed < SPAN);

    wsprintf(probeResult, "%ld,0,%ld", times, (long)elapsed);
    probe("seek", "", probeResult);
}

static void openClose(void)
{
    DWORD start = timeGetTime();
    DWORD elapsed;
    long times = 0;

    do {
        _lclose(_lopen(DATA, OF_READ));
        times++;
        elapsed = timeGetTime() - start;
    } while (elapsed < SPAN);

    wsprintf(probeResult, "%ld,0,%ld", times, (long)elapsed);
    probe("open", "", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const WORD readSizes[] = {512,   1024,  2048,  4096,  8192,
                                     16384, 24576, 32768, 49152, 65534U};
    static const WORD writeSizes[] = {512, 2048, 8192, 32768U, 65534U};
    HGLOBAL block;
    HFILE file;
    int way;
    int i;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 65536L);
    buffer = (BYTE __huge *)GlobalLock(block);
    selector = SELECTOROF(buffer);

    rate();
    writeData();
    empty();

    file = _lopen(DATA, OF_READ);

    for (way = WAY_LREAD; way <= WAY_DOS; way++) {
        for (i = 0; i < 10; i++) {
            timeRead(file, way, readSizes[i]);
        }
    }

    seek(file);
    _lclose(file);
    openClose();

    file = _lcreat(WRITTEN, 0);

    for (way = WAY_LREAD; way <= WAY_HREAD; way++) {
        for (i = 0; i < 5; i++) {
            timeWrite(file, way, writeSizes[i]);
        }
    }

    _lclose(file);
    empty();

    GlobalUnlock(block);
    GlobalFree(block);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
