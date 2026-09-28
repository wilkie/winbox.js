/*
 * Selectors made from others: AllocSelector, PrestoChangoSelector and
 * AllocDSToCSAlias on a block of the probe's own, and what each new
 * selector is.
 *
 * * `rights`: LAR's access rights byte for a selector, as hex, or `none`
 *   when LAR refuses it.
 * * `shares`: whether a byte written through the block's selector reads the
 *   same through the other.
 * * `answer`: what each call answered, as `dest` for the selector given it
 *   to change, `new` for another, or the number.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SELALIAS.OUT"

WORD lar(WORD selector);
#pragma aux lar = 0x0f 0x02 0xc3 0x74 0x02 0x33 0xc0 parm [bx] value [ax];

static void rights(LPCSTR what, WORD selector)
{
    WORD access = lar(selector);

    if (!access) {
        lstrcpy(probeResult, "none");
    } else {
        wsprintf(probeResult, "%x", (access >> 8) & 0xff);
    }

    probe("rights", what, probeResult);
}

static void shares(LPCSTR what, WORD from, WORD to)
{
    BYTE FAR *a = (BYTE FAR *)MAKELP(from, 16);
    BYTE FAR *b = (BYTE FAR *)MAKELP(to, 16);

    *a = 0x5a;
    probe("shares", what, (LPSTR)(*b == 0x5a ? "yes" : "no"));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block;
    WORD selector;
    WORD copy;
    WORD answer;
    WORD alias;
    WORD empty;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_FIXED | GMEM_ZEROINIT, 256);
    selector = HIWORD((DWORD)GlobalLock(block));
    rights("block", selector);

    copy = AllocSelector(selector);
    probe("answer", "AllocSelector(block)", (LPSTR)(copy ? "new" : "0"));
    rights("AllocSelector(block)", copy);
    shares("AllocSelector(block)", selector, copy);

    answer = (WORD)PrestoChangoSelector(selector, copy);
    probe("answer", "PrestoChangoSelector(block, copy)",
          (LPSTR)(answer == copy ? "dest" : answer ? "new" : "0"));
    rights("after PrestoChangoSelector(block, copy)", copy);
    shares("after PrestoChangoSelector(block, copy)", selector, copy);

    answer = (WORD)PrestoChangoSelector(copy, copy);
    rights("PrestoChangoSelector(copy, copy)", copy);

    alias = AllocDStoCSAlias(selector);
    rights("AllocDStoCSAlias(block)", alias);

    empty = AllocSelector(0);
    probe("answer", "AllocSelector(0)", (LPSTR)(empty ? "new" : "0"));
    rights("AllocSelector(0)", empty);

    wsprintf(probeResult, "%x", FreeSelector(copy));
    probe("answer", "FreeSelector(copy)", probeResult);
    rights("freed", copy);
    FreeSelector(alias);
    FreeSelector(empty);
    GlobalUnlock(block);
    GlobalFree(block);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
