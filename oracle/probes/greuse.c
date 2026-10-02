/*
 * Which selector `GlobalAlloc` gives after `GlobalFree`: the one just freed,
 * or another. Selectors are the high word of `GlobalLock`'s pointer, compared
 * only with each other, never as numbers.
 *
 * * `again`: a block allocated, freed, and another of the same size
 *   allocated: `same` selector or `other`.
 * * `order`: three blocks, a, b and c, allocated in turn and freed in that
 *   order, then three allocated: which of a, b and c each one's selector
 *   is, or `new`.
 * * `held`: a block allocated and kept, another allocated and freed, then
 *   another: the freed one's selector (`freed`), the kept one's, or `new`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GREUSE.OUT"

static UINT selectorOf(HGLOBAL handle)
{
    return HIWORD((DWORD)GlobalLock(handle));
}

static HGLOBAL make(void)
{
    return GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 1024);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL a;
    HGLOBAL b;
    HGLOBAL c;
    UINT sa;
    UINT sb;
    UINT sc;
    int i;
    LPSTR at;

    probeOpen(OUTPUT);

    a = make();
    sa = selectorOf(a);
    GlobalUnlock(a);
    GlobalFree(a);
    b = make();
    sb = selectorOf(b);
    GlobalUnlock(b);
    probe("again", "1024", sb == sa ? "same" : "other");
    GlobalFree(b);

    a = make();
    b = make();
    c = make();
    sa = selectorOf(a);
    sb = selectorOf(b);
    sc = selectorOf(c);
    GlobalUnlock(a);
    GlobalUnlock(b);
    GlobalUnlock(c);
    GlobalFree(a);
    GlobalFree(b);
    GlobalFree(c);

    at = probeResult;

    for (i = 0; i < 3; i++) {
        HGLOBAL next = make();
        UINT s = selectorOf(next);

        GlobalUnlock(next);
        at += wsprintf(at, "%s%s", (LPSTR)(s == sa ? "a" : s == sb ? "b" : s == sc ? "c" : "new"),
                       (LPSTR)(i < 2 ? "," : ""));
    }

    probe("order", "a,b,c", probeResult);

    a = make();
    sa = selectorOf(a);
    GlobalUnlock(a);
    b = make();
    sb = selectorOf(b);
    GlobalUnlock(b);
    GlobalFree(b);
    c = make();
    sc = selectorOf(c);
    GlobalUnlock(c);
    probe("held", "1024", sc == sb ? "freed" : sc == sa ? "kept" : "new");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
