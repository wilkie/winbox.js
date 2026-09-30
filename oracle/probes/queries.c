/*
 * Small questions a program asks of USER and GDI, none recorded before.
 *
 * * `ischar`: `IsCharAlpha`, `IsCharAlphaNumeric`, `IsCharUpper` and
 *   `IsCharLower` for each of the 256 characters: 64 hexadecimal digits, the
 *   character's bit set where the answer is not nought, character 0 in the
 *   top bit of the first digit.
 * * `keyboard`: `SetKeyboardState` given bytes `i ^ 5Ah`, then
 *   `GetKeyboardState`'s 256 bytes, and `GetKeyState` of 41h; the state put
 *   back after.
 * * `map`: `MapWindowPoints` of two points, (1, 2) and (30, 40), between a
 *   window, its child, and the screen (`0`): `from>to` and the points after.
 * * `ismenu`: `IsMenu` of a menu, a window, nought, and a menu destroyed.
 * * `insend`: `InSendMessage` outside any message, in a message sent by the
 *   program itself, and in one posted.
 * * `msgpos`: whether `GetMessageTime` and `GetMessagePos` are the time and
 *   point of the message `GetMessage` last returned.
 * * `anypopup`: `AnyPopup` with no pop-up of the program's shown, and with one.
 * * `bkmode`, `textalign`, `extra`: `GetBkMode`, `GetTextAlign` and
 *   `GetTextCharacterExtra` of a new device context, and after each is set.
 * * `dcorg`: `GetDCOrg` of the screen's and of a window's client area, less
 *   the client area's corner on the screen.
 * * `isgdi`: `IsGDIObject` of a pen, a brush, a font, a bitmap, a region, a
 *   palette, a device context, a window, nought, and a pen deleted.
 * * `indirect`: a bitmap made by `CreateBitmapIndirect` from a `BITMAP` of 16
 *   by 2, one plane of one bit, and its bits: what `GetObject` tells of it and
 *   `GetBitmapBits` gives.
 * * `dimension`: `SetBitmapDimension` and `GetBitmapDimension`, and their
 *   `Ex` forms, of a new bitmap.
 * * `mapper`: `SetMapperFlags`' answers, and `GetAspectRatioFilter` and its
 *   `Ex` form before and after it is set to 1.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\QUERIES.OUT"

static const char HEX[] = "0123456789abcdef";

static BOOL inSent;
static BOOL inPosted;

LONG FAR PASCAL _export QueryProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        inSent = InSendMessage();
        return 0;
    }

    if (message == WM_USER + 1) {
        inPosted = InSendMessage();
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void bits(LPCSTR name, BOOL(WINAPI *ask)(char))
{
    int digit;

    for (digit = 0; digit < 64; digit++) {
        int value = 0;
        int bit;

        for (bit = 0; bit < 4; bit++) {
            if (ask((char)(digit * 4 + bit))) {
                value |= 8 >> bit;
            }
        }

        probeResult[digit] = HEX[value];
    }

    probeResult[64] = '\0';
    probe("ischar", name, probeResult);
}

static void points(HWND from, HWND to, LPCSTR name)
{
    POINT at[2];

    at[0].x = 1;
    at[0].y = 2;
    at[1].x = 30;
    at[1].y = 40;
    MapWindowPoints(from, to, at, 2);
    wsprintf(probeResult, "%d,%d;%d,%d", at[0].x, at[0].y, at[1].x, at[1].y);
    probe("map", name, probeResult);
}

static void number(LPCSTR function, LPCSTR args, DWORD value)
{
    wsprintf(probeResult, "%lx", value);
    probe(function, args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HWND child;
    HDC screen;
    HDC dc;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = QueryProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Queries";
    RegisterClass(&kind);

    window = CreateWindow("Queries", "Q", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 50, 60, 300, 200,
                          NULL, NULL, instance, NULL);
    child = CreateWindow("Queries", "C", WS_CHILD | WS_VISIBLE, 10, 20, 100, 80, window,
                         (HMENU)1, instance, NULL);
    UpdateWindow(window);

    bits("alpha", IsCharAlpha);
    bits("alphanumeric", IsCharAlphaNumeric);
    bits("upper", IsCharUpper);
    bits("lower", IsCharLower);

    {
        static BYTE saved[256];
        static BYTE given[256];
        static BYTE got[256];
        int index;
        LPSTR at = probeResult;

        GetKeyboardState(saved);

        for (index = 0; index < 256; index++) {
            given[index] = (BYTE)(index ^ 0x5a);
        }

        SetKeyboardState(given);
        GetKeyboardState(got);

        for (index = 0; index < 256; index++) {
            *at++ = HEX[got[index] >> 4];
            *at++ = HEX[got[index] & 15];
        }

        *at = '\0';
        probe("keyboard", "state", probeResult);
        number("keyboard", "GetKeyState(41h)", (DWORD)(WORD)GetKeyState(0x41));
        SetKeyboardState(saved);
    }

    points(child, window, "child>window");
    points(window, child, "window>child");
    points(child, NULL, "child>screen");
    points(NULL, window, "screen>window");
    points(window, window, "window>window");

    {
        HMENU menu = CreateMenu();
        HMENU gone = CreateMenu();

        DestroyMenu(gone);
        number("ismenu", "menu", IsMenu(menu));
        number("ismenu", "window", IsMenu((HMENU)window));
        number("ismenu", "0", IsMenu(NULL));
        number("ismenu", "destroyed", IsMenu(gone));
        DestroyMenu(menu);
    }

    {
        MSG message;

        number("insend", "outside", InSendMessage());
        SendMessage(window, WM_USER, 0, 0);
        number("insend", "sent", inSent);
        PostMessage(window, WM_USER + 1, 0, 0);

        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&message);
        }

        number("insend", "posted", inPosted);

        PostMessage(window, WM_USER + 2, 0, 0);
        GetMessage(&message, window, WM_USER + 2, WM_USER + 2);
        number("msgpos", "time", GetMessageTime() == (LONG)message.time);
        number("msgpos", "pos", GetMessagePos() == MAKELONG(message.pt.x, message.pt.y));
    }

    {
        HWND popup;

        number("anypopup", "none", AnyPopup());
        popup = CreateWindow("Queries", "P", WS_POPUP | WS_VISIBLE | WS_BORDER, 400, 300, 50, 40,
                             window, NULL, instance, NULL);
        number("anypopup", "one", AnyPopup());
        DestroyWindow(popup);
    }

    screen = GetDC(NULL);
    dc = GetDC(window);

    number("bkmode", "new", GetBkMode(dc));
    SetBkMode(dc, TRANSPARENT);
    number("bkmode", "transparent", GetBkMode(dc));
    number("textalign", "new", GetTextAlign(dc));
    SetTextAlign(dc, TA_BASELINE | TA_CENTER | TA_UPDATECP);
    number("textalign", "set", GetTextAlign(dc));
    number("extra", "new", GetTextCharacterExtra(dc));
    SetTextCharacterExtra(dc, 3);
    number("extra", "set", GetTextCharacterExtra(dc));

    {
        POINT corner;
        DWORD origin = GetDCOrg(dc);

        corner.x = 0;
        corner.y = 0;
        ClientToScreen(window, &corner);
        number("dcorg", "screen", GetDCOrg(screen));
        wsprintf(probeResult, "%d,%d", (int)LOWORD(origin) - corner.x,
                 (int)HIWORD(origin) - corner.y);
        probe("dcorg", "window", probeResult);
    }

    {
        HPEN pen = CreatePen(PS_SOLID, 1, RGB(1, 2, 3));
        HPEN gone = CreatePen(PS_SOLID, 1, RGB(4, 5, 6));
        HBRUSH brush = CreateSolidBrush(RGB(1, 2, 3));
        HFONT font = CreateFont(12, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, "Arial");
        HBITMAP bitmap = CreateBitmap(8, 8, 1, 1, NULL);
        HRGN region = CreateRectRgn(0, 0, 4, 4);
        static struct {
            WORD version;
            WORD count;
            PALETTEENTRY entry;
        } logical = {0x300, 1, {1, 2, 3, 0}};
        HPALETTE palette = CreatePalette((LOGPALETTE FAR *)&logical);

        DeleteObject(gone);
        number("isgdi", "pen", IsGDIObject(pen));
        number("isgdi", "brush", IsGDIObject(brush));
        number("isgdi", "font", IsGDIObject(font));
        number("isgdi", "bitmap", IsGDIObject(bitmap));
        number("isgdi", "region", IsGDIObject(region));
        number("isgdi", "palette", IsGDIObject(palette));
        number("isgdi", "dc", IsGDIObject((HGDIOBJ)dc));
        number("isgdi", "window", IsGDIObject((HGDIOBJ)window));
        number("isgdi", "0", IsGDIObject(NULL));
        number("isgdi", "deleted", IsGDIObject(gone));

        DeleteObject(pen);
        DeleteObject(brush);
        DeleteObject(font);
        DeleteObject(bitmap);
        DeleteObject(region);
        DeleteObject(palette);
    }

    {
        static BYTE pattern[4] = {0x12, 0x34, 0x56, 0x78};
        BITMAP given;
        BITMAP told;
        HBITMAP bitmap;
        BYTE bytes[4];

        given.bmType = 0;
        given.bmWidth = 16;
        given.bmHeight = 2;
        given.bmWidthBytes = 2;
        given.bmPlanes = 1;
        given.bmBitsPixel = 1;
        given.bmBits = pattern;

        bitmap = CreateBitmapIndirect(&given);
        number("indirect", "made", bitmap != NULL);
        GetObject(bitmap, sizeof(told), &told);
        wsprintf(probeResult, "%d,%d,%d,%d,%d,%d", told.bmType, told.bmWidth, told.bmHeight,
                 told.bmWidthBytes, told.bmPlanes, told.bmBitsPixel);
        probe("indirect", "object", probeResult);
        GetBitmapBits(bitmap, 4, bytes);
        wsprintf(probeResult, "%02x%02x%02x%02x", bytes[0], bytes[1], bytes[2], bytes[3]);
        probe("indirect", "bits", probeResult);
        DeleteObject(bitmap);
    }

    {
        HBITMAP bitmap = CreateBitmap(8, 8, 1, 1, NULL);
        SIZE size;

        number("dimension", "get new", GetBitmapDimension(bitmap));
        number("dimension", "set 100,200", SetBitmapDimension(bitmap, 100, 200));
        number("dimension", "get", GetBitmapDimension(bitmap));
        size.cx = size.cy = -1;
        number("dimension", "setex 7,9", SetBitmapDimensionEx(bitmap, 7, 9, &size));
        wsprintf(probeResult, "%d,%d", size.cx, size.cy);
        probe("dimension", "setex old", probeResult);
        size.cx = size.cy = -1;
        number("dimension", "getex", GetBitmapDimensionEx(bitmap, &size));
        wsprintf(probeResult, "%d,%d", size.cx, size.cy);
        probe("dimension", "getex size", probeResult);
        DeleteObject(bitmap);
    }

    {
        SIZE size;

        number("mapper", "filter new", GetAspectRatioFilter(dc));
        number("mapper", "set 1", SetMapperFlags(dc, 1));
        number("mapper", "set 0", SetMapperFlags(dc, 0));
        SetMapperFlags(dc, 1);
        number("mapper", "filter set", GetAspectRatioFilter(dc));
        size.cx = size.cy = -1;
        number("mapper", "filterex", GetAspectRatioFilterEx(dc, &size));
        wsprintf(probeResult, "%d,%d", size.cx, size.cy);
        probe("mapper", "filterex size", probeResult);
    }

    ReleaseDC(window, dc);
    ReleaseDC(NULL, screen);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
