/*
 * What GDI answers about a TrueType font beside drawing it: `GetFontData`,
 * `GetKerningPairs`, `GetCharABCWidths` and `GetOutlineTextMetrics`, for the
 * TrueType faces Windows 3.1 installs at a few sizes, for the System font
 * (a strike, which none of them answer for), into a window's device context
 * and a memory one, and under `MM_LOMETRIC`.
 *
 * Every buffer is filled with AAh first, so what a call leaves alone shows.
 *
 * * `data`: `GetFontData` -- the whole file's size, a table's size, its
 *   first bytes, a read that runs past the table's end, an offset at and
 *   past the end, a table the file lacks, a buffer with no size.
 * * `kern`: `GetKerningPairs` -- the count with no buffer, then eight pairs
 *   as bytes, then all of them, summed.
 * * `abc`: `GetCharABCWidths` for every character, each A,B,C; a range
 *   given backwards.
 * * `otm`: `GetOutlineTextMetrics` -- the size with no buffer, then the
 *   structure as bytes and its strings, then into 40 bytes and 120. Its
 *   filler byte, the 34th, is shown as `??`: GDI leaves there whatever its
 *   stack held.
 *
 * `ttqmap` is the same under `MM_LOMETRIC` (`TTQUERY_MAPPED`).
 */

#include "probe.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\TTQUERY.OUT"
#endif

static const char HEX[] = "0123456789abcdef";

static unsigned char buffer[1024];

static void fill(void FAR *at, UINT size)
{
    _fmemset(at, 0xaa, size);
}

static void hex(LPSTR out, const unsigned char FAR *bytes, UINT count)
{
    UINT i;

    for (i = 0; i < count; i++) {
        *out++ = HEX[(bytes[i] >> 4) & 0x0f];
        *out++ = HEX[bytes[i] & 0x0f];
    }

    *out = '\0';
}

#define TAG(a, b, c, d) ((DWORD)(a) | ((DWORD)(b) << 8) | ((DWORD)(c) << 16) | ((DWORD)(d) << 24))

static void data(HDC hdc, LPCSTR font)
{
    DWORD answer;

    answer = GetFontData(hdc, 0L, 0L, NULL, 0L);
    wsprintf(probeArgs, "%s whole,null", font);
    wsprintf(probeResult, "%08lx", answer);
    probe("data", probeArgs, probeResult);

    answer = GetFontData(hdc, TAG('h', 'e', 'a', 'd'), 0L, NULL, 0L);
    wsprintf(probeArgs, "%s head,null", font);
    wsprintf(probeResult, "%08lx", answer);
    probe("data", probeArgs, probeResult);

    fill(buffer, 64);
    answer = GetFontData(hdc, TAG('h', 'e', 'a', 'd'), 0L, buffer, 20L);
    wsprintf(probeArgs, "%s head,0,20", font);
    wsprintf(probeResult, "%08lx ", answer);
    hex(probeResult + 9, buffer, 24);
    probe("data", probeArgs, probeResult);

    fill(buffer, 64);
    answer = GetFontData(hdc, TAG('h', 'e', 'a', 'd'), 40L, buffer, 40L);
    wsprintf(probeArgs, "%s head,40,40", font);
    wsprintf(probeResult, "%08lx ", answer);
    hex(probeResult + 9, buffer, 44);
    probe("data", probeArgs, probeResult);

    fill(buffer, 64);
    answer = GetFontData(hdc, TAG('h', 'e', 'a', 'd'), 54L, buffer, 8L);
    wsprintf(probeArgs, "%s head,54,8", font);
    wsprintf(probeResult, "%08lx ", answer);
    hex(probeResult + 9, buffer, 8);
    probe("data", probeArgs, probeResult);

    answer = GetFontData(hdc, TAG('h', 'e', 'a', 'd'), 60L, NULL, 0L);
    wsprintf(probeArgs, "%s head,60,null", font);
    wsprintf(probeResult, "%08lx", answer);
    probe("data", probeArgs, probeResult);

    answer = GetFontData(hdc, TAG('h', 'e', 'a', 'd'), 10L, NULL, 4L);
    wsprintf(probeArgs, "%s head,10,null,4", font);
    wsprintf(probeResult, "%08lx", answer);
    probe("data", probeArgs, probeResult);

    fill(buffer, 64);
    answer = GetFontData(hdc, TAG('h', 'e', 'a', 'd'), 0L, buffer, 0L);
    wsprintf(probeArgs, "%s head,0,buffer,0", font);
    wsprintf(probeResult, "%08lx ", answer);
    hex(probeResult + 9, buffer, 4);
    probe("data", probeArgs, probeResult);

    answer = GetFontData(hdc, TAG('k', 'e', 'r', 'n'), 0L, NULL, 0L);
    wsprintf(probeArgs, "%s kern,null", font);
    wsprintf(probeResult, "%08lx", answer);
    probe("data", probeArgs, probeResult);

    answer = GetFontData(hdc, TAG('X', 'Y', 'Z', 'W'), 0L, NULL, 0L);
    wsprintf(probeArgs, "%s XYZW,null", font);
    wsprintf(probeResult, "%08lx", answer);
    probe("data", probeArgs, probeResult);

    fill(buffer, 64);
    answer = GetFontData(hdc, 0L, 0L, buffer, 16L);
    wsprintf(probeArgs, "%s whole,0,16", font);
    wsprintf(probeResult, "%08lx ", answer);
    hex(probeResult + 9, buffer, 16);
    probe("data", probeArgs, probeResult);

    fill(buffer, 64);
    answer = GetFontData(hdc, TAG('c', 'm', 'a', 'p'), 4L, buffer, 32L);
    wsprintf(probeArgs, "%s cmap,4,32", font);
    wsprintf(probeResult, "%08lx ", answer);
    hex(probeResult + 9, buffer, 32);
    probe("data", probeArgs, probeResult);
}

static void kern(HDC hdc, LPCSTR font)
{
    int count, answer, i;
    HGLOBAL block;
    KERNINGPAIR FAR *pairs;
    long first = 0, second = 0, amount = 0, negative = 0;

    count = GetKerningPairs(hdc, 0, NULL);
    wsprintf(probeArgs, "%s null", font);
    wsprintf(probeResult, "%d", count);
    probe("kern", probeArgs, probeResult);

    fill(buffer, 64);
    answer = GetKerningPairs(hdc, 8, (KERNINGPAIR FAR *)buffer);
    wsprintf(probeArgs, "%s 8", font);
    wsprintf(probeResult, "%d ", answer);
    hex(probeResult + lstrlen(probeResult), buffer, 54);
    probe("kern", probeArgs, probeResult);

    if (count <= 0) {
        return;
    }

    block = GlobalAlloc(GMEM_MOVEABLE, (DWORD)(count + 4) * sizeof(KERNINGPAIR));
    pairs = (KERNINGPAIR FAR *)GlobalLock(block);
    fill(pairs, (count + 4) * sizeof(KERNINGPAIR));
    answer = GetKerningPairs(hdc, count + 4, pairs);

    for (i = 0; i < answer; i++) {
        first += (long)pairs[i].wFirst * (i + 1);
        second += (long)pairs[i].wSecond * (i + 1);
        amount += (long)pairs[i].iKernAmount * (i + 1);
        negative += pairs[i].iKernAmount < 0;
    }

    wsprintf(probeArgs, "%s all", font);
    wsprintf(probeResult, "%d first=%ld second=%ld amount=%ld negative=%ld after=%04x", answer,
             first, second, amount, negative, pairs[answer].wFirst);
    probe("kern", probeArgs, probeResult);

    /* The last eight it kept, as bytes. */
    if (answer >= 8) {
        hex(probeResult, (unsigned char FAR *)&pairs[answer - 8], 48);
        probe("kern", "last 8", probeResult);
    }

    GlobalUnlock(block);
    GlobalFree(block);
}

static void abc(HDC hdc, LPCSTR font)
{
    ABC widths[64];
    UINT first;
    BOOL answer;
    LPSTR at;
    int i;

    for (first = 0; first < 256; first += 64) {
        fill(widths, sizeof(widths));
        answer = GetCharABCWidths(hdc, first, first + 63, widths);
        wsprintf(probeArgs, "%s %u-%u", font, first, first + 63);
        wsprintf(probeResult, "%d", answer);
        at = probeResult + lstrlen(probeResult);

        for (i = 0; i < 64; i++) {
            wsprintf(at, " %d,%u,%d", widths[i].abcA, widths[i].abcB, widths[i].abcC);
            at += lstrlen(at);
        }

        probe("abc", probeArgs, probeResult);
    }

    fill(widths, sizeof(widths));
    answer = GetCharABCWidths(hdc, 70, 65, widths);
    wsprintf(probeArgs, "%s 70-65", font);
    wsprintf(probeResult, "%d ", answer);
    hex(probeResult + lstrlen(probeResult), (unsigned char FAR *)widths, 12);
    probe("abc", probeArgs, probeResult);
}

/* The filler byte, the 34th, shown as `??` where it was copied. */
static void masked(LPSTR at, UINT copied)
{
    if (copied > 33) {
        at[66] = '?';
        at[67] = '?';
    }
}

static void otm(HDC hdc, LPCSTR font)
{
    WORD size, answer;
    OUTLINETEXTMETRIC FAR *metric = (OUTLINETEXTMETRIC FAR *)buffer;
    LPSTR at;

    size = GetOutlineTextMetrics(hdc, 0, NULL);
    wsprintf(probeArgs, "%s null", font);
    wsprintf(probeResult, "%u", size);
    probe("otm", probeArgs, probeResult);

    fill(buffer, sizeof(buffer));
    answer = GetOutlineTextMetrics(hdc, sizeof(buffer), metric);
    wsprintf(probeArgs, "%s full", font);
    wsprintf(probeResult, "%u ", answer);
    at = probeResult + lstrlen(probeResult);
    hex(at, buffer, size + 4 < 400 ? size + 4 : 400);
    masked(at, size);
    probe("otm", probeArgs, probeResult);

    fill(buffer, sizeof(buffer));
    answer = GetOutlineTextMetrics(hdc, 40, metric);
    wsprintf(probeArgs, "%s 40", font);
    wsprintf(probeResult, "%u ", answer);
    at = probeResult + lstrlen(probeResult);
    hex(at, buffer, 44);
    masked(at, 40);
    probe("otm", probeArgs, probeResult);

    fill(buffer, sizeof(buffer));
    answer = GetOutlineTextMetrics(hdc, 120, metric);
    wsprintf(probeArgs, "%s 120", font);
    wsprintf(probeResult, "%u ", answer);
    at = probeResult + lstrlen(probeResult);
    hex(at, buffer, 124);
    masked(at, 120);
    probe("otm", probeArgs, probeResult);
}

static void font(HDC hdc, LPCSTR face, int height, int weight, int italic, BYTE charset, BOOL all)
{
    HFONT made, previous;
    char name[64];

    made = CreateFont(height, 0, 0, 0, weight, italic, 0, 0, charset, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, face);
    previous = (HFONT)SelectObject(hdc, made);
    wsprintf(name, "%s/%d/%d%s", face, height, weight, (LPSTR)(italic ? "i" : ""));
    probeNote(name);

    data(hdc, name);
    kern(hdc, name);

    if (all) {
        abc(hdc, name);
    }

    otm(hdc, name);

    SelectObject(hdc, previous);
    DeleteObject(made);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HDC hdc, memory;
    ABC widths[4];
    BOOL answer;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "TtQuery";
    RegisterClass(&kind);
    window = CreateWindow("TtQuery", "TtQuery", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    hdc = GetDC(window);

#ifdef TTQUERY_MAPPED
    probeNote("MM_LOMETRIC");
    SetMapMode(hdc, MM_LOMETRIC);
    font(hdc, "Arial", -60, 400, 0, ANSI_CHARSET, TRUE);
    font(hdc, "Times New Roman", -100, 400, 0, ANSI_CHARSET, FALSE);
    SetMapMode(hdc, MM_TEXT);
    ReleaseDC(window, hdc);
#else
    probeNote("the System font, a strike");
    data(hdc, "System");
    kern(hdc, "System");
    abc(hdc, "System");
    otm(hdc, "System");

    font(hdc, "Arial", -16, 400, 0, ANSI_CHARSET, TRUE);
    font(hdc, "Arial", 40, 700, 0, ANSI_CHARSET, TRUE);
    font(hdc, "Times New Roman", -30, 400, 1, ANSI_CHARSET, TRUE);
    font(hdc, "Times New Roman", -11, 700, 0, ANSI_CHARSET, FALSE);
    font(hdc, "Courier New", -13, 400, 0, ANSI_CHARSET, TRUE);
    font(hdc, "Symbol", -20, 400, 0, SYMBOL_CHARSET, TRUE);
    font(hdc, "Wingdings", -24, 400, 0, SYMBOL_CHARSET, FALSE);
    font(hdc, "Arial", -16, 700, 1, ANSI_CHARSET, FALSE);

    ReleaseDC(window, hdc);

    probeNote("a memory device context");
    memory = CreateCompatibleDC(NULL);
    font(memory, "Arial", -16, 400, 0, ANSI_CHARSET, FALSE);
    DeleteDC(memory);

    probeNote("no device context");
    fill(widths, sizeof(widths));
    answer = GetCharABCWidths(NULL, 65, 66, widths);
    wsprintf(probeResult, "%d ", answer);
    hex(probeResult + lstrlen(probeResult), (unsigned char FAR *)widths, 12);
    probe("abc", "null hdc", probeResult);
    wsprintf(probeResult, "%08lx", GetFontData(NULL, 0L, 0L, NULL, 0L));
    probe("data", "null hdc", probeResult);
    wsprintf(probeResult, "%d", GetKerningPairs(NULL, 0, NULL));
    probe("kern", "null hdc", probeResult);
    wsprintf(probeResult, "%u", GetOutlineTextMetrics(NULL, 0, NULL));
    probe("otm", "null hdc", probeResult);
#endif

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
