/*
 * KERNEL and USER string handling.
 *
 * The first probe, chosen because every answer it records is unambiguous.
 * These functions take strings and return numbers or strings; there are no
 * handles whose values are ours to choose, no fonts whose metrics depend on
 * what was installed, nothing that needs normalising before two runs can be
 * compared. If the pipeline works at all, it works here, and any disagreement
 * is a real disagreement.
 *
 * They are also where the undocumented edges live. `lstrcmp` on Windows 3.1 is
 * not `strcmp` -- it collates by the language driver rather than by byte value,
 * so case and accents do not fall where C would put them. `AnsiNext` on a
 * single-byte codepage is not simply "add one" at the end of a string. These
 * are exactly the details an implementation written from a manual gets wrong,
 * and exactly what recording against the real thing is for.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STRINGS.OUT"

/* Records lstrlen for one input. */
static void probeLength(LPCSTR text)
{
    wsprintf(probeArgs, "\"%s\"", (LPSTR)text);
    wsprintf(probeResult, "%d", lstrlen(text));
    probe("lstrlen", probeArgs, probeResult);
}

/* Records lstrcmp and lstrcmpi for one pair.
 *
 * The sign is what is defined, not the magnitude, so that is what gets
 * recorded -- a return of -2 and a return of -1 are the same answer, and
 * writing down the raw number would invent a disagreement.
 */
static void probeCompare(LPCSTR left, LPCSTR right)
{
    int sensitive = lstrcmp(left, right);
    int insensitive = lstrcmpi(left, right);

    wsprintf(probeArgs, "\"%s\",\"%s\"", (LPSTR)left, (LPSTR)right);

    wsprintf(probeResult, "%d", sensitive < 0 ? -1 : (sensitive > 0 ? 1 : 0));
    probe("lstrcmp", probeArgs, probeResult);

    wsprintf(probeResult, "%d", insensitive < 0 ? -1 : (insensitive > 0 ? 1 : 0));
    probe("lstrcmpi", probeArgs, probeResult);
}

/* Records lstrcpy and lstrcat, which return their destination. */
static void probeCopy(LPCSTR left, LPCSTR right)
{
    char buffer[256];

    lstrcpy(buffer, left);
    wsprintf(probeArgs, "\"%s\"", (LPSTR)left);
    wsprintf(probeResult, "\"%s\"", (LPSTR)buffer);
    probe("lstrcpy", probeArgs, probeResult);

    lstrcat(buffer, right);
    wsprintf(probeArgs, "\"%s\",\"%s\"", (LPSTR)left, (LPSTR)right);
    wsprintf(probeResult, "\"%s\"", (LPSTR)buffer);
    probe("lstrcat", probeArgs, probeResult);
}

/* Records the case conversions, which go through the language driver. */
static void probeCase(LPCSTR text)
{
    char buffer[256];

    lstrcpy(buffer, text);
    AnsiUpper(buffer);
    wsprintf(probeArgs, "\"%s\"", (LPSTR)text);
    wsprintf(probeResult, "\"%s\"", (LPSTR)buffer);
    probe("AnsiUpper", probeArgs, probeResult);

    lstrcpy(buffer, text);
    AnsiLower(buffer);
    wsprintf(probeResult, "\"%s\"", (LPSTR)buffer);
    probe("AnsiLower", probeArgs, probeResult);
}

/*
 * Records how far AnsiNext and AnsiPrev move.
 *
 * The offset is what matters rather than the pointer, which would be a
 * different number in every address space.
 */
static void probeWalk(LPCSTR text)
{
    LPSTR start = (LPSTR)text;
    LPSTR next = AnsiNext(start);
    LPSTR last;
    LPSTR previous;

    wsprintf(probeArgs, "\"%s\",0", (LPSTR)text);
    wsprintf(probeResult, "%d", (int)(next - start));
    probe("AnsiNext", probeArgs, probeResult);

    last = start + lstrlen(start);
    previous = AnsiPrev(start, last);

    wsprintf(probeArgs, "\"%s\",%d", (LPSTR)text, lstrlen(text));
    wsprintf(probeResult, "%d", (int)(previous - start));
    probe("AnsiPrev", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    probeNote("lstrlen");
    probeLength("");
    probeLength("a");
    probeLength("hello");
    probeLength("with spaces and 1234");
    probeLength("tab\there");

    probeNote("lstrcmp and lstrcmpi");
    probeCompare("", "");
    probeCompare("a", "a");
    probeCompare("a", "b");
    probeCompare("b", "a");
    probeCompare("a", "A");
    probeCompare("A", "a");
    probeCompare("abc", "abd");
    probeCompare("abc", "abcd");
    probeCompare("Zebra", "apple");
    probeCompare("_", "a");
    probeCompare("1", "a");

    probeNote("lstrcpy and lstrcat");
    probeCopy("", "");
    probeCopy("hello", " world");
    probeCopy("a", "b");

    probeNote("AnsiUpper and AnsiLower");
    probeCase("");
    probeCase("hello");
    probeCase("HELLO");
    probeCase("MiXeD 123");
    probeCase("with-punctuation!");

    /* The accented range, where guessing is least safe. Whether these convert
     * at all depends on the language driver, and the two characters at the end
     * are the interesting ones: 0xDF is a lowercase letter with no single
     * uppercase form, and 0xF7 is a division sign sitting in the middle of the
     * letters where a naive "subtract 0x20" would convert it.
     */
    probeCase("\xE0\xE9\xFC");
    probeCase("\xC0\xC9\xDC");
    probeCase("\xDF");
    probeCase("\xF7\xD7");

    probeNote("AnsiNext and AnsiPrev");
    probeWalk("");
    probeWalk("a");
    probeWalk("hello");

    probeFinish();
    return 0;
}
