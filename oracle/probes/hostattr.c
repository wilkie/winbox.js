/*
 * Attributes on DOSBox's C:, a folder of the host's: what 4301h does to a
 * file and a folder, what a search and 4300h then give, and the error
 * 4301h answers for a name that is not there.
 *
 * DOSBox's `DOS_SetFileAttr` sets nothing: it only asks the drive for the
 * attributes (`dos_files.cpp` 643-656), and `localDrive::GetFileAttr`
 * sets no error where the host's `stat` fails (`drive_local.cpp` 287-302),
 * so 4301h of a name not there answers whatever error DOS held before
 * (`dos.cpp` 642-651). A search gives a folder 10h and a file 20h, from
 * the host's `stat` (`localDrive::FindNext`, 255-266).
 *
 * In `C:\ORACLE\HA`: `F.TXT`, made with 3Ch and CX 0, `RO.TXT`, made
 * with CX 1 (read-only), and the folder `SUB`.
 *
 * * `make`: 3Ch of each file with its CX, and 39h of the folder: the
 *   registers after (`regcall.h`).
 * * `set`: 4301h of a name with CX: the registers after, AX 4301h and DX
 *   the name before.
 * * `get`: 4300h of a name: the registers after, CX 0C0Ch before.
 * * `find`: a search of `*.*` with the attributes given: each name found
 *   and its attributes.
 * * `open`: 3D02h, read and write, of `F.TXT` set read-only: the
 *   registers after; then a byte written and the file closed.
 * * `missing`: 4301h of a name not there after a call that failed with
 *   the error given (2, by 3D00h of a file not there; 3, by 3Bh of a
 *   folder not there): the registers after.
 */

#include "probe.h"
#include "regcall.h"

#define OUTPUT "C:\\ORACLE\\HOSTATTR.OUT"

static char folder[] = "C:\\ORACLE\\HA";
static char file[] = "C:\\ORACLE\\HA\\F.TXT";
static char readOnly[] = "C:\\ORACLE\\HA\\RO.TXT";
static char sub[] = "C:\\ORACLE\\HA\\SUB";
static char pattern[] = "C:\\ORACLE\\HA\\*.*";
static char none[] = "C:\\ORACLE\\HA\\NONE.TXT";
static char noFolder[] = "C:\\ORACLE\\NOSUCH\\X.TXT";
static char noPath[] = "C:\\ORACLE\\NOSUCH";

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

static void record(LPCSTR function, LPCSTR args)
{
    regsText(probeResult);
    probe(function, args, probeResult);
}

static void find(unsigned asked)
{
    char *out = probeResult;
    unsigned handle = 0;

    regs.ax = 0x1a00;
    regs.dx = (unsigned)(DWORD)(BYTE FAR *)area;
    regs.ds = 0;
    call21();

    name(0x4e00, pattern, asked);
    *out = 0;

    while (!(regs.flags & 1)) {
        out += wsprintf(out, "%s%s=%02x", (LPSTR)(out == probeResult ? "" : " "),
                        (LPSTR)(area + 0x1e), area[0x15]);
        regs.ax = 0x4f00;
        call21();
        handle++;
    }

    wsprintf(probeArgs, "%02x", asked);
    probe("find", probeArgs, probeResult);
    (void)handle;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned handle;

    probeOpen(OUTPUT);

    name(0x3900, folder, 0);
    name(0x3c00, file, 0);
    record("make", "F.TXT 0");
    handle = regs.ax;
    regs.ax = 0x3e00;
    regs.bx = handle;
    call21();
    name(0x3c00, readOnly, 1);
    record("make", "RO.TXT 1");
    handle = regs.ax;
    regs.ax = 0x3e00;
    regs.bx = handle;
    call21();
    name(0x3900, sub, 0);
    record("make", "SUB");

    name(0x4300, readOnly, 0x0c0c);
    record("get", "RO.TXT");
    find(0x00);

    name(0x4301, file, 0x07);
    record("set", "F.TXT 07");
    name(0x4300, file, 0x0c0c);
    record("get", "F.TXT");
    name(0x4301, sub, 0x02);
    record("set", "SUB 02");
    name(0x4300, sub, 0x0c0c);
    record("get", "SUB");
    name(0x4301, file, 0x08);
    record("set", "F.TXT 08");
    name(0x4301, file, 0x10);
    record("set", "F.TXT 10");
    name(0x4301, file, 0x40);
    record("set", "F.TXT 40");
    find(0x00);
    find(0x16);

    name(0x3d02, file, 0);
    record("open", "F.TXT");
    if (!(regs.flags & 1)) {
        handle = regs.ax;
        regs.ax = 0x4000;
        regs.bx = handle;
        regs.cx = 1;
        regs.dx = (unsigned)(DWORD)(char FAR *)folder;
        regs.ds = 0;
        call21();
        regs.ax = 0x3e00;
        regs.bx = handle;
        call21();
    }

    name(0x3d00, none, 0);
    name(0x4301, none, 0);
    record("missing", "2 NONE.TXT");
    name(0x3d00, none, 0);
    name(0x4301, noFolder, 0);
    record("missing", "2 NOSUCH\\X.TXT");
    name(0x3b00, noPath, 0);
    record("missing", "3b");
    name(0x4301, none, 0);
    record("missing", "3 NONE.TXT");
    name(0x4300, none, 0x0c0c);
    record("get", "NONE.TXT");

    name(0x4301, file, 0);
    name(0x4100, file, 0);
    name(0x4100, readOnly, 0);
    name(0x3a00, sub, 0);
    name(0x3a00, folder, 0);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
