/*
 * What the escapement field itself is reduced to.
 *
 * The census left one thing unexplained. Minus nine hundred draws exactly what
 * twenty-seven hundred draws, and forty-five hundred exactly what nine hundred
 * draws -- so the angle wraps, and a full turn is a full turn. But thirty-six
 * hundred, which is a whole turn and therefore the same angle as nought, draws
 * *neither* what nought draws *nor* what the other angles report: Times comes
 * back a pixel taller than both, and so do Courier and Arial.
 *
 * Three groups from one field, where trigonometry gives two. The reading that
 * fits is that the zero test is made on the field as it was given, before any
 * reduction, so a full turn takes the turned path at an angle of nought -- but
 * that does not explain a taller cell than every other turned angle.
 *
 * So the field is swept where it matters: a tenth of a degree either side of
 * nought and of a full turn, two and three turns, the negatives, and the two
 * ends of the sixteen-bit range the field is declared with. Metrics, because
 * the cell height is what separates the three groups, and the ink box, because
 * the direction is what separates a reduction from a clamp.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ROTANGLE.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

#define PEN_X 32
#define PEN_Y 32

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char SPECIMEN[] = "AB";

static int inkAt(int column, int row)
{
    unsigned char value = (unsigned char)bits[row * ROW_BYTES + (column >> 3)];

    return (value & (0x80 >> (column & 7))) == 0;
}

static void probeAngle(LPCSTR face, int height, int escapement)
{
    TEXTMETRIC tm;
    HFONT font;
    HFONT previous;
    int column;
    int row;
    int left = CELL_WIDTH;
    int top = CELL_HEIGHT;
    int right = -1;
    int bottom = -1;
    int count = 0;

    wsprintf(probeArgs, "\"%s\",h=%d,esc=%d", (LPSTR)face, height, escapement);

    font = CreateFont(height, 0, escapement, escapement, FW_NORMAL, 0, 0, 0,
                      ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("angle metrics", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    GetTextMetrics(memory, &tm);

    wsprintf(probeResult, "height=%d,ascent=%d,descent=%d,internal=%d,average=%d,maximum=%d",
             tm.tmHeight, tm.tmAscent, tm.tmDescent, tm.tmInternalLeading,
             tm.tmAveCharWidth, tm.tmMaxCharWidth);
    probe("angle metrics", probeArgs, probeResult);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, TRANSPARENT);

    TextOut(memory, PEN_X, PEN_Y, SPECIMEN, lstrlen(SPECIMEN));

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    for (row = 0; row < CELL_HEIGHT; row++) {
        for (column = 0; column < CELL_WIDTH; column++) {
            if (!inkAt(column, row)) {
                continue;
            }

            count++;

            if (column < left)   { left = column; }
            if (column > right)  { right = column; }
            if (row < top)       { top = row; }
            if (row > bottom)    { bottom = row; }
        }
    }

    wsprintf(probeResult, "box=%d:%d:%d:%d,ink=%d", left, top, right, bottom, count);
    probe("angle box", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

static void sweep(LPCSTR face, int height)
{
    /* Either side of nought. */
    probeAngle(face, height, 0);
    probeAngle(face, height, 1);
    probeAngle(face, height, 2);
    probeAngle(face, height, 5);
    probeAngle(face, height, 10);
    probeAngle(face, height, -1);
    probeAngle(face, height, -2);
    probeAngle(face, height, -10);

    /* Either side of a full turn, which is where the three groups appeared. */
    probeAngle(face, height, 3590);
    probeAngle(face, height, 3595);
    probeAngle(face, height, 3598);
    probeAngle(face, height, 3599);
    probeAngle(face, height, 3600);
    probeAngle(face, height, 3601);
    probeAngle(face, height, 3602);
    probeAngle(face, height, 3610);

    /* More turns, forwards and back. */
    probeAngle(face, height, 7200);
    probeAngle(face, height, 7201);
    probeAngle(face, height, 10800);
    probeAngle(face, height, -3600);
    probeAngle(face, height, -3599);
    probeAngle(face, height, -7200);

    /* A half turn reached two ways, and a quarter reached three. */
    probeAngle(face, height, 1800);
    probeAngle(face, height, -1800);
    probeAngle(face, height, 5400);
    probeAngle(face, height, 900);
    probeAngle(face, height, 4500);
    probeAngle(face, height, -2700);

    /* The ends of the field. */
    probeAngle(face, height, 32767);
    probeAngle(face, height, -32768);
    probeAngle(face, height, 30000);
    probeAngle(face, height, -30000);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "64x64x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("the escapement field swept where a reduction would show");

    sweep("Times New Roman", 16);
    sweep("Arial", 32);
    sweep("MS Sans Serif", 16);

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
