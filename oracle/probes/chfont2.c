/*
 * COMMDLG's Font dialog, `ChooseFont`, beyond what `chfont` records: what
 * it draws, a face and a style typed whole, a hook that answers, and a
 * program's own template. The keys are pressed as a person presses them,
 * through USER's `KEYBD_EVENT`, a timer of the program's taking a step at
 * a time, as `chfont` does.
 *
 * * `pixels`: a region of the dialog read back a row at a time, each pixel
 *   a hex digit, the colour's index in a 4-bit DIB of the screen: the
 *   sample and the colours' box. The lists' rows are `chfont3`'s.
 * * `state`, `faces`, `styles`, `sizes`, `colors`, `box`, `hook`,
 *   `result`: as `chfont` writes them.
 * * `template`: what is left of a template given by handle after the call.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\CHFONT2.OUT"

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
/* Whether the hook answers OK itself, keeping the dialog. */
static int swallowOk;

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

static void alt(BYTE vk, BYTE scan)
{
    key(VK_MENU, 0x38, FALSE);
    press(vk, scan);
    key(VK_MENU, 0x38, TRUE);
}

/* Lower-case letters, digits and spaces typed on the main keyboard. */
static void type(LPCSTR text)
{
    static const BYTE LETTERS[] = {0x1e, 0x30, 0x2e, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17,
                                   0x24, 0x25, 0x26, 0x32, 0x31, 0x18, 0x19, 0x10, 0x13,
                                   0x1f, 0x14, 0x16, 0x2f, 0x11, 0x2d, 0x15, 0x2c};
    static const BYTE DIGITS[] = {0x0b, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a};

    for (; *text; text++) {
        char c = *text;

        if (c >= 'a' && c <= 'z') {
            press((BYTE)(c - 'a' + 'A'), LETTERS[c - 'a']);
        } else if (c >= '0' && c <= '9') {
            press((BYTE)c, DIGITS[c - '0']);
        } else if (c == ' ') {
            press(VK_SPACE, 0x39);
        }
    }
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

/* A combo box's items: its text, and what `how` says of its data. */
static void list(LPCSTR function, LPCSTR what, int id, int how)
{
    HWND combo = GetDlgItem(dialog, id);
    LPSTR out = probeResult;
    int count = (int)SendMessage(combo, CB_GETCOUNT, 0, 0);
    int index;

    out += wsprintf(out, "sel=%d n=%d", (int)SendMessage(combo, CB_GETCURSEL, 0, 0), count);

    for (index = 0; index < count && out < probeResult + sizeof(probeResult) - 80; index++) {
        char text[64];
        DWORD data = SendMessage(combo, CB_GETITEMDATA, index, 0);

        SendMessage(combo, CB_GETLBTEXT, index, (LPARAM)(LPSTR)text);

        if (how == 0) {
            out += wsprintf(out, "|%s=%x", (LPSTR)text, LOWORD(data));
        } else {
            out += wsprintf(out, "|%s=%x", (LPSTR)text, HIWORD(data));
        }
    }

    probe(function, what, probeResult);
}

static void lists(LPCSTR what)
{
    list("faces", what, cmb1, 0);
    list("styles", what, cmb2, 1);
    list("sizes", what, cmb3, 0);
}

static LPSTR boxText;

BOOL FAR PASCAL _export BoxChild(HWND hwnd, LPARAM lParam)
{
    char text[160];

    GetWindowText(hwnd, text, sizeof(text));
    boxText += wsprintf(boxText, "|%s", (LPSTR)text);
    (void)lParam;
    return TRUE;
}

/* The message box in front, its caption and its children's texts. */
static void box(LPCSTR what)
{
    HWND active = GetActiveWindow();
    char caption[80];
    FARPROC thunk = MakeProcInstance((FARPROC)BoxChild, instance);

    GetWindowText(active, caption, sizeof(caption));
    boxText = probeResult;
    boxText += wsprintf(boxText, "dialog=%d caption=%s", active == dialog ? 1 : 0, (LPSTR)caption);
    EnumChildWindows(active, (WNDENUMPROC)thunk, 0);
    FreeProcInstance(thunk);
    probe("box", what, probeResult);
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

/* The sample's rectangle, 444h's, in the dialog's client area. */
static void captureSample(LPCSTR what)
{
    RECT r;
    POINT corner;

    GetWindowRect(GetDlgItem(dialog, stc5), &r);
    corner.x = r.left;
    corner.y = r.top;
    ScreenToClient(dialog, &corner);
    capture(what, dialog, corner.x, corner.y, r.right - r.left, r.bottom - r.top);
}

UINT FAR PASCAL _export Hook(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        dialog = hwnd;
        seenInit = 1;
        return TRUE;
    }

    if (seenInit && message == WM_COMMAND && wParam == IDOK && swallowOk) {
        swallowOk = 0;
        probe("hook", "ok", "answered");
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
            captureSample("sample");
            captureWindow("colors", GetDlgItem(dialog, cmb4));
            press(VK_ESCAPE, 0x01);
        }

        break;
    case 2: /* a face and a style typed whole */
        switch (step) {
        case 1:
            alt('F', 0x21);
            type("times new roman");
            break;
        case 2:
            state("face-typed");
            lists("face-typed");
            alt('Y', 0x15);
            type("bold");
            break;
        case 3:
            state("style-typed");
            captureSample("typed");
            alt('S', 0x1f);
            type("9");
            press(VK_RETURN, 0x1c);
            break;
        }

        break;
    case 3: /* a hook that answers OK itself */
        switch (step) {
        case 1:
            swallowOk = 1;
            press(VK_RETURN, 0x1c);
            break;
        case 2:
            state("swallowed");
            wsprintf(probeResult, "%d", GetActiveWindow() == dialog ? 1 : 0);
            probe("active", "swallowed", probeResult);
            press(VK_ESCAPE, 0x01);
            break;
        }

        break;
    case 4: /* a template of the program's, by name */
    case 5: /* and by handle */
        switch (step) {
        case 1:
            state(run == 4 ? "template" : "handle");
            lists(run == 4 ? "template" : "handle");
            captureSample(run == 4 ? "template" : "handle");
            press(VK_RETURN, 0x1c);
            break;
        }

        break;
    case 6: /* a raster face, without simulations, its sizes limited */
        if (step == 1) {
            state("raster");
            lists("raster");
            captureSample("raster");
            press(VK_ESCAPE, 0x01);
        }

        break;
    case 7: /* a size that is not a number */
        switch (step) {
        case 1:
            alt('S', 0x1f);
            type("ab");
            press(VK_RETURN, 0x1c);
            break;
        case 2:
            box("nan");
            press(VK_RETURN, 0x1c);
            break;
        case 3:
            state("nan");
            press(VK_ESCAPE, 0x01);
            break;
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
    swallowOk = 0;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)timerThunk);
    answer = chooseFont(&cf);
    KillTimer(NULL, timer);
    result(what, answer);
}

int PASCAL WinMain(HINSTANCE current, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    WNDCLASS wc;
    HGLOBAL template;

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

    reset(CF_SCREENFONTS | CF_EFFECTS | CF_USESTYLE);
    choose("typed");

    reset(CF_SCREENFONTS | CF_INITTOLOGFONTSTRUCT);
    lf.lfHeight = -13;
    lf.lfWeight = FW_NORMAL;
    lstrcpy(lf.lfFaceName, "Courier New");
    choose("swallowed");

    reset(CF_SCREENFONTS | CF_ENABLETEMPLATE | CF_EFFECTS | CF_APPLY | CF_SHOWHELP |
          CF_INITTOLOGFONTSTRUCT);
    cf.lpTemplateName = "FONTDLG";
    lf.lfHeight = -16;
    lf.lfWeight = FW_NORMAL;
    lstrcpy(lf.lfFaceName, "Times New Roman");
    choose("template");

    template = LoadResource(instance, FindResource(instance, "FONTDLG", RT_DIALOG));
    reset(CF_SCREENFONTS | CF_ENABLETEMPLATEHANDLE | CF_INITTOLOGFONTSTRUCT);
    cf.hInstance = (HINSTANCE)template;
    lf.lfHeight = -11;
    lf.lfWeight = FW_BOLD;
    lstrcpy(lf.lfFaceName, "Wingdings");
    choose("handle");
    wsprintf(probeResult, "lock=%d", LockResource(template) != NULL ? 1 : 0);
    probe("template", "after", probeResult);
    FreeResource(template);

    reset(CF_SCREENFONTS | CF_NOSIMULATIONS | CF_LIMITSIZE | CF_INITTOLOGFONTSTRUCT);
    cf.nSizeMin = 8;
    cf.nSizeMax = 12;
    lf.lfHeight = -13;
    lf.lfWeight = FW_NORMAL;
    lstrcpy(lf.lfFaceName, "MS Serif");
    choose("raster");

    reset(CF_SCREENFONTS);
    choose("nan");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
