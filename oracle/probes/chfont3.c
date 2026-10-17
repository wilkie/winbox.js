/*
 * COMMDLG's Font dialog, `ChooseFont`: the rows of its three lists as they
 * are drawn -- the faces' and sizes' owner-drawn rows, with the pictures of
 * the faces' types, and the styles' rows, which the list box draws itself.
 * Kept apart from `chfont2` because the rows' text is one of USER's and
 * GDI's own: each list draws its text a pixel a character wider apart on
 * the engines than Windows does, with Microsoft's COMMDLG.DLL as with
 * WinBox's own.
 *
 * * `pixels`: a list's client area read back a row at a time, each pixel a
 *   hex digit, the colour's index in a 4-bit DIB of the screen.
 * * `state`, `result`: as `chfont` writes them.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\CHFONT3.OUT"

typedef BOOL(FAR PASCAL *FONTPROC)(CHOOSEFONT FAR *);
typedef DWORD(FAR PASCAL *ERRORPROC)(void);

static FONTPROC chooseFont;
static ERRORPROC extendedError;
static FARPROC keybdEvent;
static HINSTANCE instance;
static HWND owner;
static HWND dialog;
static CHOOSEFONT cf;
static LOGFONT lf;
static char style[64];
static int run;
static int step;
static FARPROC timerThunk;
static int seenInit;

static WORD keyAX;
static WORD keyBX;

static void key(BYTE vk, BYTE scan, BOOL up)
{
    keyAX = (WORD)vk | (up ? 0x8000 : 0);
    keyBX = scan;

    _asm {
        push si
        push di
        mov ax, keyAX
        mov bx, keyBX
        xor si, si
        xor di, di
        call dword ptr keybdEvent
        pop di
        pop si
    }
}

static void press(BYTE vk, BYTE scan)
{
    key(vk, scan, FALSE);
    key(vk, scan, TRUE);
}

static DWORD error(void)
{
    return extendedError ? extendedError() : 0xffffffffL;
}

static LPSTR logfont(LPSTR out, LOGFONT FAR *f)
{
    return out + wsprintf(out, "%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%s", f->lfHeight,
                          f->lfWidth, f->lfEscapement, f->lfOrientation, f->lfWeight,
                          f->lfItalic, f->lfUnderline, f->lfStrikeOut, f->lfCharSet,
                          f->lfOutPrecision, f->lfClipPrecision, f->lfQuality,
                          f->lfPitchAndFamily, (LPSTR)f->lfFaceName);
}

static void state(LPCSTR what)
{
    static const int IDS[] = {stc1, cmb1, stc2, cmb2, stc3, cmb3, IDOK, IDCANCEL, psh3, pshHelp,
                              grp1, chx1, chx2, stc4, cmb4, grp2, stc5, stc6};
    LPSTR out = probeResult;
    HWND focus = GetFocus();
    char text[80];
    int index;

    for (index = 0; index < (int)(sizeof(IDS) / sizeof(IDS[0])); index++) {
        HWND control = GetDlgItem(dialog, IDS[index]);

        if (!control) {
            out += wsprintf(out, "%x=none ", IDS[index]);
            continue;
        }

        out += wsprintf(out, "%x=%d%d ", IDS[index], IsWindowEnabled(control) ? 1 : 0,
                        IsWindowVisible(control) ? 1 : 0);
    }

    out += wsprintf(out, "focus=%x", focus ? GetDlgCtrlID(focus) : 0);
    GetWindowText(dialog, text, sizeof(text));
    out += wsprintf(out, " caption=%s", (LPSTR)text);
    GetDlgItemText(dialog, cmb1, text, sizeof(text));
    out += wsprintf(out, " face=%s", (LPSTR)text);
    GetDlgItemText(dialog, cmb2, text, sizeof(text));
    out += wsprintf(out, " style=%s", (LPSTR)text);
    GetDlgItemText(dialog, cmb3, text, sizeof(text));
    wsprintf(out, " size=%s", (LPSTR)text);
    probe("state", what, probeResult);
}

/*
 * A region of a window's client area read back a row at a time, each row
 * copied to a bitmap one pixel high and read as a 4-bit DIB: each pixel a
 * hex digit, the index of its colour in the DIB's table.
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

    if (width > 400) {
        width = 400;
    }

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

/* A control's client area read back. */
static void captureWindow(LPCSTR what, HWND window)
{
    RECT client;

    GetClientRect(window, &client);
    capture(what, window, 0, 0, client.right, client.bottom);
}

/* The list box of a simple combo box, its child of class ComboLBox. */
static HWND comboList(int id)
{
    HWND child = GetWindow(GetDlgItem(dialog, id), GW_CHILD);

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

UINT FAR PASCAL _export Hook(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        dialog = hwnd;
        seenInit = 1;
        return TRUE;
    }

    (void)lParam;
    return FALSE;
}

/* One step of the run in hand, a tick of the timer. */
static void next(void)
{
    step++;

    if (!dialog) {
        dialog = GetActiveWindow();
    }

    switch (run) {
    case 1: /* what the dialog draws */
        if (step == 1) {
            state("drawn");
            captureWindow("faces", comboList(cmb1));
            captureWindow("styles", comboList(cmb2));
            captureWindow("sizes", comboList(cmb3));
            press(VK_ESCAPE, 0x01);
        }

        break;
    }
}

void FAR PASCAL _export Tick(HWND hwnd, UINT message, UINT id, DWORD time)
{
    next();
    (void)hwnd;
    (void)message;
    (void)id;
    (void)time;
}

static void result(LPCSTR what, BOOL answer)
{
    LPSTR out = probeResult;

    out += wsprintf(out, "%d,%lx,%d,%lx,%lx,%x,%s,", answer ? 1 : 0, error(), cf.iPointSize,
                    cf.Flags, cf.rgbColors, cf.nFontType, (LPSTR)style);
    logfont(out, &lf);
    probe("result", what, probeResult);
}

static void reset(DWORD flags)
{
    _fmemset(&cf, 0, sizeof(cf));
    _fmemset(&lf, 0, sizeof(lf));
    _fmemset(style, 0, sizeof(style));
    cf.lStructSize = sizeof(cf);
    cf.hwndOwner = owner;
    cf.hInstance = instance;
    cf.lpLogFont = &lf;
    cf.lpszStyle = style;
    cf.Flags = flags | CF_ENABLEHOOK;
    cf.lpfnHook =
        (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))MakeProcInstance((FARPROC)Hook, instance);
    cf.nFontType = 0x5555;
}

static void choose(LPCSTR what)
{
    UINT timer;
    BOOL answer;

    run++;
    step = 0;
    dialog = NULL;
    seenInit = 0;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)timerThunk);
    answer = chooseFont(&cf);
    KillTimer(NULL, timer);
    result(what, answer);
}

int PASCAL WinMain(HINSTANCE current, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    WNDCLASS wc;

    instance = current;
    probeOpen(OUTPUT);
    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    library = LoadLibrary("COMMDLG.DLL");

    if (library >= (HINSTANCE)32) {
        chooseFont = (FONTPROC)GetProcAddress(library, "ChooseFont");
        extendedError = (ERRORPROC)GetProcAddress(library, "CommDlgExtendedError");
    }

    probe("entry", "", keybdEvent && chooseFont && extendedError ? "found" : "missing");

    if (!keybdEvent || !chooseFont || !extendedError) {
        probeFinish();
        return 0;
    }

    timerThunk = MakeProcInstance((FARPROC)Tick, instance);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = DefWindowProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "FontOwner";
    RegisterClass(&wc);
    owner = CreateWindow("FontOwner", "Owner", WS_OVERLAPPEDWINDOW, 0, 0, 640, 480, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);
    SetCursorPos(639, 479);

    reset(CF_SCREENFONTS | CF_EFFECTS | CF_INITTOLOGFONTSTRUCT);
    lf.lfHeight = -16;
    lf.lfWeight = FW_BOLD;
    lf.lfItalic = 1;
    lstrcpy(lf.lfFaceName, "Arial");
    cf.rgbColors = RGB(0, 0, 128);
    choose("drawn");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
