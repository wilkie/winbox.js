/*
 * DOS's 69h, a disk's serial number, label and file system: AL 0 gets
 * them into DS:DX, AL 1 sets them from it. The buffer is a word of info
 * level, the serial's double word, the 11 bytes of the label and the 8 of
 * the file system's name: 25 bytes.
 *
 * KERNEL passes 69h to DOS as it came (`KRNL386.EXE` seg1 `1b98`-`1ba8`,
 * its table at `1a5a` sends 69h to `1bc7`, which calls the vector it kept at
 * `[cs:3Ch]`, `1d2a`); DOSX's table has no translation for it either way
 * (`kb/topics/drives-and-disks.md`).
 *
 * Mounted (`diskser.mounts`): A: a floppy image, D: a CD-ROM image. B: is
 * DOSBox's floppy drive with nothing in it; C: the installation's folder;
 * E: not there; Z: DOSBox's own.
 *
 * For drive numbers 0 (the current drive), 1 to 5 (A: to E:), 26 (Z:) and
 * 27 (past Z:), each a function named for its drive (`cur`, `a:` ... `z:`,
 * `past`):
 *
 * * `6900`: AX, BX, CX, DX and the carry after INT 21h AX 6900h, BL the
 *   drive, BH nought, CX 0C0Ch, DS:DX a buffer of 32 bytes, byte i of it
 *   A0h + i beforehand (`regcall.h`); then the buffer before the call and
 *   after it, in hexadecimal.
 *
 * Last, `calling` `6901 a:`, then `6901` of A:, the floppy image's copy
 * (never C:): the buffer info level nought, serial 12345678h, label
 * `WINBOX` and file system `FAT12`. DOSBox stops at this call
 * (`dos.cpp`), so the records are flushed one at a time.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "regcall.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\DISKSER.OUT"
#endif

#define BUFFER 32

static unsigned char buffer[BUFFER];

static const unsigned drives[] = {0, 1, 2, 3, 4, 5, 26, 27};

static void nameOf(unsigned drive, char *into)
{
    if (drive == 0) {
        lstrcpy(into, "cur");
    } else if (drive > 26) {
        lstrcpy(into, "past");
    } else {
        wsprintf(into, "%c:", 'a' + drive - 1);
    }
}

static char *hexOf(char *to)
{
    unsigned i;

    for (i = 0; i < BUFFER; i++) {
        wsprintf(to, "%02x", buffer[i]);
        to += 2;
    }

    return to;
}

static void serial(LPCSTR name, unsigned function, unsigned drive)
{
    unsigned char far *at = buffer;
    char before[BUFFER * 2 + 1];
    char *to;

    hexOf(before);

    regs.ax = function;
    regs.bx = drive;
    regs.cx = 0x0c0c;
    regs.dx = (unsigned)(unsigned long)at;
    regs.ds = (unsigned)((unsigned long)at >> 16);
    call21();
    regsText(probeResult);

    to = probeResult + lstrlen(probeResult);
    *to++ = ' ';
    lstrcpy(to, before);
    to += lstrlen(before);
    *to++ = ' ';
    hexOf(to);

    wsprintf(probeArgs, "%04x", function);
    probe(name, probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char label[11] = {'W', 'I', 'N', 'B', 'O', 'X', ' ', ' ', ' ', ' ', ' '};
    static const char system[8] = {'F', 'A', 'T', '1', '2', ' ', ' ', ' '};
    char name[8];
    unsigned i;
    unsigned j;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        for (j = 0; j < BUFFER; j++) {
            buffer[j] = (unsigned char)(0xa0 + j);
        }

        nameOf(drives[i], name);
        serial(name, 0x6900, drives[i]);
    }

    for (j = 0; j < BUFFER; j++) {
        buffer[j] = (unsigned char)(0xa0 + j);
    }

    buffer[0] = 0;
    buffer[1] = 0;
    buffer[2] = 0x78;
    buffer[3] = 0x56;
    buffer[4] = 0x34;
    buffer[5] = 0x12;

    for (j = 0; j < 11; j++) {
        buffer[6 + j] = (unsigned char)label[j];
    }

    for (j = 0; j < 8; j++) {
        buffer[17 + j] = (unsigned char)system[j];
    }

    probe("calling", "6901 a:", "yes");
    serial("a:", 0x6901, 1);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
