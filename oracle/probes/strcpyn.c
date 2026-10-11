/*
 * `lstrcpyn`: how much of a string it copies into a buffer, and what it
 * leaves past that.
 *
 * KERNEL's code (seg1 `831f`) takes the source's length with its nought, or
 * the count where that is less, compared unsigned; copies one fewer, a word
 * at a time and then the odd byte, forward; and writes a nought.
 *
 * Records:
 *
 * * `lstrcpyn`: `"text",count` -- a buffer of twelve `x`s copied into: whether
 *   the answer is the buffer, and its twelve bytes as hex.
 * * `overlap`: `"abcdefgh"` copied one byte up over itself, a count of 8. A
 *   copy a byte at a time would repeat the `a`; a word at a time, each word
 *   read before it is written, gives `aabbddff`.
 * * `whole`: a count of nought, one less than which is 65535: a block of 64K
 *   whose text is `Hi`, with a `Z` at its last byte but one, copied into
 *   another block of 64K -- the first four bytes, the last two, and the
 *   answer.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STRCPYN.OUT"

/* Bytes as hex, two digits each. */
static void hex(LPSTR out, const char FAR *bytes, int count)
{
    int at;

    for (at = 0; at < count; at++) {
        wsprintf(out + at * 2, "%02x", (unsigned char)bytes[at]);
    }

    out[count * 2] = '\0';
}

static void copy(LPCSTR text, int count)
{
    char buffer[12];
    char shown[32];
    LPSTR answer;
    int at;

    for (at = 0; at < 12; at++) {
        buffer[at] = 'x';
    }

    answer = lstrcpyn(buffer, text, count);
    hex(shown, buffer, 12);
    wsprintf(probeArgs, "\"%s\",%d", (LPSTR)text, count);
    wsprintf(probeResult, "%s,%s", (LPSTR)(answer == (LPSTR)buffer ? "buffer" : "other"),
             (LPSTR)shown);
    probe("lstrcpyn", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char buffer[12];
    char shown[32];
    LPSTR answer;

    probeOpen(OUTPUT);

    copy("Hello", 1);
    copy("Hello", 2);
    copy("Hello", 3);
    copy("Hello", 5);
    copy("Hello", 6);
    copy("Hello", 7);
    copy("Hello", 12);
    copy("Hello", -1);
    copy("", 4);
    copy("Hello world", 12);

    /* Over itself, one byte up. */
    lstrcpy(buffer, "abcdefgh");
    buffer[9] = 'x';
    buffer[10] = 'x';
    buffer[11] = 'x';
    answer = lstrcpyn(buffer + 1, buffer, 8);
    hex(shown, buffer, 12);
    wsprintf(probeResult, "%s,%s", (LPSTR)(answer == (LPSTR)buffer + 1 ? "buffer" : "other"),
             (LPSTR)shown);
    probe("overlap", "\"abcdefgh\",8", probeResult);

    /* A count of nought, between two blocks of 64K. */
    {
        HGLOBAL from = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 0x10000L);
        HGLOBAL to = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 0x10000L);

        if (from && to) {
            char FAR *source = (char FAR *)GlobalLock(from);
            char FAR *target = (char FAR *)GlobalLock(to);
            LPSTR got;

            source[0] = 'H';
            source[1] = 'i';
            source[0xfffe] = 'Z';
            target[0xffff] = 'y';
            got = lstrcpyn(target, source, 0);
            hex(shown, target, 4);
            hex(shown + 8, target + 0xfffe, 2);
            wsprintf(probeResult, "%s,%s", (LPSTR)(got == target ? "buffer" : "other"),
                     (LPSTR)shown);
            GlobalUnlock(to);
            GlobalUnlock(from);
        } else {
            lstrcpy(probeResult, "no memory");
        }

        if (to) {
            GlobalFree(to);
        }

        if (from) {
            GlobalFree(from);
        }

        probe("whole", "\"Hi\",0", probeResult);
    }

    probeFinish();

    return 0;
}
