/*
 * Drawing not yet recorded: a pen of PS_INSIDEFRAME around an arc and
 * under a mapping mode, a rounded rectangle whose wide pen leaves nothing
 * of its inner corner, and hatched and pattern brushes into a monochrome
 * bitmap.
 *
 * Each shape is drawn in a cell of its own, 32 by 32, on the screen over
 * white, with a black pen and a light grey brush, and the cell is read back:
 *
 * * `shape`: the case, what it was -- its function, rectangle in the cell,
 *   the corner or the radials' two points, whether it was drawn at twice the
 *   size by MM_ANISOTROPIC (`x2`, its numbers then logical), the pen's style
 *   and width.
 * * `ellipse`, `roundrect`, `rectangle`, `arc`: the case and the row; the row,
 *   a palette digit a pixel.
 * * `mono`: a brush filled with PATCOPY over a monochrome bitmap 16 by 16,
 *   its text colour black and its background white; its bits by
 *   GetBitmapBits, in hexadecimal: `hatch` HS_DIAGCROSS in black, `redhatch`
 *   the same in red, `pattern` a pattern brush of a monochrome 8 by 8
 *   bitmap, `colour` one of a bitmap compatible with the screen, its left
 *   half red and its right half white.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DRAWGAPS.OUT"

#define CELL 32
#define ACROSS 7

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

/* kind: 0 ellipse, 1 roundrect, 4 rectangle, 5 arc; a, b, c, d the corner or
 * the radials; scaled: drawn at twice the size. */
struct Shape {
    int kind;
    int left, top, right, bottom;
    int a, b, c, d;
    int scaled;
    int style;
    int width;
};

static const struct Shape SHAPES[] = {
    {5, 2, 2, 30, 30, 30, 16, 16, 2, 0, PS_INSIDEFRAME, 4},
    {5, 2, 2, 30, 30, 2, 16, 30, 16, 0, PS_INSIDEFRAME, 4},
    {5, 2, 2, 30, 30, 30, 16, 30, 16, 0, PS_INSIDEFRAME, 4},
    {5, 2, 2, 30, 30, 30, 16, 16, 2, 0, PS_SOLID, 4},
    {0, 1, 1, 15, 15, 0, 0, 0, 0, 1, PS_INSIDEFRAME, 2},
    {4, 1, 1, 15, 15, 0, 0, 0, 0, 1, PS_INSIDEFRAME, 2},
    {0, 1, 1, 15, 15, 0, 0, 0, 0, 1, PS_SOLID, 2},
    {1, 2, 2, 30, 30, 8, 8, 0, 0, 0, PS_SOLID, 6},
    {1, 2, 2, 30, 30, 8, 8, 0, 0, 0, PS_SOLID, 8},
    {1, 2, 2, 30, 30, 8, 8, 0, 0, 0, PS_INSIDEFRAME, 6},
    {1, 2, 2, 30, 30, 12, 4, 0, 0, 0, PS_SOLID, 6},
};

static void mono(LPCSTR what, HBRUSH brush)
{
    HDC screen = GetDC(NULL);
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateBitmap(16, 16, 1, 1, NULL);
    HBITMAP old = SelectObject(memory, bitmap);
    HBRUSH was;
    BYTE bits[32];
    LPSTR at = probeResult;
    int index;

    PatBlt(memory, 0, 0, 16, 16, WHITENESS);
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    was = SelectObject(memory, brush);
    PatBlt(memory, 0, 0, 16, 16, PATCOPY);
    SelectObject(memory, was);
    GetBitmapBits(bitmap, sizeof(bits), bits);

    for (index = 0; index < (int)sizeof(bits); index++) {
        *at++ = HEX[bits[index] >> 4];
        *at++ = HEX[bits[index] & 15];
    }

    *at = '\0';
    probe("mono", what, probeResult);

    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    DeleteObject(brush);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *KINDS[6] = {"ellipse", "roundrect", "", "", "rectangle", "arc"};
    static const WORD PATTERN[8] = {0x0f, 0x1e, 0x3c, 0x78, 0xf0, 0xe1, 0xc3, 0x87};
    HDC screen;
    HBITMAP bitmap;
    int count = sizeof(SHAPES) / sizeof(SHAPES[0]);
    int index;
    int x;
    int y;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);
    PatBlt(screen, 0, 0, CELL * ACROSS, CELL * ((count + ACROSS - 1) / ACROSS), WHITENESS);

    for (index = 0; index < count; index++) {
        const struct Shape *s = &SHAPES[index];
        int cx = (index % ACROSS) * CELL;
        int cy = (index / ACROSS) * CELL;
        HPEN pen = CreatePen(s->style, s->width, RGB(0, 0, 0));
        HPEN oldPen = SelectObject(screen, pen);
        HBRUSH oldBrush = SelectObject(screen, GetStockObject(LTGRAY_BRUSH));
        int ox = cx;
        int oy = cy;

        if (s->scaled) {
            SetMapMode(screen, MM_ANISOTROPIC);
            SetWindowExt(screen, 1, 1);
            SetViewportExt(screen, 2, 2);
            SetViewportOrg(screen, cx, cy);
            ox = 0;
            oy = 0;
        }

        if (s->kind == 0) {
            Ellipse(screen, ox + s->left, oy + s->top, ox + s->right, oy + s->bottom);
        } else if (s->kind == 1) {
            RoundRect(screen, ox + s->left, oy + s->top, ox + s->right, oy + s->bottom, s->a, s->b);
        } else if (s->kind == 4) {
            Rectangle(screen, ox + s->left, oy + s->top, ox + s->right, oy + s->bottom);
        } else {
            Arc(screen, ox + s->left, oy + s->top, ox + s->right, oy + s->bottom, ox + s->a,
                oy + s->b, ox + s->c, oy + s->d);
        }

        if (s->scaled) {
            SetMapMode(screen, MM_TEXT);
            SetViewportOrg(screen, 0, 0);
        }

        SelectObject(screen, oldPen);
        SelectObject(screen, oldBrush);
        DeleteObject(pen);

        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "%s,%d:%d:%d:%d,%d:%d:%d:%d,x2=%d,style=%d,width=%d",
                 (LPSTR)KINDS[s->kind], s->left, s->top, s->right, s->bottom, s->a, s->b, s->c,
                 s->d, s->scaled, s->style, s->width);
        probe("shape", probeArgs, probeResult);
    }

    for (index = 0; index < count; index++) {
        int cx = (index % ACROSS) * CELL;
        int cy = (index / ACROSS) * CELL;

        for (y = 0; y < CELL; y++) {
            LPSTR at = probeResult;

            for (x = 0; x < CELL; x++) {
                *at++ = digit(GetPixel(screen, cx + x, cy + y));
            }

            *at = '\0';
            wsprintf(probeArgs, "%d,y=%d", index, y);
            probe(KINDS[SHAPES[index].kind], probeArgs, probeResult);
        }
    }

    mono("hatch", CreateHatchBrush(HS_DIAGCROSS, RGB(0, 0, 0)));
    mono("redhatch", CreateHatchBrush(HS_DIAGCROSS, RGB(255, 0, 0)));

    bitmap = CreateBitmap(8, 8, 1, 1, PATTERN);
    mono("pattern", CreatePatternBrush(bitmap));
    DeleteObject(bitmap);

    {
        HDC memory = CreateCompatibleDC(screen);
        HBITMAP colour = CreateCompatibleBitmap(screen, 8, 8);
        HBITMAP old = SelectObject(memory, colour);
        HBRUSH red = CreateSolidBrush(RGB(255, 0, 0));
        RECT left = {0, 0, 4, 8};
        RECT right = {4, 0, 8, 8};

        FillRect(memory, &left, red);
        FillRect(memory, &right, GetStockObject(WHITE_BRUSH));
        DeleteObject(red);
        SelectObject(memory, old);
        DeleteDC(memory);
        mono("colour", CreatePatternBrush(colour));
        DeleteObject(colour);
    }

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
