/*
 * `DrawText`: where each line goes, where it breaks, what the prefix
 * character does, how tabs expand, and what `DT_CALCRECT` works out.
 *
 * Each case draws into a memory bitmap of the display's own format, white,
 * with the System font in black, inside the rectangle (4, 4) to (164, 54) --
 * or another the case names -- and records:
 *
 * * `answer`: what `DrawText` answered, and the rectangle after it.
 * * `rows`: the bitmap's pixels, a row a record, by case.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DRAWTEXT.OUT"

#define WIDTH 172
#define HEIGHT 60

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

static HDC memory;

static void draw(LPCSTR name, LPCSTR text, int count, int left, int top, int right, int bottom,
                 UINT format)
{
    RECT rect;
    RECT all;
    int answer;
    int x;
    int y;

    all.left = 0;
    all.top = 0;
    all.right = WIDTH;
    all.bottom = HEIGHT;
    FillRect(memory, &all, GetStockObject(WHITE_BRUSH));

    rect.left = left;
    rect.top = top;
    rect.right = right;
    rect.bottom = bottom;
    answer = DrawText(memory, text, count, &rect, format);

    wsprintf(probeResult, "%d,rect=%d:%d:%d:%d", answer, rect.left, rect.top, rect.right,
             rect.bottom);
    probe("answer", name, probeResult);

    /* Only what can have been drawn on: a case that calculates draws
     * nothing, and its rows are recorded all the same. */
    for (y = 0; y < HEIGHT; y++) {
        LPSTR out = probeResult;

        for (x = 0; x < WIDTH; x++) {
            *out++ = digit(GetPixel(memory, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HBITMAP bitmap;
    HBITMAP was;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, WIDTH, HEIGHT);
    was = SelectObject(memory, bitmap);
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));

    /* Along a line: left, centred, right; and up and down a single line. */
    draw("left", "Hello", -1, 4, 4, 164, 54, DT_LEFT);
    draw("center", "Hello", -1, 4, 4, 164, 54, DT_CENTER);
    draw("right", "Hello", -1, 4, 4, 164, 54, DT_RIGHT);
    draw("vcenter", "Hello", -1, 4, 4, 164, 54, DT_SINGLELINE | DT_VCENTER | DT_CENTER);
    draw("bottom", "Hello", -1, 4, 4, 164, 54, DT_SINGLELINE | DT_BOTTOM);
    draw("vcenter-multi", "Hello", -1, 4, 4, 164, 54, DT_VCENTER);
    draw("count", "Hello", 3, 4, 4, 164, 54, DT_LEFT);

    /* Line ends. */
    draw("crlf", "Two\r\nlines", -1, 4, 4, 164, 54, 0);
    draw("lf", "Two\nlines", -1, 4, 4, 164, 54, 0);
    draw("cr", "Two\rlines", -1, 4, 4, 164, 54, 0);
    draw("lfcr", "Two\n\rlines", -1, 4, 4, 164, 54, 0);
    draw("single-crlf", "Two\r\nlines", -1, 4, 4, 164, 54, DT_SINGLELINE);
    draw("center-crlf", "A\r\nlonger line", -1, 4, 4, 164, 54, DT_CENTER);

    /* Breaking at words. */
    draw("wordbreak", "The quick brown fox jumps", -1, 4, 4, 84, 54, DT_WORDBREAK);
    draw("longword", "Unbreakableword x", -1, 4, 4, 44, 54, DT_WORDBREAK);
    draw("spaces", "Hi   there   now", -1, 4, 4, 44, 54, DT_WORDBREAK);
    draw("wordbreak-center", "The quick brown fox", -1, 4, 4, 84, 54, DT_WORDBREAK | DT_CENTER);

    /* The prefix character. */
    draw("prefix", "&File &&x", -1, 4, 4, 164, 54, 0);
    draw("noprefix", "&File", -1, 4, 4, 164, 54, DT_NOPREFIX);
    draw("prefix-end", "End&", -1, 4, 4, 164, 54, 0);
    draw("prefix-center", "E&xit", -1, 4, 4, 164, 54, DT_CENTER);

    /* Tabs. */
    draw("tabs", "a\tb\tc", -1, 4, 4, 164, 54, DT_EXPANDTABS);
    draw("tabstop", "a\tb\tc", -1, 4, 4, 164, 54, DT_EXPANDTABS | DT_TABSTOP | (4 << 8));
    draw("tabs-off", "a\tb", -1, 4, 4, 164, 54, 0);

    /* Calculating, which draws nothing. */
    draw("calc-wrap", "The quick brown fox", -1, 4, 4, 84, 54, DT_CALCRECT | DT_WORDBREAK);
    draw("calc-single", "Hello", -1, 4, 4, 164, 54, DT_CALCRECT | DT_SINGLELINE);
    draw("calc-lines", "Two\r\nlonger lines", -1, 4, 4, 164, 54, DT_CALCRECT);
    draw("calc-empty", "", -1, 4, 4, 164, 54, DT_CALCRECT);
    draw("calc-leading", "Two\r\nlines", -1, 4, 4, 164, 54, DT_CALCRECT | DT_EXTERNALLEADING);

    /* Too much for the rectangle, clipped and not. */
    draw("clip", "A very long line of text", -1, 4, 4, 44, 14, DT_LEFT);
    draw("noclip", "A very long line of text", -1, 4, 4, 44, 14, DT_NOCLIP);
    draw("clip-lines", "One\r\nTwo\r\nThree", -1, 4, 4, 164, 20, 0);

    SelectObject(memory, was);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    probeFinish();

    return 0;
}
