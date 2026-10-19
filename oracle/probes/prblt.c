/*
 * Bitmaps drawn through a printer's driver: `BitBlt`, `PatBlt`,
 * `StretchBlt`, `SetDIBitsToDevice` and `StretchDIBits`. Recorded on the
 * installation with a printer, `vgaprint`.
 *
 * * A driver of the probe's own (`prblt.dll.c`, as `prdrv.dll.c`), which
 *   logs each call GDI makes to it: first on a device that can `BitBlt`
 *   and no more, then on one that can also `StretchBlt`,
 *   `StretchDIBits` and `SetDIBitsToDevice`. A bitmap of a memory context
 *   made compatible with the printer's, one made compatible with the
 *   display's, a pattern, a clip of one rectangle and of two, a stretch,
 *   and a DIB set and stretched.
 * * The PostScript driver, `pscript`, for the Apple LaserWriter Plus,
 *   printing to a file, Print Manager's spooler off: a bitmap of a memory
 *   context compatible with the printer's, copied and stretched, and a
 *   DIB set.
 *
 * * Last, on the device that can only `BitBlt`, a stretch, one flipped, and
 *   a DIB set and stretched: what GDI does itself for such a driver.
 *
 * * `call`: each call's answer.
 * * `driver`: each line of the driver's log, as it was written.
 * * `fallback`: the last part's answers and the driver's lines, apart.
 * * `size`, `line`: the file the PostScript driver wrote, each line from
 *   its first page on.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRBLT.OUT"
#define PRINTED "C:\\ORACLE\\PRBLT.PRN"
#define LOG "C:\\ORACLE\\PRDRV.LOG"
#define LIBRARY "C:\\WINDOWS\\PRBLTD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRBLTD.DRV"
#define DRIVER "PRBLTD"

/* Where GDI draws for a driver that cannot stretch or take a DIB itself:
 * its records apart, as `fallback`. */
static BOOL fallback;

static void exact(LPCSTR name, long answer)
{
    wsprintf(probeResult, "%ld", answer);
    probe(fallback ? "fallback" : "call", name, probeResult);
}

static char chunk[4096];
static char line[512];

/* Each line of the PostScript file from its first page on. */
static void lines(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(PRINTED, &info, OF_READ);
    long size;
    int read;
    int at;
    int length = 0;
    int count = 0;
    BOOL paged = FALSE;

    if (file == HFILE_ERROR) {
        probe("size", "document", "none");
        return;
    }

    size = _llseek(file, 0, 2);
    _llseek(file, 0, 0);
    wsprintf(probeResult, "%ld", size);
    probe("size", "document", probeResult);

    while ((read = _lread(file, chunk, sizeof(chunk))) > 0) {
        for (at = 0; at < read; at++) {
            if (chunk[at] == '\n') {
                if (length > 0 && line[length - 1] == '\r') {
                    length--;
                }

                line[length] = '\0';

                if (!paged && lstrcmp(line, "%%Page: 1 1") == 0) {
                    paged = TRUE;
                }

                if (paged) {
                    wsprintf(probeArgs, "%d", count);
                    probe("line", probeArgs, line);
                }

                count++;
                length = 0;
            } else if (length < 300) {
                line[length++] = chunk[at];
            }
        }
    }

    _lclose(file);
}

/* The driver's file, as GDI looks for it: its name and `.DRV`. */
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

static int lineCount;

/* Each line of the driver's log so far, the log emptied after. */
static void drained(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(LOG, &info, OF_READ);
    int length = 0;
    int read;
    int at;

    if (file == HFILE_ERROR) {
        return;
    }

    while ((read = _lread(file, chunk, sizeof(chunk))) > 0) {
        for (at = 0; at < read; at++) {
            if (chunk[at] == '\n') {
                if (length > 0 && line[length - 1] == '\r') {
                    length--;
                }

                line[length] = '\0';
                wsprintf(probeArgs, "%d", lineCount++);
                probe(fallback ? "fallback" : "driver", probeArgs, line);
                length = 0;
            } else if (length < (int)sizeof(line) - 1) {
                line[length++] = chunk[at];
            }
        }
    }

    _lclose(file);
    OpenFile(LOG, &info, OF_DELETE);
}

/* A DIB of 8 by 8 in sixteen colours. */
static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colors[16];
} picture = {{sizeof(BITMAPINFOHEADER), 8, 8, 1, 4, BI_RGB, 0, 0, 0, 16, 0}};

static BYTE bits[32];
static BYTE pattern[16] = {0xaa, 0, 0x55, 0, 0xaa, 0, 0x55, 0, 0xaa, 0, 0x55, 0, 0xaa, 0, 0x55, 0};

static DOCINFO doc = {sizeof(DOCINFO), "Blits", NULL};

/* Each kind of blit on a context of a driver's. */
static void blits(HDC dc, LPCSTR name, BOOL copies, BOOL stretches)
{
    HDC memory = CreateCompatibleDC(dc);
    HDC screen = CreateCompatibleDC(NULL);
    HBITMAP bitmap = CreateBitmap(16, 8, 1, 1, pattern);
    HBITMAP other = CreateBitmap(16, 8, 1, 1, pattern);
    HBITMAP kept;
    HBITMAP keptScreen;
    char label[64];

    probeNote(name);
    exact("CreateCompatibleDC", memory != NULL);
    exact("memory BITSPIXEL", GetDeviceCaps(memory, BITSPIXEL));
    exact("memory TECHNOLOGY", GetDeviceCaps(memory, TECHNOLOGY));
    kept = SelectObject(memory, bitmap);
    exact("SelectObject bitmap", kept != NULL);
    keptScreen = SelectObject(screen, other);
    drained();

    if (!copies) {
        goto stretched;
    }

    wsprintf(label, "%s BitBlt", name);
    exact(label, BitBlt(dc, 5, 6, 16, 8, memory, 0, 0, SRCCOPY));
    drained();

    wsprintf(label, "%s BitBlt part", name);
    exact(label, BitBlt(dc, 30, 6, 8, 4, memory, 4, 2, SRCINVERT));
    drained();

    wsprintf(label, "%s BitBlt from the display's", name);
    exact(label, BitBlt(dc, 5, 20, 16, 8, screen, 0, 0, SRCCOPY));
    drained();

    wsprintf(label, "%s PatBlt", name);
    exact(label, PatBlt(dc, 40, 20, 10, 10, PATCOPY));
    drained();

    SaveDC(dc);
    IntersectClipRect(dc, 0, 0, 10, 48);
    wsprintf(label, "%s BitBlt clipped", name);
    exact(label, BitBlt(dc, 5, 30, 16, 8, memory, 0, 0, SRCCOPY));
    drained();
    RestoreDC(dc, -1);

    SaveDC(dc);
    ExcludeClipRect(dc, 8, 30, 12, 34);
    wsprintf(label, "%s BitBlt around a hole", name);
    exact(label, BitBlt(dc, 5, 30, 16, 8, memory, 0, 0, SRCCOPY));
    drained();
    RestoreDC(dc, -1);

stretched:
    if (!stretches) {
        goto done;
    }

    wsprintf(label, "%s StretchBlt", name);
    exact(label, StretchBlt(dc, 30, 30, 32, 16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    wsprintf(label, "%s StretchBlt flipped", name);
    exact(label, StretchBlt(dc, 62, 30, -32, 16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    wsprintf(label, "%s SetDIBitsToDevice", name);
    exact(label, SetDIBitsToDevice(dc, 2, 2, 8, 8, 0, 0, 0, 8, bits, (LPBITMAPINFO)&picture,
                                   DIB_RGB_COLORS));
    drained();

    wsprintf(label, "%s StretchDIBits", name);
    exact(label, StretchDIBits(dc, 40, 2, 16, 16, 0, 0, 8, 8, bits, (LPBITMAPINFO)&picture,
                               DIB_RGB_COLORS, SRCCOPY));
    drained();

done:
    SelectObject(memory, kept);
    SelectObject(screen, keptScreen);
    exact("DeleteDC memory", DeleteDC(memory));
    DeleteDC(screen);
    DeleteObject(bitmap);
    DeleteObject(other);
    drained();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    HDC dc;
    int i;

    probeOpen(OUTPUT);

    for (i = 0; i < 16; i++) {
        picture.colors[i].rgbRed = (BYTE)(i & 1 ? 255 : 0);
        picture.colors[i].rgbGreen = (BYTE)(i & 2 ? 255 : 0);
        picture.colors[i].rgbBlue = (BYTE)(i & 4 ? 255 : 0);
    }

    for (i = 0; i < 32; i++) {
        bits[i] = (BYTE)(i * 0x13);
    }

    install();
    OpenFile(LOG, &info, OF_DELETE);

    dc = CreateDC(DRIVER, "X", "LPT1:", NULL);
    exact("CreateDC X", dc != NULL);
    drained();
    blits(dc, "X", TRUE, FALSE);
    exact("DeleteDC X", DeleteDC(dc));
    drained();

    dc = CreateDC(DRIVER, "XSD", "LPT1:", NULL);
    exact("CreateDC XSD", dc != NULL);
    drained();
    blits(dc, "XSD", TRUE, TRUE);
    exact("DeleteDC XSD", DeleteDC(dc));
    drained();

    /* The PostScript driver. */
    probeNote("pscript");
    WriteProfileString("windows", "spooler", "no");
    OpenFile(PRINTED, &info, OF_DELETE);
    dc = CreateDC("pscript", "Apple LaserWriter Plus", PRINTED, NULL);
    exact("CreateDC pscript", dc != NULL);
    exact("StartDoc", StartDoc(dc, &doc));
    exact("StartPage", StartPage(dc));
    {
        HDC memory = CreateCompatibleDC(dc);
        HBITMAP bitmap = CreateBitmap(16, 8, 1, 1, pattern);
        HBITMAP kept = SelectObject(memory, bitmap);

        exact("pscript memory BITSPIXEL", GetDeviceCaps(memory, BITSPIXEL));
        exact("pscript BitBlt", BitBlt(dc, 300, 300, 16, 8, memory, 0, 0, SRCCOPY));
        exact("pscript StretchBlt", StretchBlt(dc, 300, 400, 160, 80, memory, 0, 0, 16, 8, SRCCOPY));
        exact("pscript PatBlt", PatBlt(dc, 600, 300, 100, 100, PATCOPY));
        exact("pscript SetDIBitsToDevice", SetDIBitsToDevice(dc, 300, 600, 8, 8, 0, 0, 0, 8, bits,
                                                            (LPBITMAPINFO)&picture,
                                                            DIB_RGB_COLORS));
        SelectObject(memory, kept);
        DeleteDC(memory);
        DeleteObject(bitmap);
    }
    i = EndPage(dc);

    /* The PostScript driver answers `NEWFRAME` with its job, the handle
     * `OpenJob` gave it: the size of the block it names, shifted back left
     * (as `prdoc.c`). */
    if (i > 0) {
        wsprintf(probeResult, "job %ld", GlobalSize((HGLOBAL)(i << 1)));
        probe("call", "EndPage", probeResult);
    } else {
        exact("EndPage", i);
    }

    exact("EndDoc", EndDoc(dc));
    exact("DeleteDC pscript", DeleteDC(dc));
    WriteProfileString("windows", "spooler", "yes");
    lines();

    /* GDI's own stretching and DIBs, for a driver that can only BitBlt. */
    fallback = TRUE;
    dc = CreateDC(DRIVER, "X", "LPT1:", NULL);
    drained();
    blits(dc, "X", FALSE, TRUE);
    DeleteDC(dc);
    drained();

    probeFinish();
    return 0;
}
