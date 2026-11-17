/*
 * DOS's function 60h, a name made whole ("truename"): DS:SI the name,
 * ES:DI a buffer of 128 bytes for the whole name. TZ-Minigolf's setup asks
 * it of the file it is about to copy and of where it goes, and takes a
 * refusal for "File or directory access denied" (the compatibility
 * catalog's `win3_TZ-Minig`).
 *
 * The probe's current directory is C:\ORACLE. Each record is one name:
 * its result the whole name, or `error N` with the carry set.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TRUENAM.OUT"

static char whole[128];
static char name[128];
static unsigned rAX, rFlags;

static void truename(LPCSTR given)
{
    lstrcpy(name, given);
    lstrcpy(whole, "untouched");

    _asm {
        push si
        push di
        push ds
        push es
        mov ax, ds
        mov es, ax
        mov si, offset name
        mov di, offset whole
        mov ax, 6000h
        int 21h
        pushf
        pop bx
        pop es
        pop ds
        mov rAX, ax
        mov rFlags, bx
        pop di
        pop si
    }

    if (rFlags & 1) {
        wsprintf(probeResult, "error %u", rAX);
    } else {
        lstrcpy(probeResult, whole);
    }

    probe("truename", given, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    truename("f.txt");
    truename("C:\\WINDOWS\\..\\oracle\\.\\x.y");
    truename("c:/windows/win.ini");
    truename("C:\\WINDOWS\\");
    truename("C:\\");
    truename("C:longfilename.text");
    truename("C:\\NOFOLDER\\NOFILE.TXT");
    truename("a b.txt");
    truename("A..B.C");
    truename("C:\\A.B\\C.D.E");
    truename("Q:\\X.TXT");
    truename("bad|name");
    truename("");
    truename("..\\..\\..");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
