/*
 * GDI's small exports for USER and the system, asked by a program, by
 * ordinal. Handles are never recorded, only whether two are the same.
 *
 * * `private`: `MakeObjectPrivate`'s answers, set and cleared.
 * * `wep`: `WEP`'s answer.
 * * `userbitmap`: `CreateUserBitmap` and `CreateUserDiscardableBitmap`,
 *   and what `GetObject` says of each.
 * * `ehh`: `RectVisible_Ehh` and `RectInRegion_Ehh` beside `RectVisible`
 *   and `RectInRegion`.
 * * `selectbitmap`: `SelectBitmap`, a bitmap and nought.
 * * `movebitmap`: `GDIMoveBitmap`'s answer.
 * * `physfont`: `GetPhysicalFontHandle` -- nought or not, and whether it
 *   changes as another font is selected and drawn with.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIMISC.OUT"

typedef WORD(FAR PASCAL *WORD2PROC)(HANDLE, WORD);
typedef int(FAR PASCAL *WORD1PROC)(HANDLE);
typedef HBITMAP(FAR PASCAL *USERBMPROC)(int, int, UINT, UINT, void FAR *);
typedef HBITMAP(FAR PASCAL *USERDISCPROC)(HDC, int, int);
typedef BOOL(FAR PASCAL *RECTPROC)(HANDLE, RECT FAR *);
typedef HBITMAP(FAR PASCAL *SELBMPROC)(HDC, HBITMAP);

static FARPROC gdiProc(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

static void describe(LPCSTR what, HBITMAP bitmap)
{
    BITMAP info;
    int got;

    _fmemset(&info, 0, sizeof(info));
    got = bitmap ? GetObject(bitmap, sizeof(info), &info) : 0;
    wsprintf(probeResult, "%s got=%d type=%d w=%d h=%d wb=%d planes=%d bits=%d",
             (LPSTR)(bitmap ? "some" : "nought"), got, info.bmType, info.bmWidth, info.bmHeight,
             info.bmWidthBytes, info.bmPlanes, info.bmBitsPixel);
    probe("userbitmap", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WORD2PROC makeObjectPrivate = (WORD2PROC)gdiProc(463);
    WORD1PROC wep = (WORD1PROC)gdiProc(59);
    USERBMPROC createUserBitmap = (USERBMPROC)gdiProc(407);
    USERDISCPROC createUserDiscardableBitmap = (USERDISCPROC)gdiProc(409);
    RECTPROC rectVisibleEhh = (RECTPROC)gdiProc(465);
    RECTPROC rectInRegionEhh = (RECTPROC)gdiProc(466);
    SELBMPROC selectBitmap = (SELBMPROC)gdiProc(195);
    WORD1PROC moveBitmap = (WORD1PROC)gdiProc(401);
    WORD1PROC physicalFont = (WORD1PROC)gdiProc(352);
    static BYTE bits[16] = {0xff, 0, 0x81, 0, 0x42, 0, 0x24, 0, 0x18, 0, 0x24, 0, 0x42, 0, 0x81, 0};
    HBRUSH brush;
    HBITMAP bitmap, other, before;
    HDC memory, screen;
    HRGN region;
    RECT rc;
    HFONT font, old;
    WORD first, second;
    static RECT rects[4] = {{0, 0, 10, 10}, {5, 5, 5, 5}, {20, 20, 10, 10}, {-5, -5, 0, 0}};
    int i;

    probeOpen(OUTPUT);

    brush = CreateSolidBrush(RGB(1, 2, 3));
    wsprintf(probeResult, "%04x", makeObjectPrivate(brush, 1));
    probe("private", "set", probeResult);
    wsprintf(probeResult, "%04x", makeObjectPrivate(brush, 1));
    probe("private", "set again", probeResult);
    wsprintf(probeResult, "%04x", makeObjectPrivate(brush, 0));
    probe("private", "clear", probeResult);
    wsprintf(probeResult, "%04x", makeObjectPrivate(brush, 0));
    probe("private", "clear again", probeResult);
    wsprintf(probeResult, "%04x", makeObjectPrivate(brush, 2));
    probe("private", "two", probeResult);
    wsprintf(probeResult, "%04x", makeObjectPrivate(brush, 0));
    probe("private", "after two", probeResult);
    DeleteObject(brush);

    wsprintf(probeResult, "%d", wep(0));
    probe("wep", "0", probeResult);

    bitmap = createUserBitmap(16, 8, 1, 1, bits);
    describe("user 16x8", bitmap);
    DeleteObject(bitmap);
    screen = GetDC(NULL);
    bitmap = createUserDiscardableBitmap(screen, 20, 10);
    describe("user discardable 20x10", bitmap);
    DeleteObject(bitmap);

    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 40, 30);
    SelectObject(memory, bitmap);
    region = CreateRectRgn(2, 2, 12, 12);

    for (i = 0; i < 4; i++) {
        rc = rects[i];
        wsprintf(probeArgs, "%d,%d,%d,%d", rc.left, rc.top, rc.right, rc.bottom);
        wsprintf(probeResult, "%d %d %d %d", RectVisible(memory, &rc), rectVisibleEhh(memory, &rc),
                 RectInRegion(region, &rc), rectInRegionEhh(region, &rc));
        probe("ehh", probeArgs, probeResult);
    }

    DeleteObject(region);

    other = CreateCompatibleBitmap(screen, 8, 8);
    before = selectBitmap(memory, other);
    wsprintf(probeResult, "%s", (LPSTR)(before == bitmap ? "the bitmap" : before ? "other" : "nought"));
    probe("selectbitmap", "another", probeResult);
    before = selectBitmap(memory, NULL);
    wsprintf(probeResult, "%s", (LPSTR)(before == other ? "the other" : before ? "other" : "nought"));
    probe("selectbitmap", "nought", probeResult);
    before = SelectObject(memory, bitmap);
    wsprintf(probeResult, "%s",
             (LPSTR)(before == other ? "the other" : before == bitmap ? "the bitmap" : before ? "stock" : "nought"));
    probe("selectbitmap", "selected after nought", probeResult);

    wsprintf(probeResult, "%d", moveBitmap(other));
    probe("movebitmap", "a bitmap", probeResult);
    DeleteObject(other);

    first = physicalFont(memory);
    font = CreateFont(-20, 0, 0, 0, 400, 0, 0, 0, ANSI_CHARSET, 0, 0, 0, 0, "Arial");
    old = SelectObject(memory, font);
    TextOut(memory, 0, 0, "A", 1);
    second = physicalFont(memory);
    wsprintf(probeResult, "first=%s second=%s", (LPSTR)(first ? "some" : "nought"),
             (LPSTR)(second ? (second == first ? "same" : "other") : "nought"));
    probe("physfont", "system then arial", probeResult);
    SelectObject(memory, old);
    DeleteObject(font);

    DeleteDC(memory);
    DeleteObject(bitmap);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
