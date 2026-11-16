/*
 * The BIOS's video and disk interrupts and the Virtual DMA Services'
 * interrupt, `INT 10h`, `INT 13h` and `INT 4Bh`, as a Windows program
 * issues them in protected mode, and what it is answered. With no image
 * mounted; `biosintm` asks the same with a floppy image as A: and a hard
 * disk image as D: (`biosintm.mounts`).
 *
 * The calls are those programs of the catalog make: `INT 10h` 0Fh (the
 * video mode), 1A00h (the display combination, `DISPDIB.DLL`'s test for a
 * VGA), 12h with BL 10h (the EGA's information, which a Visual Basic
 * program asks after 1A00h), 1007h, 1015h and 1010h (a palette register, a DAC register read and
 * written, as a screen saver's DLL reads and changes the 16 colours);
 * `INT 4Bh` 8102h (the Virtual DMA Services' version); `INT 13h` 08h (a
 * drive's parameters, the Paradox engine's question of drive 80h) and 10h
 * (whether a drive is ready), and the functions around them, 00h, 01h and
 * 15h.
 *
 * Each call is made with every register set to a pattern, ES the probe's
 * own data, so that what it changes shows:
 *
 * * `int10`, `int13`, `int4b`: the registers given as args (AX, and BX, CX
 *   or DX where the function reads them); AX, BX, CX, DX, SI, DI after,
 *   whether ES is still the probe's -- where it is not, how far the base of
 *   the selector it holds is from KERNEL's `__0000H`'s, the first
 *   megabyte's -- and the carry.
 * * `bda`: the BIOS data area's byte 7Bh, whose bit 5 says the Virtual DMA
 *   Services are there.
 * * `dac`: a palette register's DAC register written (1010h) and read back
 *   (1015h), then written back as it was. DAC registers 40h and FFh, which
 *   no palette register names, are read as `int10` records.
 */

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\BIOSINT.OUT"
#endif

#define PROBE_FLUSH
#include "probe.h"

static UINT inAx, inBx, inCx, inDx;
static UINT outAx, outBx, outCx, outDx, outSi, outDi, outEs, outFlags;
static UINT ownEs;
static char esText[16];
static DWORD firstMegabyte;

DWORD FAR PASCAL GetSelectorBase(UINT);

static void int10(void)
{
    _asm {
        push si
        push di
        push bp
        push es
        mov ax, ds
        mov es, ax
        mov ownEs, ax
        mov ax, inAx
        mov bx, inBx
        mov cx, inCx
        mov dx, inDx
        mov si, 9abch
        mov di, 0def0h
        int 10h
        mov outAx, ax
        pushf
        pop ax
        mov outFlags, ax
        mov outBx, bx
        mov outCx, cx
        mov outDx, dx
        mov outSi, si
        mov outDi, di
        mov ax, es
        mov outEs, ax
        pop es
        pop bp
        pop di
        pop si
    }
}

static void int13(void)
{
    _asm {
        push si
        push di
        push bp
        push es
        mov ax, ds
        mov es, ax
        mov ownEs, ax
        mov ax, inAx
        mov bx, inBx
        mov cx, inCx
        mov dx, inDx
        mov si, 9abch
        mov di, 0def0h
        int 13h
        mov outAx, ax
        pushf
        pop ax
        mov outFlags, ax
        mov outBx, bx
        mov outCx, cx
        mov outDx, dx
        mov outSi, si
        mov outDi, di
        mov ax, es
        mov outEs, ax
        pop es
        pop bp
        pop di
        pop si
    }
}

static void int4b(void)
{
    _asm {
        push si
        push di
        push bp
        push es
        mov ax, ds
        mov es, ax
        mov ownEs, ax
        mov ax, inAx
        mov bx, inBx
        mov cx, inCx
        mov dx, inDx
        mov si, 9abch
        mov di, 0def0h
        int 4bh
        mov outAx, ax
        pushf
        pop ax
        mov outFlags, ax
        mov outBx, bx
        mov outCx, cx
        mov outDx, dx
        mov outSi, si
        mov outDi, di
        mov ax, es
        mov outEs, ax
        pop es
        pop bp
        pop di
        pop si
    }
}

static void ask(LPCSTR function, void (*call)(void), UINT ax, UINT bx, UINT cx, UINT dx)
{
    inAx = ax;
    inBx = bx;
    inCx = cx;
    inDx = dx;
    call();

    wsprintf(probeArgs, "ax=%04x bx=%04x cx=%04x dx=%04x", ax, bx, cx, dx);

    if (outEs == ownEs) {
        lstrcpy(esText, "kept");
    } else {
        wsprintf(esText, "%05lx", GetSelectorBase(outEs) - firstMegabyte);
    }

    wsprintf(probeResult, "ax=%04x bx=%04x cx=%04x dx=%04x si=%04x di=%04x es=%s carry=%u",
             outAx, outBx, outCx, outDx, outSi, outDi, (LPSTR)esText, outFlags & 1);
    probe(function, probeArgs, probeResult);
}

/* The registers 1015h answers a DAC register in: DH red, CH green, CL
 * blue. */
static UINT dacRed, dacGreen, dacBlue;

static void readDac(UINT index)
{
    inAx = 0x1015;
    inBx = index;
    inCx = 0x5678;
    inDx = 0x1234;
    int10();
    dacRed = outDx >> 8;
    dacGreen = outCx >> 8;
    dacBlue = outCx & 0xff;
}

static void writeDac(UINT index, UINT red, UINT green, UINT blue)
{
    inAx = 0x1010;
    inBx = index;
    inCx = (green << 8) | blue;
    inDx = red << 8;
    int10();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const UINT drives[] = {0x00, 0x01, 0x80, 0x81};
    UINT i, attribute, red, green, blue;
    BYTE FAR *bios;
    FARPROC selector0040;

    probeOpen(OUTPUT);

    firstMegabyte = GetSelectorBase(
        LOWORD((DWORD)GetProcAddress(GetModuleHandle("KERNEL"), "__0000H")));

    /* The video BIOS. */
    ask("int10", int10, 0x0f00, 0x1234, 0x5678, 0x9abc);
    ask("int10", int10, 0x1a00, 0x1234, 0x5678, 0x9abc);
    ask("int10", int10, 0x1200, 0x1210, 0x5678, 0x9abc);

    for (i = 0; i < 16; i++) {
        ask("int10", int10, 0x1007, i | 0x1200, 0x5678, 0x9abc);
    }

    for (i = 0; i < 16; i++) {
        inAx = 0x1007;
        inBx = i;
        inCx = 0x5678;
        inDx = 0x9abc;
        int10();
        attribute = outBx >> 8;
        ask("int10", int10, 0x1015, attribute, 0x5678, 0x1234);
    }

    /* DAC registers no palette register names. */
    ask("int10", int10, 0x1015, 0x40, 0x5678, 0x1234);
    ask("int10", int10, 0x1015, 0xff, 0x5678, 0x1234);

    /* A DAC register changed and read back: palette register 1's. */
    inAx = 0x1007;
    inBx = 1;
    int10();
    attribute = outBx >> 8;
    readDac(attribute);
    red = dacRed;
    green = dacGreen;
    blue = dacBlue;
    writeDac(attribute, 0x3f, 0x15, 0x2a);
    readDac(attribute);
    wsprintf(probeArgs, "%02x 3f 15 2a", attribute);
    wsprintf(probeResult, "%02x %02x %02x", dacRed, dacGreen, dacBlue);
    probe("dac", probeArgs, probeResult);
    writeDac(attribute, red, green, blue);
    readDac(attribute);
    wsprintf(probeArgs, "%02x %02x %02x %02x", attribute, red, green, blue);
    wsprintf(probeResult, "%02x %02x %02x", dacRed, dacGreen, dacBlue);
    probe("dac", probeArgs, probeResult);

    /* The Virtual DMA Services. */
    selector0040 = GetProcAddress(GetModuleHandle("KERNEL"), "__0040H");
    bios = (BYTE FAR *)MAKELP(LOWORD((DWORD)selector0040), 0);
    wsprintf(probeResult, "%02x", bios[0x7b]);
    probe("bda", "7b", probeResult);
    ask("int4b", int4b, 0x8102, 0x1234, 0x5678, 0x0000);

    /* The disk BIOS: each drive's parameters, its status, whether it is
     * ready, its type and a reset. */
    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        ask("int13", int13, 0x0800, 0x1234, 0x5678, drives[i] | 0x1200);
        ask("int13", int13, 0x0100, 0x1234, 0x5678, drives[i] | 0x1200);
        ask("int13", int13, 0x1000, 0x1234, 0x5678, drives[i] | 0x1200);
        ask("int13", int13, 0x0100, 0x1234, 0x5678, drives[i] | 0x1200);
        ask("int13", int13, 0x1500, 0x1234, 0x5678, drives[i] | 0x1200);
        ask("int13", int13, 0x0000, 0x1234, 0x5678, drives[i] | 0x1200);
        ask("int13", int13, 0x0100, 0x1234, 0x5678, drives[i] | 0x1200);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
