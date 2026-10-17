/*
 * A list box's text in a bold raster font, and the lists of combo boxes
 * given a dialog's font: what `chfont3` found the Font dialog's lists draw
 * differently, taken apart.
 *
 * MS Sans Serif at 8 points, asked bold, is the VGA's regular strike
 * smeared by the display driver, as a dialog's font is. Drawn
 *
 * * in a plain window's DC: `TextOut`, `ExtTextOut` with no options, with
 *   `ETO_OPAQUE` and a rectangle, and with `ETO_CLIPPED`;
 * * in an owner-drawn list box's rows, with `ExtTextOut`, `ETO_OPAQUE` and
 *   the row's rectangle, as COMMDLG draws its faces and sizes;
 * * in a list box that draws its own strings;
 *
 * and the same in italic, and plain for the control.
 *
 * * `extent`: `GetTextExtent`, `GetCharWidth` of '1' and '2', and the
 *   overhang, for each font.
 * * `pixels`: a region read back a row at a time, each pixel a hex digit,
 *   the colour's index in a 4-bit DIB of the screen (as `chfont3`).
 * * `combo`: a simple combo box and a drop-down one, 87 pixels high, made in
 *   the System font and then given the bold font with `WM_SETFONT`, as a
 *   dialog gives its controls theirs: each list's item height and its
 *   window's size, the drop-down's dropped.
 */

#include "probe.h"
#include <string.h>

#define OUTPUT "C:\\ORACLE\\LBTEXT.OUT"

#define TEXT "1212 Wide"
#define WIDTH 80

static HINSTANCE instance;
static HWND owner;
static HFONT drawing;

static HFONT makeFont(int weight, BYTE italic)
{
    return CreateFont(-11, 0, 0, 0, weight, italic, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, VARIABLE_PITCH | FF_SWISS,
                      "MS Sans Serif");
}

/*
 * A region of a window's client area read back a row at a time, each row
 * copied to a bitmap one pixel high and read as a 4-bit DIB.
 */
static void capture(LPCSTR what, HWND window, int x, int y, int width, int height)
{
    static BYTE bits[256];
    struct {
        BITMAPINFOHEADER header;
        RGBQUAD colours[16];
    } info;
    HDC dc = GetDC(window);
    HDC memory = CreateCompatibleDC(dc);
    HBITMAP row = CreateCompatibleBitmap(dc, width, 1);
    HBITMAP old = SelectObject(memory, row);
    int line;

    wsprintf(probeArgs, "%s size", what);
    wsprintf(probeResult, "%dx%d", width, height);
    probe("pixels", probeArgs, probeResult);

    for (line = 0; line < height; line++) {
        int column;
        LPSTR out = probeResult;

        BitBlt(memory, 0, 0, width, 1, dc, x, y + line, SRCCOPY);
        SelectObject(memory, old);
        _fmemset(&info, 0, sizeof(info));
        info.header.biSize = sizeof(BITMAPINFOHEADER);
        info.header.biWidth = width;
        info.header.biHeight = 1;
        info.header.biPlanes = 1;
        info.header.biBitCount = 4;
        GetDIBits(dc, row, 0, 1, bits, (BITMAPINFO FAR *)&info, DIB_RGB_COLORS);
        SelectObject(memory, row);

        for (column = 0; column < width; column++) {
            BYTE pair = bits[column / 2];
            int index = column & 1 ? pair & 15 : pair >> 4;

            *out++ = (char)(index < 10 ? '0' + index : 'a' + index - 10);
        }

        *out = '\0';
        wsprintf(probeArgs, "%s %d", what, line);
        probe("pixels", probeArgs, probeResult);
    }

    SelectObject(memory, old);
    DeleteObject(row);
    DeleteDC(memory);
    ReleaseDC(window, dc);
}

LRESULT FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_MEASUREITEM) {
        MEASUREITEMSTRUCT FAR *measure = (MEASUREITEMSTRUCT FAR *)lParam;

        measure->itemHeight = 13;
        return TRUE;
    }

    if (message == WM_DRAWITEM) {
        DRAWITEMSTRUCT FAR *draw = (DRAWITEMSTRUCT FAR *)lParam;
        char text[32];
        RECT rect;

        if (draw->itemID == (UINT)-1) {
            return TRUE;
        }

        SendMessage(draw->hwndItem, LB_GETTEXT, draw->itemID, (LPARAM)(LPSTR)text);
        rect = draw->rcItem;
        SetTextColor(draw->hDC, GetSysColor(COLOR_WINDOWTEXT));
        SetBkColor(draw->hDC, GetSysColor(COLOR_WINDOW));
        ExtTextOut(draw->hDC, rect.left + 2, rect.top, ETO_OPAQUE, &rect, text, lstrlen(text),
                   NULL);
        return TRUE;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void extent(LPCSTR what, HFONT font)
{
    HDC dc = GetDC(owner);
    HFONT old = SelectObject(dc, font);
    TEXTMETRIC tm;
    int widths[2];
    DWORD size = GetTextExtent(dc, TEXT, lstrlen(TEXT));
    DWORD one = GetTextExtent(dc, "1", 1);

    GetTextMetrics(dc, &tm);
    GetCharWidth(dc, '1', '2', widths);
    wsprintf(probeResult, "%d,%d one=%d widths=%d,%d overhang=%d height=%d weight=%d", LOWORD(size),
             HIWORD(size), LOWORD(one), widths[0], widths[1], tm.tmOverhang, tm.tmHeight,
             tm.tmWeight);
    probe("extent", what, probeResult);
    SelectObject(dc, old);
    ReleaseDC(owner, dc);
}

/* The text through each call in a plain window's DC, a row of 13 each. */
static void plain(LPCSTR what, HFONT font)
{
    HWND window = CreateWindow("LbTextPlain", "", WS_CHILD | WS_VISIBLE, 4, 4, WIDTH, 13 * 4,
                               owner, NULL, instance, NULL);
    HDC dc;
    HFONT old;
    RECT rect;
    char name[40];

    UpdateWindow(window);
    dc = GetDC(window);
    old = SelectObject(dc, font);
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(255, 255, 255));
    TextOut(dc, 2, 0, TEXT, lstrlen(TEXT));
    ExtTextOut(dc, 2, 13, 0, NULL, TEXT, lstrlen(TEXT), NULL);
    SetRect(&rect, 0, 26, WIDTH, 39);
    ExtTextOut(dc, 2, 26, ETO_OPAQUE, &rect, TEXT, lstrlen(TEXT), NULL);
    SetRect(&rect, 0, 39, WIDTH, 52);
    ExtTextOut(dc, 2, 39, ETO_CLIPPED, &rect, TEXT, lstrlen(TEXT), NULL);
    SelectObject(dc, old);
    ReleaseDC(window, dc);
    wsprintf(name, "%s plain", what);
    capture(name, window, 0, 0, WIDTH, 13 * 4);
    DestroyWindow(window);
}

/* The text in a list box, owner-drawn or drawing its own strings. */
static void list(LPCSTR what, HFONT font, DWORD style)
{
    HWND box = CreateWindow("LISTBOX", "", WS_CHILD | WS_VISIBLE | style, 4, 4, WIDTH + 2,
                            13 * 2 + 2, owner, (HMENU)100, instance, NULL);
    RECT client;
    char name[40];

    SendMessage(box, WM_SETFONT, (WPARAM)font, 0);
    SendMessage(box, LB_ADDSTRING, 0, (LPARAM)(LPSTR)TEXT);
    SendMessage(box, LB_ADDSTRING, 0, (LPARAM)(LPSTR) "Bold Italic");
    InvalidateRect(box, NULL, TRUE);
    UpdateWindow(box);
    GetClientRect(box, &client);
    wsprintf(name, "%s %s", what, (LPSTR)(style & LBS_OWNERDRAWFIXED ? "owner" : "list"));
    capture(name, box, 0, 0, client.right > WIDTH ? WIDTH : client.right, client.bottom);
    DestroyWindow(box);
}

static void font(LPCSTR what, int weight, BYTE italic)
{
    HFONT made = makeFont(weight, italic);

    extent(what, made);
    plain(what, made);
    list(what, made, LBS_OWNERDRAWFIXED | LBS_HASSTRINGS);
    list(what, made, 0);
    DeleteObject(made);
}

/* The list of a simple combo box, its child of class ComboLBox. */
static HWND comboList(HWND combo)
{
    HWND child = GetWindow(combo, GW_CHILD);

    while (child) {
        char name[32];

        GetClassName(child, name, sizeof(name));

        if (lstrcmpi(name, "ComboLBox") == 0) {
            return child;
        }

        child = GetWindow(child, GW_HWNDNEXT);
    }

    return NULL;
}

static void combo(LPCSTR what, DWORD style)
{
    HWND box = CreateWindow("COMBOBOX", "", WS_CHILD | WS_VISIBLE | WS_VSCROLL | style, 100, 4, 80,
                            87, owner, (HMENU)101, instance, NULL);
    HWND list;
    RECT window;
    RECT client;
    RECT dropped;
    LPSTR out = probeResult;
    int index;

    for (index = 0; index < 8; index++) {
        char text[8];

        wsprintf(text, "%d", 8 + index * 2);
        SendMessage(box, CB_ADDSTRING, 0, (LPARAM)(LPSTR)text);
    }

    GetWindowRect(box, &window);
    out += wsprintf(out, "made=%dx%d item=%d", window.right - window.left,
                    window.bottom - window.top, (int)SendMessage(box, CB_GETITEMHEIGHT, 0, 0));
    SendMessage(box, WM_SETFONT, (WPARAM)drawing, 0);
    GetWindowRect(box, &window);
    out += wsprintf(out, " font=%dx%d item=%d,%d", window.right - window.left,
                    window.bottom - window.top, (int)SendMessage(box, CB_GETITEMHEIGHT, 0, 0),
                    (int)SendMessage(box, CB_GETITEMHEIGHT, (WPARAM)-1, 0));

    if ((style & 3) == CBS_SIMPLE) {
        list = comboList(box);
    } else {
        SendMessage(box, CB_SHOWDROPDOWN, TRUE, 0);
        SendMessage(box, CB_GETDROPPEDCONTROLRECT, 0, (LPARAM)(LPRECT)&dropped);
        out += wsprintf(out, " dropped=%d,%d,%d,%d", dropped.left, dropped.top, dropped.right,
                        dropped.bottom);
        list = NULL;
    }

    if (list) {
        GetWindowRect(list, &window);
        GetClientRect(list, &client);
        out += wsprintf(out, " list=%d,%d %dx%d client=%dx%d", window.left, window.top,
                        window.right - window.left, window.bottom - window.top, client.right,
                        client.bottom);
    }

    probe("combo", what, probeResult);

    if ((style & 3) != CBS_SIMPLE) {
        SendMessage(box, CB_SHOWDROPDOWN, FALSE, 0);
    }

    DestroyWindow(box);
}

int PASCAL WinMain(HINSTANCE current, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;

    instance = current;
    probeOpen(OUTPUT);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = OwnerProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "LbTextOwner";
    RegisterClass(&wc);
    wc.lpfnWndProc = DefWindowProc;
    wc.lpszClassName = "LbTextPlain";
    RegisterClass(&wc);
    owner = CreateWindow("LbTextOwner", "Owner", WS_OVERLAPPEDWINDOW, 0, 0, 640, 480, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);
    SetCursorPos(639, 479);

    font("regular", FW_NORMAL, 0);
    font("bold", FW_BOLD, 0);
    font("italic", FW_NORMAL, 1);
    font("bolditalic", FW_BOLD, 1);

    drawing = makeFont(FW_BOLD, 0);
    combo("simple", CBS_SIMPLE);
    combo("simple-nointegral", CBS_SIMPLE | CBS_NOINTEGRALHEIGHT);
    combo("dropdown", CBS_DROPDOWN);
    combo("dropdownlist", CBS_DROPDOWNLIST);
    DeleteObject(drawing);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
