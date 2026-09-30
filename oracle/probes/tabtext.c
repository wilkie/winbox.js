/*
 * Text with tabs, and text greyed: `TabbedTextOut`, `GetTabbedTextExtent`
 * and `GrayString`, in the System font on the screen, black on white.
 *
 * Each case draws into a cell 160 by 16 at the screen's corner, filled white
 * first, and reads it back:
 *
 * * `rows`: the case and the row, a palette digit a pixel.
 * * `tabbed`: `TabbedTextOut`'s answer, the extent in hexadecimal, and
 *   `GetTabbedTextExtent`'s for the same text and stops.
 * * `gray`: `GrayString`'s answer.
 * * `proc`: for the case drawn by an output procedure, what it was given:
 *   whether its device context was the screen's, the data, and the count.
 *
 * The tab cases: `none`, no stops, "a\tbb\tccc"; `one`, one stop of 40,
 * which repeats; `list`, stops 10, 50 and 90 over "a\tb\tc\td\te"; `origin`,
 * one stop of 40 with the tabs counted from 20, the text at 30.
 * The gray cases: `gray`, the gray stock brush, "Grey", its length and size
 * left nought; `black`, the black brush; `sized`, the gray brush, count 3
 * and the rectangle 20 by 8; `proc`, the gray brush and an output procedure
 * that writes "Proc" with `TextOut`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TABTEXT.OUT"

#define W 160
#define H 16

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HDC screen;
static HDC given;
static LPARAM givenData;
static int givenCount;

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

static void clear(void)
{
    PatBlt(screen, 0, 0, W, H, WHITENESS);
}

static void rows(LPCSTR name)
{
    int x;
    int y;

    for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
            probeResult[x] = digit(GetPixel(screen, x, y));
        }

        probeResult[W] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, probeResult);
    }
}

BOOL FAR PASCAL _export Output(HDC hdc, LPARAM data, int count)
{
    given = hdc;
    givenData = data;
    givenCount = count;
    TextOut(hdc, 0, 0, "Proc", 4);
    return TRUE;
}

static void tabbed(LPCSTR name, int x, LPCSTR text, int count, int *stops, int origin)
{
    LONG drawn;
    DWORD extent;

    clear();
    drawn = TabbedTextOut(screen, x, 0, text, lstrlen(text), count, stops, origin);
    extent = GetTabbedTextExtent(screen, text, lstrlen(text), count, stops);
    wsprintf(probeResult, "%lx;%lx", drawn, extent);
    probe("tabbed", name, probeResult);
    rows(name);
}

static void gray(LPCSTR name, HBRUSH brush, GRAYSTRINGPROC proc, LPARAM data, int count, int w,
                 int h)
{
    BOOL answer;

    clear();
    answer = GrayString(screen, brush, proc, data, count, 4, 2, w, h);
    wsprintf(probeResult, "%d", answer);
    probe("gray", name, probeResult);
    rows(name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static int one[1] = {40};
    static int list[3] = {10, 50, 90};
    static char grey[] = "Grey";
    static char data[] = "unused";
    FARPROC output;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);
    SetTextColor(screen, RGB(0, 0, 0));
    SetBkColor(screen, RGB(255, 255, 255));

    tabbed("none", 0, "a\tbb\tccc", 0, NULL, 0);
    tabbed("one", 0, "a\tbb\tccc", 1, one, 0);
    tabbed("list", 0, "a\tb\tc\td\te", 3, list, 0);
    tabbed("origin", 30, "a\tbb\tccc", 1, one, 20);

    gray("gray", GetStockObject(GRAY_BRUSH), NULL, (LPARAM)(LPSTR)grey, 0, 0, 0);
    gray("black", GetStockObject(BLACK_BRUSH), NULL, (LPARAM)(LPSTR)grey, 0, 0, 0);
    gray("sized", GetStockObject(GRAY_BRUSH), NULL, (LPARAM)(LPSTR)grey, 3, 20, 8);

    output = MakeProcInstance((FARPROC)Output, instance);
    gray("proc", GetStockObject(GRAY_BRUSH), (GRAYSTRINGPROC)output, (LPARAM)(LPSTR)data, 5, 40,
         12);
    wsprintf(probeResult, "screen=%d,data=%d,count=%d", given == screen,
             givenData == (LPARAM)(LPSTR)data, givenCount);
    probe("proc", "given", probeResult);
    FreeProcInstance(output);

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
