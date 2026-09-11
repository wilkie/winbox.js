/*
 * fotmake -- what the installer reads when it writes a `.FOT`.
 *
 * Section 8a settled that the two design widths GDI scales -- `dfAvgWidth` and
 * `dfMaxWidth` -- come from the `FONTDIR` resource of the `.FOT` stub and not
 * from the `.TTF`, and that the pitch and family it reports come from there
 * too. What has never been asked is where the *stub* gets them. Nine
 * fabrications of a `.TTF` moved nothing, because by then the stub already
 * existed; the question is what `CreateScalableFontResource` reads while it is
 * making one.
 *
 * So make one. The call takes a `.TTF` and writes the stub, and the stub is a
 * small NE file this can read straight back and write down in hex. Run it over
 * a fabricated face and the fields that move identify what was read.
 *
 * The fonts are named rather than enumerated because the interesting ones are
 * the pair whose families differ -- Symbol says `FF_ROMAN` and Wingdings
 * `FF_DONTCARE` -- and whichever fabrication is staged over one of them.
 */

#include <windows.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FOTMAKE.OUT"

/* Bytes to a record, as hex. */
#define ROW 32

static const char HEX[] = "0123456789abcdef";

static void dump(LPCSTR face, LPCSTR file)
{
    char source[80];
    char target[80];
    HFILE handle;
    long size;
    long at;
    char buffer[ROW];

    wsprintf(source, "C:\\WINDOWS\\SYSTEM\\%s", (LPSTR)file);
    wsprintf(target, "C:\\ORACLE\\MADE.FOT");

    OpenFile(target, (OFSTRUCT *)probeResult, OF_DELETE);

    wsprintf(probeArgs, "\"%s\",%s", (LPSTR)face, (LPSTR)file);

    if (!CreateScalableFontResource(1, target, source, NULL)) {
        probe("made", probeArgs, "failed");
        return;
    }

    handle = _lopen(target, OF_READ);

    if (handle == HFILE_ERROR) {
        probe("made", probeArgs, "unreadable");
        return;
    }

    size = _llseek(handle, 0L, 2);
    _llseek(handle, 0L, 0);

    wsprintf(probeResult, "size=%ld", size);
    probe("made", probeArgs, probeResult);

    for (at = 0; at < size; at += ROW) {
        int got = _lread(handle, buffer, ROW);
        int index;
        LPSTR out = probeResult;

        if (got <= 0) {
            break;
        }

        for (index = 0; index < got; index++) {
            unsigned char value = (unsigned char)buffer[index];

            *out++ = HEX[(value >> 4) & 0x0f];
            *out++ = HEX[value & 0x0f];
        }

        *out = '\0';

        wsprintf(probeArgs, "\"%s\",%s,+%04x", (LPSTR)face, (LPSTR)file, (int)at);
        probe("stub", probeArgs, probeResult);
    }

    _lclose(handle);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    probeNote("the stub the installer writes, for the faces whose families differ");
    dump("Symbol", "SYMBOL.TTF");
    dump("Wingdings", "WINGDING.TTF");
    dump("Arial", "ARIAL.TTF");
    dump("Courier New", "COUR.TTF");
    dump("Times New Roman", "TIMES.TTF");

    probeFinish();
    return 0;
}
