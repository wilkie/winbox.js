/*
 * What DOS answers about each drive by IOCTL, and what `GetDriveType` makes
 * of it. SYSTEM.DRV's `InquireSystem` (`SYSTEM.DRV` seg1 `0002`), which
 * KERNEL's `GetDriveType` asks, selects the drive (0Eh, 19h), then asks
 * 4409h (remote: bit 12 of DX), 4408h (AX bit 0: fixed), and 440Eh, and
 * falls back on the BIOS's equipment word for A: and B:.
 *
 * Mounted (`drvioctl.mounts`): B: a floppy image, D: a CD-ROM image. A:
 * is DOSBox's floppy drive with nothing mounted; C: the installation's
 * folder; Z: DOSBox's own.
 *
 * For drive numbers 0 (the current drive), 1 to 5 (A: to E:), 26 (Z:) and
 * 27 (past Z:), each a function named for its drive (`cur`, `a:` ... `z:`,
 * `past`), args the call:
 *
 * * `4408`, `4409`, `440e`: AX, BX, CX, DX and the carry after INT 21h
 *   (`regcall.h`), BL the drive, BH nought, CX 0C0Ch and DX 0D0Dh before.
 * * `440d <cx>`: the same for a generic block device request, CX 0860h (get
 *   device parameters), 0866h (get media id), 0846h (the same, category
 *   08h) and 0867h, DS:DX a buffer of 40 bytes of CCh; then the buffer in
 *   hexadecimal.
 * * `type`: `GetDriveType` of the drive, counted from nought for A: (the
 *   current drive and past Z: as their numbers less one).
 */

#include "probe.h"
#include "regcall.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\DRVIOCTL.OUT"
#endif

#define BUFFER 40

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

static void simple(LPCSTR name, unsigned function, unsigned drive)
{
    regs.ax = function;
    regs.bx = drive;
    regs.cx = 0x0c0c;
    regs.dx = 0x0d0d;
    regs.ds = 0;
    call21();
    regsText(probeResult);
    wsprintf(probeArgs, "%04x", function);
    probe(name, probeArgs, probeResult);
}

static void block(LPCSTR name, unsigned code, unsigned drive)
{
    unsigned char far *at = buffer;
    char *to;
    unsigned i;

    for (i = 0; i < BUFFER; i++) {
        buffer[i] = 0xcc;
    }

    regs.ax = 0x440d;
    regs.bx = drive;
    regs.cx = code;
    regs.dx = (unsigned)(unsigned long)at;
    regs.ds = (unsigned)((unsigned long)at >> 16);
    call21();
    regsText(probeResult);

    /* DX is the buffer's own offset: not the answer, and set to it. */
    to = probeResult + lstrlen(probeResult);
    *to++ = ' ';

    for (i = 0; i < BUFFER; i++) {
        wsprintf(to, "%02x", buffer[i]);
        to += 2;
    }

    wsprintf(probeArgs, "440d %04x", code);
    probe(name, probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const unsigned codes[] = {0x0860, 0x0866, 0x0846, 0x0867};
    char name[8];
    unsigned i;
    unsigned c;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        unsigned drive = drives[i];

        nameOf(drive, name);
        simple(name, 0x4408, drive);
        simple(name, 0x4409, drive);

        for (c = 0; c < sizeof codes / sizeof codes[0]; c++) {
            block(name, codes[c], drive);
        }

        simple(name, 0x440e, drive);

        wsprintf(probeResult, "%u", GetDriveType((int)drive - 1));
        probe(name, "type", probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
