/*
 * DOS's function 59h, get extended error, after calls that fail and after
 * one that does not: what a program asking it after a failed path call
 * reads (the Visual Basic setup kit's `SETUP1.EXE` does, after its folder
 * call fails).
 *
 * KERNEL passes 59h on to DOS as it passes most functions (its table at
 * `KRNL386.EXE` seg1 `1a5a`, 59h's entry `1bc7`), and DOSBox's DOS answers
 * AX its last error, BH 8 (not found) for 2 and 3 and nought for another,
 * BL 1 and CH nought (`dos.cpp` 843-852); its error is what the last call
 * that failed set (`DOS_SetError`, 41-43), a call that succeeds setting
 * none.
 *
 * In `C:\ORACLE\EE`, made first, with the file `F.TXT` in it.
 *
 * Each record is one call, then 59h with BX nought, CX CCCCh and DX DDDDh:
 * its name, and the registers after 59h ("AX BX CX DX c"). A call through
 * KERNEL also gives its own answer, and `OpenFile` its `nErrCode`; each
 * comes after a close of a handle not open (error 6), so an error of its
 * own shows.
 */

#include "probe.h"
#include "regcall.h"

#define OUTPUT "C:\\ORACLE\\EXTERR.OUT"

static char folder[] = "C:\\ORACLE\\EE";
static char file[] = "C:\\ORACLE\\EE\\F.TXT";
static char none[] = "C:\\ORACLE\\EE\\NONE.TXT";
static char noFolder[] = "C:\\ORACLE\\EE\\NOSUCH";
static char inNoFolder[] = "C:\\ORACLE\\EE\\NOSUCH\\X.TXT";
static char pattern[] = "C:\\ORACLE\\EE\\*.XYZ";

static BYTE area[64];

static void name(unsigned function, char *path, unsigned cx)
{
    regs.ax = function;
    regs.bx = 0x0b0b;
    regs.cx = cx;
    regs.dx = (unsigned)(DWORD)(char FAR *)path;
    regs.ds = 0;
    call21();
}

/* A close of a handle not open, failing with error 6, before each call
 * through KERNEL: an error that call's own would differ from. */
static void unopened(void)
{
    regs.ax = 0x3e00;
    regs.bx = 0xf0;
    call21();
}

/* 59h, and the record of what came before it. */
static void extended(LPCSTR call, LPCSTR answer)
{
    regs.ax = 0x5900;
    regs.bx = 0;
    regs.cx = 0xcccc;
    regs.dx = 0xdddd;
    regs.ds = 0;
    call21();
    regsText(probeResult);
    if (answer) {
        lstrcat(probeResult, " ");
        lstrcat(probeResult, answer);
    }
    probe("59h", call, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT of;
    char answer[64];
    HFILE handle;

    probeOpen(OUTPUT);

    name(0x3900, folder, 0);
    name(0x3c00, file, 0);
    handle = regs.ax;
    regs.ax = 0x3e00;
    regs.bx = handle;
    call21();

    regs.ax = 0x1a00;
    regs.dx = (unsigned)(DWORD)(BYTE FAR *)area;
    regs.ds = 0;
    call21();

    name(0x3d00, none, 0);
    extended("3d00 NONE.TXT", NULL);
    extended("59h again", NULL);
    name(0x4300, file, 0);
    extended("4300 F.TXT, found", NULL);

    name(0x3900, folder, 0);
    extended("3900 EE, there", NULL);
    name(0x3b00, noFolder, 0);
    extended("3b00 NOSUCH", NULL);
    name(0x4300, noFolder, 0);
    extended("4300 NOSUCH", NULL);
    name(0x3d00, inNoFolder, 0);
    extended("3d00 NOSUCH\\X.TXT", NULL);
    name(0x3900, inNoFolder, 0);
    extended("3900 NOSUCH\\X.TXT", NULL);
    unopened();
    extended("3e00 f0", NULL);
    name(0x4e00, pattern, 0);
    extended("4e00 *.XYZ", NULL);
    name(0x3a00, noFolder, 0);
    extended("3a00 NOSUCH", NULL);
    name(0x4100, none, 0);
    extended("4100 NONE.TXT", NULL);

    unopened();
    handle = _lopen(none, OF_READ);
    wsprintf(answer, "%04x", handle);
    extended("_lopen NONE.TXT", answer);
    unopened();
    handle = _lopen(inNoFolder, OF_READ);
    wsprintf(answer, "%04x", handle);
    extended("_lopen NOSUCH\\X.TXT", answer);
    unopened();
    handle = _lcreat(inNoFolder, 0);
    wsprintf(answer, "%04x", handle);
    extended("_lcreat NOSUCH\\X.TXT", answer);
    unopened();
    handle = _lopen(file, OF_READ);
    wsprintf(answer, "%04x", handle == HFILE_ERROR ? 0xffff : 0);
    if (handle != HFILE_ERROR) {
        _lclose(handle);
    }
    extended("_lopen F.TXT, found", answer);

    unopened();
    handle = OpenFile(none, &of, OF_READ);
    wsprintf(answer, "%04x %04x", handle, of.nErrCode);
    extended("OpenFile NONE.TXT", answer);
    unopened();
    handle = OpenFile(inNoFolder, &of, OF_READ);
    wsprintf(answer, "%04x %04x", handle, of.nErrCode);
    extended("OpenFile NOSUCH\\X.TXT", answer);
    unopened();
    handle = OpenFile(none, &of, OF_EXIST);
    wsprintf(answer, "%04x %04x", handle, of.nErrCode);
    extended("OpenFile NONE.TXT OF_EXIST", answer);
    unopened();
    handle = OpenFile("EXTNONE.XYZ", &of, OF_READ);
    wsprintf(answer, "%04x %04x", handle, of.nErrCode);
    extended("OpenFile EXTNONE.XYZ", answer);
    unopened();
    handle = OpenFile(inNoFolder, &of, OF_CREATE);
    wsprintf(answer, "%04x %04x", handle, of.nErrCode);
    extended("OpenFile NOSUCH\\X.TXT OF_CREATE", answer);

    name(0x4100, file, 0);
    name(0x3a00, folder, 0);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
