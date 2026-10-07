/*
 * A drive's size and room, as DOS answers them: INT 21h function 36h, which
 * File Manager asks before it copies a file (and refuses with "Not enough
 * disk space" when the answer is FFFFh), and function 1Ch, the allocation
 * information without the free clusters.
 *
 * The oracle's Windows runs under DOSBox, whose C: is a folder of the host's
 * (`mount c`) and whose Z: is its own; there is no A: or B:.
 *
 * * `space`: for drive number 0 (the current drive), 1 (A:), 2 (B:), 3 (C:),
 *   26 (Z:) and 27 (no drive), AX, BX, CX and DX after 36h, in hexadecimal:
 *   sectors to a cluster, free clusters, bytes to a sector and all the
 *   clusters, or FFFFh in AX for no drive. BX is set to 0B0Bh and CX to
 *   0C0Ch before each call, so that what a call leaves as it was shows.
 * * `allocation`: for the same drive numbers, AL, CX and DX after 1Ch
 *   (AX 1CAAh, BX 0B0Bh and CX 0C0Ch before it): sectors to a cluster, bytes
 *   to a sector and all the clusters, or FFh in AL for no drive. DS:BX, the
 *   media byte, is left unread: DS is restored around the call.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DISKFREE.OUT"

extern unsigned SpaceAX(unsigned drive);
#pragma aux SpaceAX = "mov ah,36h" "mov bx,0B0Bh" "mov cx,0C0Ch" "int 21h" parm[dx] value[ax] modify[bx cx dx];

extern unsigned SpaceBX(unsigned drive);
#pragma aux SpaceBX = "mov ah,36h" "mov bx,0B0Bh" "mov cx,0C0Ch" "int 21h" parm[dx] value[bx] modify[ax cx dx];

extern unsigned SpaceCX(unsigned drive);
#pragma aux SpaceCX = "mov ah,36h" "mov bx,0B0Bh" "mov cx,0C0Ch" "int 21h" parm[dx] value[cx] modify[ax bx dx];

extern unsigned SpaceDX(unsigned drive);
#pragma aux SpaceDX = "mov ah,36h" "mov bx,0B0Bh" "mov cx,0C0Ch" "int 21h" parm[dx] value[dx] modify[ax bx cx];

extern unsigned AllocationAX(unsigned drive);
#pragma aux AllocationAX = "push ds" "mov ax,1CAAh" "mov bx,0B0Bh" "mov cx,0C0Ch" "int 21h" "pop ds" parm[dx] value[ax] modify[bx cx dx];

extern unsigned AllocationCX(unsigned drive);
#pragma aux AllocationCX = "push ds" "mov ax,1CAAh" "mov bx,0B0Bh" "mov cx,0C0Ch" "int 21h" "pop ds" parm[dx] value[cx] modify[ax bx dx];

extern unsigned AllocationDX(unsigned drive);
#pragma aux AllocationDX = "push ds" "mov ax,1CAAh" "mov bx,0B0Bh" "mov cx,0C0Ch" "int 21h" "pop ds" parm[dx] value[dx] modify[ax bx cx];

extern unsigned OwnDS(void);
#pragma aux OwnDS = "mov ax,ds" value[ax];

extern unsigned AllocationDS(unsigned drive);
#pragma aux AllocationDS = "push ds" "mov ax,1CAAh" "int 21h" "mov ax,ds" "pop ds" parm[dx] value[ax] modify[bx cx dx];

extern unsigned AllocationMedia(unsigned drive);
#pragma aux AllocationMedia = "push ds" "mov ax,1CAAh" "int 21h" "mov al,[bx]" "xor ah,ah" "pop ds" parm[dx] value[ax] modify[bx cx dx];

static const unsigned drives[] = {0, 1, 2, 3, 26, 27};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned i;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        unsigned drive = drives[i];

        wsprintf(probeArgs, "%u", drive);
        wsprintf(probeResult, "%04x %04x %04x %04x", SpaceAX(drive), SpaceBX(drive),
                 SpaceCX(drive), SpaceDX(drive));
        probe("space", probeArgs, probeResult);
    }

    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        unsigned drive = drives[i];

        wsprintf(probeArgs, "%u", drive);
        wsprintf(probeResult, "%02x %04x %04x", AllocationAX(drive) & 0xff,
                 AllocationCX(drive), AllocationDX(drive));
        probe("allocation", probeArgs, probeResult);
    }

    /* DS after 1Ch, against the probe's own, and the media byte DS:BX
     * points at, for the drives that are there. */
    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        unsigned drive = drives[i];
        unsigned segment;

        if ((AllocationAX(drive) & 0xff) == 0xff) {
            continue;
        }

        segment = AllocationDS(drive);
        wsprintf(probeArgs, "%u", drive);
        wsprintf(probeResult, "%s", (LPSTR)(segment == OwnDS() ? "own" : "other"));
        probe("segment", probeArgs, probeResult);
        wsprintf(probeResult, "%02x", AllocationMedia(drive) & 0xff);
        probe("media", probeArgs, probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
