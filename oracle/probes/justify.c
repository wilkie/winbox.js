/*
 * `SetTextJustification`: extra pixels spread over a line's break
 * characters, as Write justifies a paragraph.
 *
 * Each case draws into a monochrome bitmap 128 by 16, cleared white, with
 * the justification set just before, and records:
 *
 * * `extent`: what `GetTextExtent` answered for the case's string, after the
 *   justification was set and before anything was drawn.
 * * `glyph`: the bitmap's bits after the case's drawing, as hexadecimal.
 *
 * The cases: an extra that divides evenly over the breaks and one that does
 * not; a line drawn in two parts, with the justification set once for the
 * whole of it, to show whether what is left over carries from one call to
 * the next; a negative extra; justification with character extra; and
 * `ExtTextOut` given its own spacing.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\JUSTIFY.OUT"

#define CELL_WIDTH  128
#define CELL_HEIGHT 16
#define ROW_BYTES   16
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void clear(void)
{
    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, TRANSPARENT);
    SetTextCharacterExtra(memory, 0);
    SetTextJustification(memory, 0, 0);
}

static void record(LPCSTR name)
{
    LPSTR at = probeResult;
    int index;

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';
    probe("glyph", name, probeResult);
}

static void extent(LPCSTR name, LPCSTR text)
{
    DWORD size = GetTextExtent(memory, text, lstrlen(text));

    wsprintf(probeResult, "%d:%d", LOWORD(size), HIWORD(size));
    probe("extent", name, probeResult);
}

/* One string drawn with an extra over a count of breaks. */
static void line(LPCSTR name, LPCSTR text, int extra, int count, int character)
{
    clear();
    SetTextCharacterExtra(memory, character);
    SetTextJustification(memory, extra, count);
    extent(name, text);
    TextOut(memory, 2, 0, text, lstrlen(text));
    record(name);
}

static void cases(LPCSTR face, int height)
{
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                            DEFAULT_PITCH, face);
    HFONT previous;
    char name[80];
    DWORD size;
    int dx[5];

    if (!font) {
        return;
    }

    previous = SelectObject(memory, font);

    wsprintf(name, "%s,%d,even", (LPSTR)face, height);
    line(name, "a b c", 8, 2, 0);
    wsprintf(name, "%s,%d,uneven", (LPSTR)face, height);
    line(name, "a b c d", 7, 3, 0);
    wsprintf(name, "%s,%d,one-break", (LPSTR)face, height);
    line(name, "ab cd", 5, 1, 0);
    wsprintf(name, "%s,%d,negative", (LPSTR)face, height);
    line(name, "a b c", -3, 2, 0);
    wsprintf(name, "%s,%d,with-extra", (LPSTR)face, height);
    line(name, "a b c", 5, 2, 1);

    /* A line in two parts, the justification set once for all three breaks. */
    wsprintf(name, "%s,%d,two-parts", (LPSTR)face, height);
    clear();
    SetTextJustification(memory, 7, 3);
    TextOut(memory, 2, 0, "a b", 3);
    size = GetTextExtent(memory, "a b", 3);
    wsprintf(probeResult, "%d:%d", LOWORD(size), HIWORD(size));
    probe("extent", name, probeResult);
    TextOut(memory, 2 + LOWORD(size), 0, " c d", 4);
    record(name);

    /* ExtTextOut with spacing of its own. */
    wsprintf(name, "%s,%d,ext-dx", (LPSTR)face, height);
    clear();
    SetTextJustification(memory, 8, 2);
    dx[0] = 10;
    dx[1] = 10;
    dx[2] = 10;
    dx[3] = 10;
    dx[4] = 10;
    ExtTextOut(memory, 2, 0, 0, NULL, "a b c", 5, dx);
    record(name);

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);
    SelectObject(memory, canvas);

    cases("MS Sans Serif", 13);
    cases("Arial", 16);

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
