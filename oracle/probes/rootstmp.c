/*
 * The stamps of the root's `.` and `..` on the oracle's C:, a folder of
 * the host's under DOSBox: `.` is the folder's own `stat`, `..` its
 * parent's on the host (`drive_cache.cpp` `ReadDir`, `drive_local.cpp`
 * 255-276). Stamps are recorded as `same` or `different`, not as times,
 * as `dirorder` records them.
 *
 * * `start`: the root's `..` against its `.`, and `C:\ORACLE`'s `..`
 *   against the root's `.`.
 * * `made`, `deleted`: four seconds after, a file made in the root, then
 *   deleted: the root's `.` and `..` each against itself before.
 */

#include "probe.h"

#include <dos.h>

#define OUTPUT "C:\\ORACLE\\ROOTSTMP.OUT"
#define FIND_ALL (_A_HIDDEN | _A_SYSTEM | _A_SUBDIR)

extern unsigned DosPath(unsigned function, LPCSTR path);
#pragma aux DosPath = "push ds" "mov ds,dx" "mov dx,ax" "mov ah,bl" "int 21h" "jc bad" \
    "xor ax,ax" "bad:" "pop ds" parm[bx][dx ax] value[ax] modify[dx];

/* The stamp a folder's listing gives an entry by name, nought for none. */
static DWORD stampIn(LPCSTR folder, LPCSTR name)
{
    struct find_t found;
    char pattern[80];
    unsigned done;

    wsprintf(pattern, "%s\\*.*", folder);

    for (done = _dos_findfirst(pattern, FIND_ALL, &found); done == 0;
         done = _dos_findnext(&found)) {
        if (lstrcmp(found.name, name) == 0) {
            return MAKELONG(found.wr_time, found.wr_date);
        }
    }

    return 0;
}

static void relation(LPCSTR what, LPCSTR args, DWORD before, DWORD after)
{
    probe(what, args, (LPSTR)(!before || !after ? "missing" : before == after ? "same" : "different"));
}

static void settle(void)
{
    DWORD start = GetTickCount();

    while (GetTickCount() - start < 4000) {
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD dot, dotdot, dot2, dotdot2;
    int handle;

    probeOpen(OUTPUT);

    dot = stampIn("C:", ".");
    dotdot = stampIn("C:", "..");
    relation("start", "root .. against .", dot, dotdot);
    relation("start", "ORACLE .. against root .", dot, stampIn("C:\\ORACLE", ".."));

    settle();

    if (_dos_creat("C:\\ROOTSTMP.TMP", _A_NORMAL, &handle) == 0) {
        _dos_close(handle);
    }

    dot2 = stampIn("C:", ".");
    dotdot2 = stampIn("C:", "..");
    relation("made", ".", dot, dot2);
    relation("made", "..", dotdot, dotdot2);

    settle();
    DosPath(0x41, "C:\\ROOTSTMP.TMP");
    relation("deleted", ".", dot2, stampIn("C:", "."));
    relation("deleted", "..", dotdot2, stampIn("C:", ".."));

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
