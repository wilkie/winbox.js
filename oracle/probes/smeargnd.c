/*
 * Whether GDI's bold moves the ground.
 *
 * GDI's own bold (`GDI.EXE` seg16 `0030`) draws the string twice: first at
 * x + 1 with the caller's background mode, then at x transparent. Turned text
 * on a VGA and any bold on a Hercules take that path; upright text on a VGA
 * leaves the bold to the driver. If the reading is right, an opaque ground
 * behind a smeared string is painted a device pixel to the right on the first
 * path and not on the second. Every opaque bold record before this drew white
 * on white, which cannot show it; this draws `rotstyle`'s visible ground --
 * white text on black -- at a plain weight and a smeared one.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SMEARGND.OUT"

#define CELL      128
#define ROW_BYTES (CELL / 8)
#define PEN       64

static HDC memory;
static HBITMAP canvas;
static char bits[ROW_BYTES * CELL];

static const char HEX[] = "0123456789abcdef";

static int inkAt(int column, int row)
{
    unsigned char value = (unsigned char)bits[row * ROW_BYTES + (column >> 3)];

    return (value & (0x80 >> (column & 7))) == 0;
}

static void writeInk(void)
{
    LPSTR at;
    int column;
    int row;
    int left = CELL;
    int top = CELL;
    int right = -1;
    int bottom = -1;

    for (row = 0; row < CELL; row++) {
        for (column = 0; column < CELL; column++) {
            if (!inkAt(column, row)) {
                continue;
            }

            if (column < left)   { left = column; }
            if (column > right)  { right = column; }
            if (row < top)       { top = row; }
            if (row > bottom)    { bottom = row; }
        }
    }

    wsprintf(probeResult, "box=%d:%d:%d:%d,rows=", left, top, right, bottom);
    at = probeResult + lstrlen(probeResult);

    for (row = top; right >= 0 && row <= bottom; row++) {
        int nibble = 0;
        int count = 0;

        for (column = left; column <= right; column++) {
            nibble = (nibble << 1) | inkAt(column, row);
            count++;

            if (count == 4) {
                *at++ = HEX[nibble];
                nibble = 0;
                count = 0;
            }
        }

        if (count) {
            *at++ = HEX[(nibble << (4 - count)) & 0x0f];
        }

        if (row < bottom) {
            *at++ = '/';
        }

        /* A record must stay inside the buffer; a box this large is not
         * expected, and a truncated one says so rather than overrunning. */
        if (at - probeResult > 1900) {
            *at++ = '!';
            break;
        }
    }

    *at = '\0';
}

/*
 * One draw. `what` names the variation; the rest are its parameters:
 * the face, the cell, the angle, the weight, the italic, underline and
 * strikeout bytes, the background mode, the alignment, and for `ExtTextOut`
 * its options and rectangle relative to the pen.
 */
static void probeStyle(LPCSTR what, LPCSTR face, int height, int escapement,
                       int weight, int italic, int underline, int strikeout,
                       int mode, UINT align, UINT options, int dl, int dt, int dr, int db)
{
    HFONT font;
    HFONT previous;
    RECT box;

    wsprintf(probeArgs, "%s,\"%s\",h=%d,esc=%d,weight=%d,italic=%d,under=%d,strike=%d,"
             "mode=%d,align=%u,opt=%u,rect=%d:%d:%d:%d",
             (LPSTR)what, (LPSTR)face, height, escapement, weight, italic, underline,
             strikeout, mode, align, options, dl, dt, dr, db);

    font = CreateFont(height, 0, escapement, escapement, weight, (BYTE)italic,
                      (BYTE)underline, (BYTE)strikeout,
                      lstrcmp(face, "Symbol") == 0 ? SYMBOL_CHARSET : ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("style ink", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL, CELL, WHITENESS);

    /* Black text on a black ground would say nothing about where the ground
     * is, so the ground is the background colour of a monochrome bitmap's
     * other value: the text is white on black when the mode is opaque. */
    if (mode == OPAQUE) {
        SetTextColor(memory, RGB(255, 255, 255));
        SetBkColor(memory, RGB(0, 0, 0));
    } else {
        SetTextColor(memory, RGB(0, 0, 0));
        SetBkColor(memory, RGB(255, 255, 255));
    }

    SetBkMode(memory, mode);
    SetTextAlign(memory, align);

    if (lstrcmp(what, "ext") == 0) {
        box.left = PEN + dl;
        box.top = PEN + dt;
        box.right = PEN + dr;
        box.bottom = PEN + db;
        ExtTextOut(memory, PEN, PEN, options, &box, "AB", 2, NULL);
    } else {
        TextOut(memory, PEN, PEN, "AB", 2);
    }

    GetBitmapBits(canvas, (LONG)sizeof(bits), bits);

    writeInk();
    probe("style ink", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

static void sweep(LPCSTR face, int height)
{
    static const int ANGLES[] = { 0, 300, 900, 1800 };
    int index;

    for (index = 0; index < 4; index++) {
        probeStyle("ground", face, height, ANGLES[index], 400, 0, 0, 0, OPAQUE, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("ground", face, height, ANGLES[index], 600, 0, 0, 0, OPAQUE, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL, CELL, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "128x128x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("an opaque ground behind plain and smeared text, upright and turned");

    sweep("Arial", 16);
    sweep("Arial", 24);
    sweep("Times New Roman", 16);
    sweep("Times New Roman", 24);
    sweep("Courier New", 16);
    sweep("Courier New", 24);

    DeleteObject(canvas);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
