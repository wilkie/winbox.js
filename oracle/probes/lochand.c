/*
 * `LocalHandle`, as Windows Help asks it of a block of its local heap that it
 * holds by its pointer alone: a moveable block allocated, locked, and handed
 * on by the handle `LocalHandle` finds for the pointer.
 *
 * Each record is `handle`: what was asked, then the answer, named where it
 * is one of the values asked about -- `handle` for the moveable block's
 * handle, `pointer` for the value asked, `zero` -- else in hexadecimal.
 *
 * * `fixed`: the pointer of a fixed block of 10 bytes.
 * * `moveable`: the pointer of a moveable block of 43h bytes, locked.
 * * `unlocked`: the same pointer, the block unlocked again.
 * * `ownhandle`: the moveable block's handle itself.
 * * `inside`: four bytes into the moveable block.
 * * `beside`: two bytes into it, which has bit 1 the other way.
 * * `null`: nought.
 * * `moved`: the pointer of the moveable block grown to 600 bytes, locked.
 * * `old`: the pointer it had before it grew, where it was moved.
 * * `discarded`: its last pointer, once the block is discarded.
 * * `freed`: the fixed block's pointer, once it is freed.
 *
 * And `bits`: whether the fixed block's pointer and the moveable block's
 * have bit 1 set, as KERNEL tells them apart.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOCHAND.OUT"

static HLOCAL moveable;

static void ask(LPCSTR step, WORD value)
{
    WORD answer = (WORD)LocalHandle((void NEAR *)value);

    if (answer == (WORD)moveable) {
        lstrcpy(probeResult, "handle");
    } else if (answer == value) {
        lstrcpy(probeResult, "pointer");
    } else if (answer == 0) {
        lstrcpy(probeResult, "zero");
    } else {
        wsprintf(probeResult, "%x", answer);
    }

    probe("handle", step, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HLOCAL fixed;
    WORD fixedAt;
    WORD at;
    WORD old;
    WORD grown;

    probeOpen(OUTPUT);

    fixed = LocalAlloc(LMEM_FIXED, 10);
    fixedAt = (WORD)fixed;
    moveable = LocalAlloc(LMEM_MOVEABLE, 0x43);
    at = (WORD)LocalLock(moveable);

    wsprintf(probeResult, "fixed=%d,moveable=%d", (fixedAt & 2) ? 1 : 0, (at & 2) ? 1 : 0);
    probe("bits", "", probeResult);

    ask("fixed", fixedAt);
    ask("moveable", at);
    LocalUnlock(moveable);
    ask("unlocked", at);
    ask("ownhandle", (WORD)moveable);
    ask("inside", at + 4);
    ask("beside", at + 2);
    ask("null", 0);

    old = at;
    LocalReAlloc(moveable, 600, LMEM_MOVEABLE);
    grown = (WORD)LocalLock(moveable);
    LocalUnlock(moveable);
    ask("moved", grown);

    wsprintf(probeResult, "%d", grown != old ? 1 : 0);
    probe("moved", "", probeResult);

    if (grown != old) {
        ask("old", old);
    }

    LocalReAlloc(moveable, 0, LMEM_MOVEABLE);
    ask("discarded", grown);

    LocalFree(fixed);
    ask("freed", fixedAt);

    LocalFree(moveable);
    probeFinish();

    return 0;
}
