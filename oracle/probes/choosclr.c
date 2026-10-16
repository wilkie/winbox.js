/*
 * COMMDLG's Color dialog, `ChooseColor`, as programs use it and as a
 * person does: with the keys and the mouse, through USER's `KEYBD_EVENT`
 * and `MOUSE_EVENT`, a timer of the program's taking a step at a time.
 *
 * * `error`: each call that fails, what it answers and
 *   `CommDlgExtendedError` after it.
 * * `state`: whether each control is enabled and shown, the focus, and the
 *   dialog's rectangle.
 * * `pixels`: the dialog, a row of the screen at a time, each pixel the
 *   letter of its colour of the sixteen (a for black to p for white), runs
 *   as the letter and its count.
 * * `edits`: the six numbers of the full dialog, hue, saturation and
 *   luminosity, red, green and blue, as the dialog shows them.
 * * `rgb`: a colour given with `SETRGBSTRING`'s message, and the edits after.
 * * `hls`: hue, saturation and luminosity typed, and the edits after.
 * * `hook`: the messages the hook was given that are not of its own
 *   making: `WM_INITDIALOG`'s `lParam` and `COLOROKSTRING`'s.
 * * `result`: what `ChooseColor` answered, `rgbResult` and the custom
 *   colours.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\CHOOSCLR.OUT"

#define SF_ABSOLUTE 0x8000
#define MOVE 0x0001
#define LEFTDOWN 0x0002
#define LEFTUP 0x0004

typedef BOOL(FAR PASCAL *COLORPROC)(CHOOSECOLOR FAR *);
typedef DWORD(FAR PASCAL *ERRORPROC)(void);

static COLORPROC chooseColor;
static ERRORPROC extendedError;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static HINSTANCE instance;
static HWND owner;
static HWND dialog;
static UINT okMessage;
static UINT rgbMessage;
static CHOOSECOLOR cc;
static COLORREF custom[16];
static int run;
static int step;
static int okRefusals;
static FARPROC timerThunk;

static const char LETTERS[] = "abcdefghijklmnop";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

/* Colours given with SETRGBSTRING, and the hue, saturation and luminosity
 * each turns into. */
static const COLORREF COLOURS[] = {
    RGB(0, 0, 0),       RGB(255, 255, 255), RGB(255, 0, 0),     RGB(0, 255, 0),
    RGB(0, 0, 255),     RGB(128, 128, 128), RGB(192, 192, 192), RGB(128, 0, 0),
    RGB(255, 128, 64),  RGB(12, 34, 56),    RGB(200, 100, 50),  RGB(1, 2, 3),
    RGB(254, 253, 252), RGB(17, 200, 99),   RGB(99, 17, 200),   RGB(200, 99, 17),
    RGB(255, 255, 0),   RGB(0, 255, 255),   RGB(255, 0, 255),   RGB(64, 0, 0),
    RGB(0, 64, 128),    RGB(250, 5, 130),   RGB(77, 77, 78),    RGB(128, 64, 200),
};

/* Hue, saturation and luminosity typed, and the colour each makes. */
static const int HLS[][3] = {
    {0, 240, 120},  {80, 240, 120}, {160, 240, 120}, {40, 120, 60},  {200, 60, 200},
    {239, 240, 240}, {10, 0, 100},  {120, 240, 1},   {30, 200, 119}, {170, 100, 121},
    {300, 300, 300}, {5, 239, 239}, {100, 1, 120},   {225, 180, 90}, {60, 240, 180},
};

static char letter(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return LETTERS[index];
        }
    }

    return '?';
}

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

static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static void mouse(WORD flags, WORD x, WORD y)
{
    mouseFlags = flags;
    mouseX = x;
    mouseY = y;

    _asm {
        push si
        push di
        mov ax, mouseFlags
        mov bx, mouseX
        mov cx, mouseY
        mov dx, 2
        xor si, si
        xor di, di
        call dword ptr mouseEvent
        pop di
        pop si
    }
}

static WORD across(int x)
{
    return (WORD)(((DWORD)x * 65536L + GetSystemMetrics(SM_CXSCREEN) - 1) /
                  GetSystemMetrics(SM_CXSCREEN));
}

static WORD down(int y)
{
    return (WORD)(((DWORD)y * 65536L + GetSystemMetrics(SM_CYSCREEN) - 1) /
                  GetSystemMetrics(SM_CYSCREEN));
}

/* The left button pressed at one point of the screen and let go at another. */
static void drag(int x, int y, int toX, int toY)
{
    mouse(SF_ABSOLUTE | MOVE, across(x), down(y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(x), down(y));
    mouse(SF_ABSOLUTE | MOVE, across(toX), down(toY));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(toX), down(toY));
    mouse(SF_ABSOLUTE | MOVE, across(639), down(479));
}

static void click(int x, int y)
{
    drag(x, y, x, y);
}

/* A point of one of the dialog's controls, from its top left corner. */
static void clickIn(int id, int x, int y)
{
    RECT r;

    GetWindowRect(GetDlgItem(dialog, id), &r);
    click(r.left + x, r.top + y);
}

/* One of a grid's boxes, by its row and column. */
static void clickBox(int id, int rows, int row, int column)
{
    RECT r;
    int width;
    int height;

    GetWindowRect(GetDlgItem(dialog, id), &r);
    width = (r.right - r.left - 6) / 8;
    height = (r.bottom - r.top - 6) / rows;
    click(r.left + 3 + column * width + 2, r.top + 3 + row * height + 2);
}

static DWORD error(void)
{
    return extendedError ? extendedError() : 0xffffffffL;
}

static void state(LPCSTR what)
{
    static const int IDS[] = {0x2d0, 0x2d1, 0x2cf, IDOK, IDCANCEL, pshHelp, 0x2c6, 0x2be, 0x2c5,
                              0x2c9, 0x2d3, 0x2bf, 0x2d4, 0x2c0, 0x2d5, 0x2c1, 0x2d6, 0x2c2,
                              0x2d7, 0x2c3, 0x2d8, 0x2c4, 0x2c8};
    LPSTR out = probeResult;
    HWND focus = GetFocus();
    RECT r;
    int index;

    for (index = 0; index < (int)(sizeof(IDS) / sizeof(IDS[0])); index++) {
        HWND control = GetDlgItem(dialog, IDS[index]);

        if (!control) {
            out += wsprintf(out, "%x=none ", IDS[index]);
            continue;
        }

        out += wsprintf(out, "%x=%d%d%d ", IDS[index], IsWindowEnabled(control) ? 1 : 0,
                        IsWindowVisible(control) ? 1 : 0,
                        (GetWindowLong(control, GWL_STYLE) & WS_TABSTOP) ? 1 : 0);
    }

    GetWindowRect(dialog, &r);
    wsprintf(out, "focus=%x rect=%d,%d,%d,%d", focus ? GetDlgCtrlID(focus) : 0, r.left, r.top,
             r.right, r.bottom);
    probe("state", what, probeResult);
}

static void edits(LPSTR out)
{
    int id;

    for (id = 0x2bf; id <= 0x2c4; id++) {
        char text[16];

        GetDlgItemText(dialog, id, text, sizeof(text));
        out += wsprintf(out, "%s%s", (LPSTR)(id == 0x2bf ? "" : ","), (LPSTR)text);
    }
}

static void recordEdits(LPCSTR what)
{
    edits(probeResult);
    probe("edits", what, probeResult);
}

static void pixels(LPCSTR what)
{
    RECT r;
    HDC dc;
    int x;
    int y;

    HideCaret(NULL);
    GetWindowRect(dialog, &r);
    dc = GetDC(NULL);

    for (y = r.top; y < r.bottom; y++) {
        LPSTR out = probeResult;
        char last = 0;
        int count = 0;

        for (x = r.left; x <= r.right; x++) {
            char now = x < r.right ? letter(GetPixel(dc, x, y)) : 0;

            if (now == last) {
                count++;
                continue;
            }

            if (count) {
                *out++ = last;

                if (count > 1) {
                    out += wsprintf(out, "%d", count);
                }
            }

            last = now;
            count = 1;
        }

        *out = '\0';
        wsprintf(probeArgs, "%s %d", what, y - r.top);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, dc);
    ShowCaret(NULL);
}

static void conversions(void)
{
    int index;

    for (index = 0; index < (int)(sizeof(COLOURS) / sizeof(COLOURS[0])); index++) {
        SendMessage(dialog, rgbMessage, 0, COLOURS[index]);
        wsprintf(probeArgs, "%lx", COLOURS[index]);
        edits(probeResult);
        probe("rgb", probeArgs, probeResult);
    }

    for (index = 0; index < (int)(sizeof(HLS) / sizeof(HLS[0])); index++) {
        SetDlgItemInt(dialog, 0x2bf, HLS[index][0], FALSE);
        SetDlgItemInt(dialog, 0x2c0, HLS[index][1], FALSE);
        SetDlgItemInt(dialog, 0x2c1, HLS[index][2], FALSE);
        wsprintf(probeArgs, "%d,%d,%d", HLS[index][0], HLS[index][1], HLS[index][2]);
        edits(probeResult);
        probe("hls", probeArgs, probeResult);
    }

    SetDlgItemInt(dialog, 0x2c2, 300, FALSE);
    SetDlgItemInt(dialog, 0x2c3, 7, FALSE);
    SetDlgItemInt(dialog, 0x2c4, 77, FALSE);
    recordEdits("typed-rgb");
}

UINT FAR PASCAL _export Hook(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        wsprintf(probeResult, "param=%d,owner=%d", lParam == (LPARAM)(CHOOSECOLOR FAR *)&cc ? 1 : 0,
                 GetParent(hwnd) == owner ? 1 : 0);
        probe("hook", "init", probeResult);
        dialog = hwnd;
        return TRUE;
    }

    if (message == okMessage && okMessage) {
        wsprintf(probeResult, "param=%d,wparam=%x,rgb=%lx,custom0=%lx", lParam == (LPARAM)(CHOOSECOLOR FAR *)&cc ? 1 : 0,
                 wParam, cc.rgbResult, custom[0]);
        probe("hook", "colorok", probeResult);

        if (okRefusals) {
            okRefusals--;
            return TRUE;
        }

        return FALSE;
    }

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
    case 1:
        switch (step) {
        case 1:
            state("basic");
            pixels("basic");
            press(VK_RIGHT, 0x4d);
            press(VK_RIGHT, 0x4d);
            press(VK_DOWN, 0x50);
            break;
        case 2:
            state("arrows");
            pixels("arrows");
            press(VK_SPACE, 0x39);
            break;
        case 3:
            pixels("space");
            press(VK_TAB, 0x0f);
            press(VK_END, 0x4f);
            press(VK_SPACE, 0x39);
            break;
        case 4:
            state("custom");
            clickBox(0x2d0, 6, 4, 6);
            break;
        case 5:
            state("clicked");
            pixels("clicked");
            okRefusals = 1;
            press(VK_RETURN, 0x1c);
            break;
        case 6:
            press(VK_RETURN, 0x1c);
            break;
        }

        break;
    case 2:
        switch (step) {
        case 1:
            state("full");
            pixels("full");
            recordEdits("full");
            alt('A', 0x1e);
            break;
        case 2:
            SendMessage(dialog, rgbMessage, 0, RGB(255, 128, 0));
            alt('A', 0x1e);
            break;
        case 3:
            SendMessage(dialog, rgbMessage, 0, RGB(0, 0, 128));
            alt('A', 0x1e);
            break;
        case 4:
            pixels("added");
            press(VK_ESCAPE, 0x01);
            break;
        }

        break;
    case 3:
        switch (step) {
        case 1:
            state("define");
            recordEdits("define");
            alt('D', 0x20);
            break;
        case 2:
            state("defined");
            pixels("defined");
            recordEdits("defined");
            conversions();
            break;
        case 3:
            pixels("converted");
            clickIn(0x2c6, 40, 30);
            break;
        case 4:
            recordEdits("rainbow");
            pixels("rainbow");
            clickIn(0x2be, 3, 70);
            break;
        case 5:
            recordEdits("luminosity");
            pixels("luminosity");
            alt('O', 0x18);
            break;
        case 6:
            recordEdits("solid");
            pixels("solid");
            {
                RECT r;

                GetWindowRect(GetDlgItem(dialog, 0x2c6), &r);
                drag(r.left + 10, r.top + 10, r.left + 90, r.top + 60);
            }
            break;
        case 7:
            recordEdits("dragged");
            clickBox(0x2d1, 2, 1, 3);
            break;
        case 8:
            recordEdits("custom-box");
            clickBox(0x2d0, 6, 2, 2);
            break;
        case 9:
            recordEdits("basic-box");
            pixels("basic-box");
            press(VK_RETURN, 0x1c);
            break;
        }

        break;
    case 4:
        switch (step) {
        case 1:
            state("prevent");
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
    int index;

    out += wsprintf(out, "%d,%lx,%lx", answer ? 1 : 0, error(), cc.rgbResult);

    for (index = 0; index < 16; index++) {
        out += wsprintf(out, ",%lx", custom[index]);
    }

    probe("result", what, probeResult);
}

static void reset(DWORD flags, COLORREF rgb)
{
    int index;

    _fmemset(&cc, 0, sizeof(cc));
    cc.lStructSize = sizeof(cc);
    cc.hwndOwner = owner;
    cc.hInstance = (HWND)instance;
    cc.rgbResult = rgb;
    cc.lpCustColors = custom;
    cc.Flags = flags;

    for (index = 0; index < 16; index++) {
        custom[index] = RGB(index * 16, 255 - index * 16, (index & 1) ? 192 : 64);
    }
}

static void choose(LPCSTR what, DWORD flags, COLORREF rgb)
{
    UINT timer;
    BOOL answer;

    reset(flags | CC_ENABLEHOOK, rgb);
    cc.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))MakeProcInstance((FARPROC)Hook,
                                                                                instance);
    run++;
    step = 0;
    dialog = NULL;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)timerThunk);
    answer = chooseColor(&cc);
    KillTimer(NULL, timer);
    result(what, answer);
}

static void failure(LPCSTR what)
{
    BOOL answer = chooseColor(&cc);

    wsprintf(probeResult, "%d,%lx", answer ? 1 : 0, error());
    probe("error", what, probeResult);
}

LRESULT FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE current, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    WNDCLASS wc;

    instance = current;
    probeOpen(OUTPUT);
    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    library = LoadLibrary("COMMDLG.DLL");

    if (library >= (HINSTANCE)32) {
        chooseColor = (COLORPROC)GetProcAddress(library, "ChooseColor");
        extendedError = (ERRORPROC)GetProcAddress(library, "CommDlgExtendedError");
    }

    probe("entry", "", keybdEvent && mouseEvent && chooseColor && extendedError ? "found" : "missing");

    if (!keybdEvent || !mouseEvent || !chooseColor || !extendedError) {
        probeFinish();
        return 0;
    }

    okMessage = RegisterWindowMessage("commdlg_ColorOK");
    rgbMessage = RegisterWindowMessage("commdlg_SetRGBColor");
    timerThunk = MakeProcInstance((FARPROC)Tick, instance);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = OwnerProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "ColorOwner";
    RegisterClass(&wc);
    owner = CreateWindow("ColorOwner", "Owner", WS_OVERLAPPEDWINDOW, 0, 0, 640, 480, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);
    SetCursorPos(639, 479);

    reset(CC_ENABLEHOOK, 0);
    failure("nohook");
    reset(0, 0);
    cc.lStructSize = sizeof(cc) + 1;
    failure("size");
    reset(CC_ENABLETEMPLATEHANDLE, 0);
    cc.hInstance = NULL;
    failure("nohandle");
    reset(CC_ENABLETEMPLATE, 0);
    failure("noname");
    reset(CC_ENABLETEMPLATE, 0);
    cc.hInstance = NULL;
    cc.lpTemplateName = "NOSUCH";
    failure("noinstance");
    reset(CC_ENABLETEMPLATE, 0);
    cc.lpTemplateName = "NOSUCH";
    failure("notemplate");

    choose("basic", CC_RGBINIT | CC_SHOWHELP, RGB(255, 0, 0));
    choose("full", CC_FULLOPEN, 0);
    choose("define", CC_RGBINIT, RGB(128, 64, 200));
    choose("prevent", CC_PREVENTFULLOPEN, 0);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
