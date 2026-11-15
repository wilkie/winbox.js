/*
 * What GDI hands a printer's driver to realize a pattern brush with: the
 * `LOGBRUSH`'s colour a far pointer to the brush's own copy of its bitmap,
 * a `BITMAP` with its bits after it, and its hatch that block's handle
 * (`GDI.EXE` seg1 `250e`-`255b`, its copy made by `CreatePatternBrush`,
 * seg4 `00a7`). Seen from a driver of the probe's own (`prpatbr.dll.c`,
 * `prdrv.dll.c` under `PRDRV_PATTERN`), which logs what the pointer points
 * at.
 *
 * * Monochrome bitmaps of 8 by 8 and 16 by 12.
 * * Bitmaps compatible with the display, of 8 by 8 and 20 by 10, drawn in.
 * * A brush whose bitmap was deleted before it was selected.
 * * A brush selected into a second context, on a device of its own.
 *
 * * `call`: each call's answer.
 * * `driver`: each line of the driver's log, as it was written.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRPATBR.OUT"
#define LOG "C:\\ORACLE\\PRDRV.LOG"
#define LIBRARY "C:\\WINDOWS\\PRPATBRD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRPATBRD.DRV"
#define DRIVER "PRPATBRD"

static void exact(LPCSTR name, long answer)
{
    wsprintf(probeResult, "%ld", answer);
    probe("call", name, probeResult);
}

static char chunk[4096];

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
    char line[400];
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
                probe("driver", probeArgs, line);
                length = 0;
            } else if (length < (int)sizeof(line) - 1) {
                line[length++] = chunk[at];
            }
        }
    }

    _lclose(file);
    OpenFile(LOG, &info, OF_DELETE);
}

static WORD mono8[8] = {0x00AA, 0x0055, 0x00F0, 0x000F, 0x00CC, 0x0033, 0x0081, 0x007E};
static WORD mono16[12] = {0x01FF, 0x0280, 0x0440, 0x0820, 0x1010, 0x2008,
                          0x4004, 0x8002, 0xAA55, 0x55AA, 0x0F0F, 0xF0F0};

/* A brush selected into the context, logged, and selected out again. */
static void selected(HDC dc, HBRUSH brush, LPCSTR name)
{
    HBRUSH old;

    probeNote(name);
    old = SelectObject(dc, brush);
    exact("SelectObject", old != NULL);
    drained();
    SelectObject(dc, old);
}

/* A bitmap compatible with the display, its pixels of a few colours. */
static HBITMAP drawn(int width, int height)
{
    HDC screen = GetDC(NULL);
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, width, height);
    HBITMAP old = SelectObject(memory, bitmap);
    int x;
    int y;

    PatBlt(memory, 0, 0, width, height, WHITENESS);

    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            if ((x + y) % 3 == 0) {
                SetPixel(memory, x, y, RGB(255, 0, 0));
            } else if ((x * y) % 5 == 1) {
                SetPixel(memory, x, y, RGB(0, 0, 128));
            } else if (x == y) {
                SetPixel(memory, x, y, RGB(0, 0, 0));
            }
        }
    }

    SelectObject(memory, old);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    return bitmap;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    HDC dc;
    HDC other;
    HBITMAP bitmaps[4];
    HBRUSH brushes[5];
    int i;

    probeOpen(OUTPUT);
    OpenFile(LOG, &info, OF_DELETE);
    install();

    dc = CreateDC(DRIVER, "Plain", "LPT1:", NULL);
    exact("CreateDC", dc != NULL);
    drained();

    bitmaps[0] = CreateBitmap(8, 8, 1, 1, mono8);
    bitmaps[1] = CreateBitmap(16, 12, 1, 1, mono16);
    bitmaps[2] = drawn(8, 8);
    bitmaps[3] = drawn(20, 10);

    for (i = 0; i < 4; i++) {
        brushes[i] = CreatePatternBrush(bitmaps[i]);
    }

    selected(dc, brushes[0], "mono 8x8");
    selected(dc, brushes[1], "mono 16x12");
    selected(dc, brushes[2], "colour 8x8");
    selected(dc, brushes[3], "colour 20x10");

    probeNote("bitmap deleted first");
    {
        HBITMAP gone = CreateBitmap(8, 8, 1, 1, mono8);

        brushes[4] = CreatePatternBrush(gone);
        exact("DeleteObject bitmap", DeleteObject(gone));
        selected(dc, brushes[4], "deleted");
    }

    probeNote("second context");
    other = CreateDC(DRIVER, "Plain", "LPT1:", NULL);
    exact("CreateDC", other != NULL);
    SetBrushOrg(other, 3, 5);
    drained();
    selected(other, brushes[0], "second");

    probeNote("deleted");
    for (i = 0; i < 5; i++) {
        exact("DeleteObject", DeleteObject(brushes[i]));
    }

    for (i = 0; i < 4; i++) {
        DeleteObject(bitmaps[i]);
    }

    drained();
    exact("DeleteDC", DeleteDC(other));
    exact("DeleteDC", DeleteDC(dc));
    drained();

    probeFinish();
    return 0;
}
