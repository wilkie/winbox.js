/*
 * DOS's device information for a handle: INT 21h function 4400h, as a
 * program asks through KERNEL -- the Visual Basic runtime does, for a
 * custom control's file it has opened, and refuses one that is a character
 * device.
 *
 * * `info`: for a file made with `_lcreat`, the same after `_lwrite` of a
 *   byte, the file opened again with `OpenFile` for reading, handles 0 to 4,
 *   and a
 *   handle nobody opened: DX, in hexadecimal, or the error in AX with the
 *   carry set.
 * * `handle`: the handle `_lcreat` gave, the probe's own output file open.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DEVINFO.OUT"

extern unsigned DeviceInfo(unsigned handle);
#pragma aux DeviceInfo = "mov ax,4400h" "int 21h" "jnc done" "mov dx,ax" "or dx,8000h" "xor dx,dx" "dec dx" "done:" parm[bx] value[dx] modify[ax];

extern unsigned DeviceError(unsigned handle);
#pragma aux DeviceError = "mov ax,4400h" "int 21h" "jc failed" "xor ax,ax" "failed:" parm[bx] value[ax] modify[dx];

static void info(LPCSTR name, unsigned handle)
{
    unsigned error = DeviceError(handle);

    if (error) {
        wsprintf(probeResult, "error %x", error);
    } else {
        wsprintf(probeResult, "%04x", DeviceInfo(handle));
    }

    probe("info", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT of;
    HFILE opened;
    HFILE made;
    char byte = 'x';
    char name[8];
    unsigned handle;

    probeOpen(OUTPUT);

    made = _lcreat("C:\\ORACLE\\DEVINFO.TMP", 0);
    wsprintf(probeResult, "%d", made);
    probe("handle", "created", probeResult);
    info("created", made);
    _lwrite(made, &byte, 1);
    info("written", made);
    _lclose(made);

    opened = OpenFile("C:\\ORACLE\\DEVINFO.TMP", &of, OF_READ);
    info("opened", opened);

    for (handle = 0; handle <= 4; handle++) {
        wsprintf(name, "std%u", handle);
        info(name, handle);
    }

    info("unopened", 200);

    _lclose(opened);
    OpenFile("C:\\ORACLE\\DEVINFO.TMP", &of, OF_DELETE);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
