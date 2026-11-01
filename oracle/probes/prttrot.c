/*
 * What GDI's TrueType scaler holds after it has made a glyph for a printer's
 * driver at an angle: the matrix it was given, the flags it set from it, the
 * instruction control the font's `prep` left, and the glyph's four phantom
 * points, read out of its memory with `TOOLHELP` (`MemoryRead`, nothing
 * written).
 *
 * `prtteng` records Wingdings' `A` at an em of 40 with an advance of 24 turned
 * 90 degrees, one more than upright, and 16 at 45 degrees slanted, where the
 * glyph drawn turned is the same as upright. The advance is the difference of
 * the two phantom points after the glyph's program (`GDI.EXE` seg36
 * `1f46`-`1fdb`), so this reads those points and what decides how they were
 * made.
 *
 * Where it reads, from `GDI.EXE`'s code:
 *
 * * GDI's `DGROUP` `[067Ah]`:`[067Ch]`, the scaler's context, a far pointer
 *   GDI hands each scaler call (seg1 `6ecb`, seg7 `0a84`).
 * * The context's word 4, the scaler's key (seg36 `1e50`); its output record
 *   at 28h, the advance at 5Ah (`1fb6`).
 * * The key's matrix at AAh (`1db5`), its stretches at 92h-A8h (`1de9`), its
 *   flags F2h-F8h and 1A0h-1B3h, the glyph's element at 54h (`4775`), and
 *   its word 110h, the interpreter's global state (`4b8a`): the instruction
 *   control at 46h (`4bb2`, `6333`), the rotated and stretched flags at B3h
 *   (`4267`, `6641`) and the uniform-scale flag at B2h (`425a`).
 *
 * Driver: `prttrot.dll.c`, `prtteng`'s, putting the engine to the font it
 * realized last at each angle asked (`GlyphAt`).
 */

#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\PRTTROT.OUT"
#define LOG "C:\\ORACLE\\PRTTROT.LOG"
#define LIBRARY "C:\\WINDOWS\\PRTTROTD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRTTROTD.DRV"
#define DRIVER "PRTTROTD"

static char chunk[4096];
static unsigned char bytes[512];
static WORD gdiData;

static const char HEX[] = "0123456789abcdef";

static void install(void)
{
    OFSTRUCT info;
    HFILE from = OpenFile(LIBRARY, &info, OF_READ);
    HFILE to = _lcreat(DRIVER_FILE, 0);
    int read;

    while ((read = _lread(from, chunk, sizeof(chunk))) > 0) {
        _lwrite(to, chunk, read);
    }

    _lclose(from);
    _lclose(to);
}

/* Each line of the driver's log so far as a record, the log emptied
 * after: its function, arguments and result apart by tabs. */
static void drained(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(LOG, &info, OF_READ);
    static char line[700];
    int length = 0;
    int read;
    int at;

    if (file == HFILE_ERROR) {
        return;
    }

    while ((read = _lread(file, chunk, sizeof(chunk))) > 0) {
        for (at = 0; at < read; at++) {
            if (chunk[at] == '\n') {
                LPSTR args;
                LPSTR result;

                if (length > 0 && line[length - 1] == '\r') {
                    length--;
                }

                line[length] = '\0';
                args = line;

                while (*args && *args != '\t') {
                    args++;
                }

                if (*args) {
                    *args++ = '\0';
                }

                result = args;

                while (*result && *result != '\t') {
                    result++;
                }

                if (*result) {
                    *result++ = '\0';
                }

                probe(line, args, result);
                length = 0;
            } else if (length < (int)sizeof(line) - 1) {
                line[length++] = chunk[at];
            }
        }
    }

    _lclose(file);
    OpenFile(LOG, &info, OF_DELETE);
}

/* GDI's automatic data segment, found in the census of the global heap. */
static void findGdiData(void)
{
    GLOBALENTRY entry;
    HMODULE gdi = GetModuleHandle("GDI");
    BOOL more;

    entry.dwSize = sizeof(GLOBALENTRY);
    more = GlobalFirst(&entry, GLOBAL_ALL);

    while (more) {
        if (entry.hOwner == gdi && entry.wType == GT_DGROUP) {
            gdiData = GlobalHandleToSel(entry.hBlock);
        }

        entry.dwSize = sizeof(GLOBALENTRY);
        more = GlobalNext(&entry, GLOBAL_ALL);
    }

    wsprintf(probeResult, "%04x", (int)gdiData);
    probe("gdi data", "selector", probeResult);
}

static WORD wordAt(WORD selector, WORD offset)
{
    WORD value = 0;

    MemoryRead(selector, offset, &value, 2);
    return value;
}

/* `count` bytes from selector:offset as hex, one record. */
static void dump(LPCSTR name, LPCSTR what, WORD selector, WORD offset, WORD count)
{
    DWORD got;
    LPSTR out = probeResult;
    WORD at;

    got = MemoryRead(selector, offset, bytes, count);

    for (at = 0; at < (WORD)got; at++) {
        *out++ = HEX[(bytes[at] >> 4) & 0x0f];
        *out++ = HEX[bytes[at] & 0x0f];
    }

    *out = '\0';
    wsprintf(probeArgs, "%s %s +%04x", name, what, (int)offset);
    probe("bytes", probeArgs, got ? probeResult : "unreadable");
}

/* What the scaler holds after the glyph just made. */
static void readScaler(LPCSTR name)
{
    WORD contextOffset = wordAt(gdiData, 0x67a);
    WORD selector = wordAt(gdiData, 0x67c);
    WORD key;
    WORD global;
    WORD x, y, ox, oy, oox, ooy, ends, contours, last;

    wsprintf(probeResult, "%04x:%04x", (int)selector, (int)contextOffset);
    probe("scaler", name, probeResult);

    dump(name, "gdi", gdiData, 0x660, 0x20);
    dump(name, "context", selector, contextOffset, 0xb0);

    key = wordAt(selector, contextOffset + 4);
    dump(name, "key", selector, key + 0x80, 0x80);
    dump(name, "key", selector, key + 0x100, 0xc4);

    global = wordAt(selector, key + 0x110);
    dump(name, "global", selector, global, 0xc0);

    /* The glyph's element (`4775`): its arrays, the contours' ends at 10h of
     * it and their count at 14h; the four phantoms follow the last point. */
    x = wordAt(selector, key + 0x54);
    y = wordAt(selector, key + 0x56);
    ox = wordAt(selector, key + 0x58);
    oy = wordAt(selector, key + 0x5a);
    oox = wordAt(selector, key + 0x5c);
    ooy = wordAt(selector, key + 0x5e);
    ends = wordAt(selector, key + 0x64);
    contours = wordAt(selector, key + 0x68);
    last = wordAt(selector, ends + (contours - 1) * 2) + 1;

    wsprintf(probeResult, "contours=%u points=%u", contours, last);
    probe("element", name, probeResult);
    dump(name, "x", selector, x + last * 2, 8);
    dump(name, "y", selector, y + last * 2, 8);
    dump(name, "ox", selector, ox + last * 2, 8);
    dump(name, "oy", selector, oy + last * 2, 8);
    dump(name, "oox", selector, oox + last * 2, 8);
    dump(name, "ooy", selector, ooy + last * 2, 8);
}

typedef void(FAR PASCAL *CONTEXTPROC)(HDC);
typedef void(FAR PASCAL *GLYPHPROC)(LPSTR, WORD, WORD);

static void glyphAt(LPSTR name, WORD angle, WORD character)
{
    HMODULE module = GetModuleHandle(DRIVER);
    GLYPHPROC glyph = (GLYPHPROC)GetProcAddress(module, "GLYPHAT");
    char label[80];

    if (!glyph) {
        probe("call", "GlyphAt", "missing");
        return;
    }

    glyph(name, angle, character);
    drained();
    wsprintf(label, "%s %d %d", name, angle, character);
    readScaler(label);
}

static void font(HDC dc, LPSTR name, LPSTR face, BYTE italic, BYTE charset)
{
    TEXTMETRIC metrics;
    HFONT made = CreateFont(-40, 0, 0, 0, 400, italic, 0, 0, charset, OUT_DEFAULT_PRECIS,
                            CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT old = SelectObject(dc, made);

    probeNote(name);
    GetTextMetrics(dc, &metrics);
    wsprintf(probeResult, "%d %d %d", metrics.tmHeight, metrics.tmAscent, metrics.tmAveCharWidth);
    probe("metrics", name, probeResult);
    drained();

    glyphAt(name, 0, 'A');
    glyphAt(name, 900, 'A');
    glyphAt(name, 450, 'A');
    glyphAt(name, 1800, 'A');
    glyphAt(name, 2700, 'A');
    glyphAt(name, 0, 'A');
    glyphAt(name, 0, 0xe9);

    SelectObject(dc, old);
    DeleteObject(made);
    drained();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    HDC dc;
    HMODULE module;
    CONTEXTPROC setContext;

    probeOpen(OUTPUT);
    OpenFile(LOG, &info, OF_DELETE);
    install();
    findGdiData();

    dc = CreateDC(DRIVER, "Probe", "LPT1:", NULL);
    wsprintf(probeResult, "%d", dc != NULL);
    probe("call", "CreateDC", probeResult);
    drained();

    if (dc) {
        module = GetModuleHandle(DRIVER);
        setContext = (CONTEXTPROC)GetProcAddress(module, "SETCONTEXT");

        if (setContext) {
            setContext(dc);
        }

        font(dc, "Wingdings", "Wingdings", 0, SYMBOL_CHARSET);
        font(dc, "Wingdings slanted", "Wingdings", 1, SYMBOL_CHARSET);
        font(dc, "Arial", "Arial", 0, ANSI_CHARSET);

        wsprintf(probeResult, "%d", DeleteDC(dc));
        probe("call", "DeleteDC", probeResult);
        drained();
    }

    probeFinish();
    return 0;
}
