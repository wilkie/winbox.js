/*
 * Turned text on a pixel that is not square.
 *
 * Everything 8u read about turned text was read on a VGA, whose pixel is
 * square. `smeargnd` drew turned text on a Hercules -- 96 by 72 to the inch --
 * and every turned record disagreed, plain as well as smeared: Windows' text
 * at ninety degrees is 21 columns across and 19 rows along where a square
 * reading gives 16 and 26. GDI's turned loop scales the baseline's vertical
 * part by the resolutions' ratio (`GDI.EXE` seg1 `625b`, seg8 `01f0`), so the
 * turn is done in physical space; how, exactly, needs more than 18 records.
 *
 * Single glyphs and pairs in three faces at two cells and seven angles, the
 * ink box and rows and what the string measures -- recorded on the Hercules
 * and, as the square control, on the VGA.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ROTHERC.OUT"

#define WIDTH     128
#define HEIGHT    128
#define ROW_BYTES (WIDTH / 8)

static HDC memory;
static HBITMAP canvas;
static char bits[ROW_BYTES * HEIGHT];

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
    int left = WIDTH;
    int top = HEIGHT;
    int right = -1;
    int bottom = -1;

    for (row = 0; row < HEIGHT; row++) {
        for (column = 0; column < WIDTH; column++) {
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

        if (at - probeResult > 1900) {
            *at++ = '!';
            break;
        }
    }

    *at = '\0';
}

static void probeRun(LPCSTR face, int height, int weight, LPCSTR text,
                     int mode, int escapement, int x, int y)
{
    HFONT font;
    HFONT previous;
    DWORD extent;

    font = CreateFont(height, 0, escapement, escapement, weight, 0, 0, 0,
                      lstrcmp(face, "Symbol") == 0 ? SYMBOL_CHARSET : ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(probeArgs, "\"%s\",h=%d,weight=%d,text=\"%s\",mode=%d,esc=%d,pen=%d:%d",
             (LPSTR)face, height, weight, (LPSTR)text, mode, escapement, x, y);

    if (font == NULL) {
        probe("smear ink", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    /* The ground is the colour of the page, so an opaque draw shows only its
     * ink: what the mode changes is the glyphs, if anything. */
    PatBlt(memory, 0, 0, WIDTH, HEIGHT, WHITENESS);
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, mode);

    TextOut(memory, x, y, text, lstrlen(text));
    GetBitmapBits(canvas, (LONG)sizeof(bits), bits);

    writeInk();

    extent = GetTextExtent(memory, text, lstrlen(text));
    wsprintf(probeResult + lstrlen(probeResult), ",extent=%d", LOWORD(extent));

    probe("smear ink", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static LPCSTR TEXTS[] = { "A", "B", "AB", "l", "ll", "W" };
    static const int ANGLES[] = { 0, 300, 450, 900, 1350, 1800, 2700 };
    static LPCSTR FACES[] = { "Arial", "Times New Roman", "Courier New" };
    HDC screen;
    int size;
    int text;
    int angle;
    int face;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(WIDTH, HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "128x128x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("turned text at seven angles, for a display whose pixel is not square");

    for (face = 0; face < 3; face++) {
        for (size = 16; size <= 24; size += 8) {
            for (text = 0; text < 6; text++) {
                for (angle = 0; angle < 7; angle++) {
                    probeRun(FACES[face], size, 400, TEXTS[text], TRANSPARENT, ANGLES[angle], 64, 64);
                }
            }
        }
    }

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
