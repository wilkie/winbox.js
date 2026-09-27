/*
 * Small calls programs make on their way up, and what they answer.
 *
 * * `answer`: a call's answer, as a number; a far pointer as `same` when it
 *   is the one `GlobalLock` gives for the same block, else `other` or `0`.
 *   `SetMessageQueue`'s only as whether it is non-nought: it answers the new
 *   queue's handle.
 * * `vk`: `VkKeyScan` for a character: the virtual key in the low byte and
 *   the shift state in the high, as hexadecimal; and `all`, every character
 *   from 0 to 255 in one record.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MISC.OUT"

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("answer", what, probeResult);
}

static void key(LPCSTR what, char character)
{
    wsprintf(probeResult, "%04x", (UINT)VkKeyScan(character));
    probe("vk", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block;
    void FAR *locked;
    void FAR *wired;
    FARPROC thunk;

    probeOpen(OUTPUT);

    /* The error mode. */
    answer("error-mode-first", SetErrorMode(SEM_FAILCRITICALERRORS));
    answer("error-mode-again", SetErrorMode(SEM_NOOPENFILEERRORBOX | SEM_FAILCRITICALERRORS));
    answer("error-mode-back", SetErrorMode(0));

    /* The double-click time. */
    answer("double-click", GetDoubleClickTime());
    SetDoubleClickTime(300);
    answer("double-click-set", GetDoubleClickTime());
    SetDoubleClickTime(0);
    answer("double-click-zero", GetDoubleClickTime());

    /* Keys. */
    key("a", 'a');
    key("A", 'A');
    key("z", 'z');
    key("1", '1');
    key("!", '!');
    key("space", ' ');
    key("return", '\r');
    key("tab", '\t');
    key("backspace", '\b');
    key("escape", 0x1b);
    key("period", '.');
    key("slash", '/');
    key("question", '?');
    key("semicolon", ';');
    key("quote", '\'');
    key("tilde", '~');
    key("bracket", '[');
    key("equals", '=');
    key("plus", '+');
    key("minus", '-');
    key("ctrl-a", 0x01);
    key("e-acute", (char)0xe9);
    key("pound", (char)0xa3);

    /* And every character, as one record: four hexadecimal digits each. */
    {
        static char all[4 * 256 + 1];
        int character;

        for (character = 0; character < 256; character++) {
            wsprintf(all + character * 4, "%04x", (UINT)VkKeyScan((char)character));
        }

        probe("vk", "all", all);
    }

    /* The queue and the handles. */
    answer("message-queue", SetMessageQueue(8) != 0);
    answer("handle-count", SetHandleCount(30));
    answer("handle-count-less", SetHandleCount(10));

    /* Wiring and page-locking a block. */
    block = GlobalAlloc(GMEM_MOVEABLE, 64);
    locked = GlobalLock(block);
    GlobalUnlock(block);
    wired = GlobalWire(block);
    probe("answer", "wire", (LPSTR)(wired == NULL ? "0" : wired == locked ? "same" : "other"));
    answer("wire-flags", GlobalFlags(block) & GMEM_LOCKCOUNT);
    answer("unwire", GlobalUnWire(block));
    answer("unwire-flags", GlobalFlags(block) & GMEM_LOCKCOUNT);
    answer("page-lock", GlobalPageLock(block));
    answer("page-lock-again", GlobalPageLock(block));
    answer("page-unlock", GlobalPageUnlock(block));
    answer("page-unlock-again", GlobalPageUnlock(block));
    answer("page-unlock-more", GlobalPageUnlock(block));
    GlobalFree(block);

    /* A procedure instance made and freed. */
    thunk = MakeProcInstance((FARPROC)WinMain, instance);
    FreeProcInstance(thunk);
    answer("freed", 1);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
