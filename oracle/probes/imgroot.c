/*
 * 4300h of a disk image's root, and of the root written in other ways,
 * on a floppy image (A:), a hard disk image (D:) and a CD-ROM image (E:)
 * (`imgroot.mounts`); and 4301h of the same.
 *
 * DOSBox's `fatDrive::GetFileAttr` looks for the root's entry by a name
 * `getEntryName` leaves unset for the root (`drive_fat.cpp` 397-416,
 * 969-996); `isoDrive::GetFileAttr` looks the path up as any other.
 *
 * * `get`: 4300h of the path, CX 0C0Ch before: AX BX CX DX and the carry
 *   after (`regcall.h`).
 * * `set`: 4301h of the path, CX 0: the same.
 */

#include "probe.h"
#include "regcall.h"

#define OUTPUT "C:\\ORACLE\\IMGROOT.OUT"

static char *paths[] = {
    "A:\\",   "A:",       "A:\\.",     "A:\\SUBDIR", "A:\\SUBDIR\\..", "A:\\README.TXT",
    "D:\\",   "D:",       "D:\\.",     "E:\\",       "E:",             "E:\\.",
    "E:\\SUBDIR",
};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned i, function;

    probeOpen(OUTPUT);

    for (function = 0x4300; function <= 0x4301; function++) {
        for (i = 0; i < sizeof paths / sizeof paths[0]; i++) {
            regs.ax = function;
            regs.bx = 0x0b0b;
            regs.cx = function == 0x4300 ? 0x0c0c : 0;
            regs.dx = (unsigned)(DWORD)(char FAR *)paths[i];
            regs.ds = 0;
            call21();
            regsText(probeResult);
            probe(function == 0x4300 ? "get" : "set", paths[i], probeResult);
        }
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
