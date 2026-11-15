/*
 * `INT 25h` and `INT 26h`, absolute disk read and write, as a Windows
 * program is answered them, of each drive: A: a floppy image, C:, D: a
 * CD-ROM image, E: not there, Z: (`abssect.mounts`); A:, a floppy image,
 * is mounted but not asked.
 *
 * DOSBox's handlers read and write nothing: a drive not mounted answers AX
 * 8002h with the carry set, any other the carry clear and AX nought
 * (`dos.cpp` 1095-1118). Both return with the flags still on the stack,
 * which the caller pops.
 *
 * * `read` and `write`: AL the drive from nought for A:, CX 1, DX 0 (the
 *   boot sector), DS:BX a buffer of 512 bytes patterned 30h, 31h, ...:
 *   AX after, the carry of the flags returned in and of the flags left
 *   on the stack, how far SP came back less, whether the buffer was
 *   written, and its bytes 0-3, 11, 12, 21 and 510.
 * * `big`: the same with CX FFFFh, DS:BX a packet of start sector, count
 *   and buffer, as DOS 4 and later read a large volume.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ABSSECT.OUT"

static BYTE buffer[512];

static struct {
    DWORD sector;
    WORD count;
    BYTE FAR *buffer;
} packet;

static UINT outAx, outFlags, outPushed, outDepth;

static void fill(void)
{
    unsigned i;

    for (i = 0; i < sizeof buffer; i++) {
        buffer[i] = (BYTE)(0x30 + i);
    }
}

static int written(void)
{
    unsigned i;

    for (i = 0; i < sizeof buffer; i++) {
        if (buffer[i] != (BYTE)(0x30 + i)) {
            return 1;
        }
    }

    return 0;
}

static void absolute(UINT vector, UINT drive, UINT count, UINT place)
{
    UINT ra, flg, pushed, before, after;

    fill();

    if (vector == 0x25) {
        _asm {
            push si
            push di
            push bp
            mov before, sp
            mov ax, drive
            mov cx, count
            mov dx, 0
            mov bx, place
            int 25h
            mov ra, ax
            pushf
            pop ax
            mov flg, ax
            mov after, sp
            pop ax
            mov pushed, ax
            pop bp
            pop di
            pop si
        }
    } else {
        _asm {
            push si
            push di
            push bp
            mov before, sp
            mov ax, drive
            mov cx, count
            mov dx, 0
            mov bx, place
            int 26h
            mov ra, ax
            pushf
            pop ax
            mov flg, ax
            mov after, sp
            pop ax
            mov pushed, ax
            pop bp
            pop di
            pop si
        }
    }

    outAx = ra;
    outFlags = flg;
    outPushed = pushed;
    outDepth = before - after;
}

static void record(LPCSTR function, UINT drive)
{
    wsprintf(probeArgs, "%u", drive);
    wsprintf(probeResult, "ax=%04x carry=%u pushed=%u depth=%u buffer=%s %02x %02x %02x %02x %02x %02x %02x %02x",
             outAx, outFlags & 1, outPushed & 1, outDepth,
             (LPSTR)(written() ? "written" : "untouched"), buffer[0], buffer[1], buffer[2],
             buffer[3], buffer[11], buffer[12], buffer[21], buffer[510]);
    probe(function, probeArgs, probeResult);
}

/* A:, a floppy image, is not asked: under Windows the first INT 25h of it
 * never returned, the machine stopping there. */
static const UINT drives[] = {2, 25, 4, 3};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned i;
    UINT near_buffer = (UINT)(DWORD)(BYTE FAR *)buffer;
    UINT near_packet = (UINT)(DWORD)(void FAR *)&packet;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        absolute(0x25, drives[i], 1, near_buffer);
        record("read", drives[i]);
    }

    packet.sector = 0;
    packet.count = 1;
    packet.buffer = buffer;

    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        absolute(0x25, drives[i], 0xffff, near_packet);
        record("big", drives[i]);
    }

    /* Written last, and only to the floppy image's copy and drives DOSBox
     * writes nothing to. */
    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        absolute(0x26, drives[i], 1, near_buffer);
        record("write", drives[i]);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
