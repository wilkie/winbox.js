/*
 * What a block grown by `GlobalReAlloc` holds past where it ended, with
 * `GMEM_ZEROINIT` and without, where the memory held something before.
 *
 * Each case: a block of 1,024 bytes filled with AAh and freed; a block of
 * 64 allocated (`GlobalAlloc` gives the freed selector again, `greuse`),
 * filled with 11h; then grown to 1,024 in place.
 *
 * * `same`: whether the 64 had the freed block's selector (`same`, `other`).
 * * `zeroinit`, `plain`: grown with `GMEM_ZEROINIT` and without, the bytes
 *   past 64, as how many of the 960 are nought, how many AAh, and how many
 *   anything else; and whether the first 64 are still 11h.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GREALLOC.OUT"

static void one(LPCSTR name, UINT flags)
{
    HGLOBAL old = GlobalAlloc(GMEM_MOVEABLE, 1024);
    BYTE FAR *p = (BYTE FAR *)GlobalLock(old);
    UINT oldSel = HIWORD((DWORD)p);
    HGLOBAL block;
    HGLOBAL grown;
    UINT sel;
    int i;
    int zero = 0;
    int aa = 0;
    int other = 0;
    int kept = 1;

    for (i = 0; i < 1024; i++) {
        p[i] = 0xaa;
    }

    GlobalUnlock(old);
    GlobalFree(old);

    block = GlobalAlloc(GMEM_MOVEABLE, 64);
    p = (BYTE FAR *)GlobalLock(block);
    sel = HIWORD((DWORD)p);

    for (i = 0; i < 64; i++) {
        p[i] = 0x11;
    }

    GlobalUnlock(block);
    probe("same", name, sel == oldSel ? "same" : "other");

    grown = GlobalReAlloc(block, 1024, GMEM_MOVEABLE | flags);
    p = (BYTE FAR *)GlobalLock(grown ? grown : block);

    for (i = 0; i < 64; i++) {
        if (p[i] != 0x11) {
            kept = 0;
        }
    }

    for (i = 64; i < 1024; i++) {
        if (p[i] == 0) {
            zero++;
        } else if (p[i] == 0xaa) {
            aa++;
        } else {
            other++;
        }
    }

    wsprintf(probeResult, "%s,zero=%d,aa=%d,other=%d,%s", (LPSTR)(grown ? "grown" : "failed"), zero,
             aa, other, (LPSTR)(kept ? "kept" : "changed"));
    probe(name, "1024", probeResult);
    GlobalUnlock(grown ? grown : block);
    GlobalFree(grown ? grown : block);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    one("zeroinit", GMEM_ZEROINIT);
    one("plain", 0);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
