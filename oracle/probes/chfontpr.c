/*
 * COMMDLG's Font dialog, `ChooseFont`, with a printer's fonts: the
 * installation's PostScript printer, an Apple LaserWriter Plus on LPT1, its
 * information context given as the structure's `hDC`. The faces the
 * printer has beside the screen's, their types, the styles and sizes of a
 * device face, the font's description for each kind of face, and
 * `CF_WYSIWYG`. The keys are pressed as a person presses them, through
 * USER's `KEYBD_EVENT`, a timer of the program's taking a step at a time,
 * as `chfont` does. Recorded on the installation with the printer
 * (`vgaprint`); the probe writes the printer into `WIN.INI` itself, as
 * `prdlg` does.
 *
 * * `ic`: whether the information context was made.
 * * `state`, `faces`, `styles`, `sizes`, `result`: as `chfont` writes them,
 *   `state` with the font's description.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\CHFONTPR.OUT"
#define PRINTER "Apple LaserWriter Plus"

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
    out += wsprintf(out, " size=%s", (LPSTR)text);
    GetDlgItemText(dialog, stc6, text, sizeof(text));
    wsprintf(out, " desc=%s", (LPSTR)text);
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

UINT FAR PASCAL _export Hook(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        dialog = hwnd;
        seenInit = 1;
        return TRUE;
    }

    (void)wParam;
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
    case 1: /* the printer's faces alone */
        switch (step) {
        case 1:
            state("printer");
            lists("printer");
            alt('F', 0x21);
            type("courier");
            break;
        case 2:
            state("printer-courier");
            lists("printer-courier");
            press(VK_ESCAPE, 0x01);
            break;
        }

        break;
    case 2: /* the screen's and the printer's, each kind described */
        switch (step) {
        case 1:
            state("both");
            lists("both");
            alt('F', 0x21);
            type("arial");
            break;
        case 2:
            state("both-truetype");
            alt('F', 0x21);
            type("courier");
            break;
        case 3:
            state("both-device");
            lists("both-device");
            alt('F', 0x21);
            type("ms serif");
            break;
        case 4:
            state("both-screen");
            lists("both-screen");
            alt('Y', 0x15);
            type("bold");
            break;
        case 5:
            state("both-simulated");
            press(VK_RETURN, 0x1c);
            break;
        }

        break;
    case 3: /* only faces both have */
        if (step == 1) {
            state("wysiwyg");
            lists("wysiwyg");
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

static void reset(DWORD flags, HDC ic)
{
    _fmemset(&cf, 0, sizeof(cf));
    _fmemset(&lf, 0, sizeof(lf));
    _fmemset(style, 0, sizeof(style));
    cf.lStructSize = sizeof(cf);
    cf.hwndOwner = owner;
    cf.hInstance = instance;
    cf.hDC = ic;
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
    HDC ic;

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

    WriteProfileString("windows", "device", PRINTER ",pscript,LPT1:");
    WriteProfileString("devices", PRINTER, "pscript,LPT1:");
    ic = CreateIC("pscript", PRINTER, "LPT1:", NULL);
    probe("ic", "", ic ? "1" : "0");

    if (ic) {
        reset(CF_PRINTERFONTS, ic);
        choose("printer");

        reset(CF_BOTH | CF_EFFECTS, ic);
        choose("both");

        reset(CF_BOTH | CF_WYSIWYG | CF_SCALABLEONLY, ic);
        choose("wysiwyg");

        DeleteDC(ic);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
