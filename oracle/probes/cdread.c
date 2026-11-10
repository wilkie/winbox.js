/*
 * How long a read from a CD-ROM takes a program by `timeGetTime`, set
 * against a read from the hard disk and against how fast the processor
 * runs: a program that times its reads of a disc to tell the drive's speed
 * sees what is recorded here. Recorded at a fixed rate (`--cycles 80000`),
 * in 386 enhanced mode and in standard mode, with `images/imgread.iso` as
 * D: (`cdread.mounts`): `READ.DAT`, 256 KiB. Timings, not answers: kept in
 * `fixtures/timings/`, not replayed.
 *
 * * `rate`: `callcost`'s `alu` workload, as instructions a millisecond,
 *   the passes and the milliseconds, for telling a time as instructions.
 * * `once`: a read of a size, made alone after a seek, as a program times
 *   one: `mmioSeek` to its place, `timeGetTime`, `mmioRead`, `timeGetTime`;
 *   the bytes read and the milliseconds between the two times. The drive
 *   and the size are its arguments, then the read's number.
 * * `many`: reads of a size made one after another, from the file's start,
 *   until a second by `timeGetTime` has passed: the reads, the bytes and
 *   the milliseconds, and the bytes a millisecond.
 * * `first`: the first eight bytes of the first read of each file, to show
 *   it read the file meant.
 *
 * The hard disk's file is `C:\ORACLE\CDREAD.DAT`, 256 KiB the probe writes
 * first, the same bytes as `READ.DAT`.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\CDREAD.OUT"
#define DISC "D:\\READ.DAT"
#define DISK "C:\\ORACLE\\CDREAD.DAT"
#define FILE_SIZE 262144L

static BYTE __huge *buffer;

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

/* READ.DAT's bytes: each 2,048-byte sector its number as `R` and five
 * hexadecimal digits, CR and LF, repeated. */
static void writeDisk(void)
{
    static char line[9];
    HFILE file = _lcreat(DISK, 0);
    long sector;
    int i;

    for (sector = 0; sector < FILE_SIZE / 2048; sector++) {
        wsprintf(line, "R%05lx\r\n", sector);

        for (i = 0; i < 2048 / 8; i++) {
            lstrcpy((LPSTR)buffer + i * 8, line);
        }

        _lwrite(file, (LPCSTR)buffer, 2048);
    }

    _lclose(file);
}

static void first(LPCSTR path, HMMIO h)
{
    LONG got;

    mmioSeek(h, 0, SEEK_SET);
    got = mmioRead(h, (HPSTR)buffer, 8);
    wsprintf(probeResult, "%ld,%02x%02x%02x%02x%02x%02x%02x%02x", got, buffer[0], buffer[1],
             buffer[2], buffer[3], buffer[4], buffer[5], buffer[6], buffer[7]);
    probe("first", path, probeResult);
}

static void once(LPCSTR drive, HMMIO h, long size, int times)
{
    int n;

    for (n = 1; n <= times; n++) {
        DWORD before;
        DWORD after;
        LONG got;

        mmioSeek(h, ((long)n * 16384L) % (FILE_SIZE - size), SEEK_SET);
        before = timeGetTime();
        got = mmioRead(h, (HPSTR)buffer, size);
        after = timeGetTime();
        wsprintf(probeArgs, "%s,%ld,%d", drive, size, n);
        wsprintf(probeResult, "%ld,%ld", got, (long)(after - before));
        probe("once", probeArgs, probeResult);
    }
}

static void many(LPCSTR drive, HMMIO h, long size)
{
    DWORD start;
    DWORD elapsed;
    long reads = 0;
    long bytes = 0;
    long at = 0;

    start = timeGetTime();

    do {
        if (at + size > FILE_SIZE) {
            at = 0;
        }

        mmioSeek(h, at, SEEK_SET);
        bytes += mmioRead(h, (HPSTR)buffer, size);
        at += size;
        reads++;
        elapsed = timeGetTime() - start;
    } while (elapsed < 1000);

    wsprintf(probeArgs, "%s,%ld", drive, size);
    wsprintf(probeResult, "%ld,%ld,%ld,%ld", reads, bytes, (long)elapsed, bytes / (long)elapsed);
    probe("many", probeArgs, probeResult);
}

static void drive(LPCSTR name, LPSTR path)
{
    static const long sizes[] = {2048L, 16384L, 32768L, 65535L};
    HMMIO h = mmioOpen(path, NULL, MMIO_READ);
    int i;

    if (h == NULL) {
        probe("open", path, "fail");
        return;
    }

    first(path, h);

    for (i = 0; i < 4; i++) {
        once(name, h, sizes[i], 5);
    }

    for (i = 0; i < 4; i++) {
        many(name, h, sizes[i]);
    }

    mmioClose(h, 0);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char disc[] = DISC;
    static char disk[] = DISK;
    HGLOBAL block;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_MOVEABLE, 65536L);
    buffer = (BYTE __huge *)GlobalLock(block);

    rate();
    writeDisk();
    drive("D", disc);
    drive("C", disk);

    GlobalUnlock(block);
    GlobalFree(block);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
