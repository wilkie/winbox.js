/*
 * COMMDLG's Font dialog, `ChooseFont`, as programs use it and as a person
 * does: with the keys, through USER's `KEYBD_EVENT`, a timer of the
 * program's taking a step at a time. The dialog is COMMDLG.DLL's own code
 * on every engine.
 *
 * * `error`: each call that fails, what it answers and
 *   `CommDlgExtendedError` after it.
 * * `state`: whether each control is enabled and shown, the focus, and the
 *   text of the three boxes and of the font's description.
 * * `faces`, `styles`, `sizes`, `colors`: each list's items in order, with
 *   the selection: a face's type word, a style's type (the high word of its
 *   data; the low word is COMMDLG's own memory), a size's number, a colour.
 * * `hook`: the messages the hook was given before `WM_INITDIALOG`, then
 *   `WM_INITDIALOG`'s `lParam` and whether the cursor was the hourglass;
 *   `WM_COMMAND` from Apply.
 * * `help`: what the owner was sent for Help.
 * * `box`: a message box COMMDLG put up, its caption and its texts.
 * * `getlogfont`: `WM_CHOOSEFONT_GETLOGFONT`'s answer, the `LOGFONT` and
 *   the flags it leaves.
 * * `result`: what `ChooseFont` answered, the error, `iPointSize`, `Flags`,
 *   `rgbColors`, `nFontType`, the style's name and the `LOGFONT`. Where no
 *   style is chosen, COMMDLG writes `nFontType` from a word of its stack it
 *   never set, so only that it was written is recorded.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\CHFONT.OUT"

typedef BOOL(FAR PASCAL *FONTPROC)(CHOOSEFONT FAR *);
typedef DWORD(FAR PASCAL *ERRORPROC)(void);

static FONTPROC chooseFont;
static ERRORPROC extendedError;
static FARPROC keybdEvent;
static HINSTANCE instance;
static HWND owner;
static HWND dialog;
static UINT helpMessage;
static CHOOSEFONT cf;
static LOGFONT lf;
static char style[64];
static int run;
static int step;
static FARPROC timerThunk;
static char before[512];
static LPSTR beforeEnd;
static int seenInit;
/* Set for a run whose nFontType COMMDLG writes from a word of its stack it
 * never set (no style in the list): only that it was written is recorded. */
static int leftover;

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

/* A digit typed on the main keyboard. */
static void digit(char c)
{
    static const BYTE SCAN[] = {0x0b, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a};

    press((BYTE)c, SCAN[c - '0']);
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
    GetDlgItemText(dialog, cmb1, text, sizeof(text));
    out += wsprintf(out, " face=%s", (LPSTR)text);
    GetDlgItemText(dialog, cmb2, text, sizeof(text));
    out += wsprintf(out, " style=%s", (LPSTR)text);
    GetDlgItemText(dialog, cmb3, text, sizeof(text));
    out += wsprintf(out, " size=%s", (LPSTR)text);
    GetDlgItemText(dialog, stc6, text, sizeof(text));
    out += wsprintf(out, " desc=%s", (LPSTR)text);
    wsprintf(out, " strike=%d under=%d", IsDlgButtonChecked(dialog, chx1),
             IsDlgButtonChecked(dialog, chx2));
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

        switch (how) {
        case 0: /* the whole word */
            out += wsprintf(out, "|%s=%x", (LPSTR)text, LOWORD(data));
            break;
        case 1: /* the high word */
            out += wsprintf(out, "|%s=%x", (LPSTR)text, HIWORD(data));
            break;
        default: /* a colour */
            out += wsprintf(out, "|%s=%lx", (LPSTR)text, data);
            break;
        }
    }

    probe(function, what, probeResult);
}

static void lists(LPCSTR what)
{
    list("faces", what, cmb1, 0);
    list("styles", what, cmb2, 1);
    list("sizes", what, cmb3, 0);
    list("colors", what, cmb4, 2);
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

static void getLogFont(LPCSTR what)
{
    LOGFONT got;
    LPSTR out = probeResult;
    LRESULT answer;

    _fmemset(&got, 0x55, sizeof(got));
    answer = SendMessage(dialog, WM_CHOOSEFONT_GETLOGFONT, 0, (LPARAM)(LOGFONT FAR *)&got);
    out += wsprintf(out, "%ld,%lx,", answer, cf.Flags);
    logfont(out, &got);
    probe("getlogfont", what, probeResult);
}

UINT FAR PASCAL _export Hook(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        HCURSOR wait = LoadCursor(NULL, IDC_WAIT);

        probe("hook", "before", before);
        wsprintf(probeResult, "param=%d,owner=%d,wait=%d",
                 lParam == (LPARAM)(CHOOSEFONT FAR *)&cf ? 1 : 0, GetParent(hwnd) == owner ? 1 : 0,
                 GetCursor() == wait ? 1 : 0);
        probe("hook", "init", probeResult);
        dialog = hwnd;
        seenInit = 1;
        return TRUE;
    }

    if (!seenInit) {
        if (beforeEnd < before + sizeof(before) - 8) {
            beforeEnd += wsprintf(beforeEnd, "%s%x", (LPSTR)(beforeEnd == before ? "" : ","),
                                  message);
        }

        return FALSE;
    }

    if (message == WM_COMMAND && wParam == psh3) {
        wsprintf(probeResult, "code=%x", HIWORD(lParam));
        probe("hook", "apply", probeResult);
    }

    return FALSE;
}

/* One step of the run in hand, a tick of the timer. */
static void next(void)
{
    step++;

    if (!dialog && run != 0) {
        dialog = GetActiveWindow();
    }

    switch (run) {
    case 0: /* a message box of a call that fails */
        if (step == 1) {
            box("nofonts");
            press(VK_RETURN, 0x1c);
        }

        break;
    case 1:
        switch (step) {
        case 1:
            state("screen");
            lists("screen");
            alt('H', 0x23);
            break;
        case 2:
            alt('A', 0x1e);
            break;
        case 3:
            alt('Y', 0x15);
            press(VK_DOWN, 0x50);
            break;
        case 4:
            state("style-down");
            alt('S', 0x1f);
            digit('1');
            digit('4');
            break;
        case 5:
            state("size-typed");
            alt('K', 0x25);
            alt('C', 0x2e);
            press(VK_DOWN, 0x50);
            break;
        case 6:
            state("effects");
            alt('F', 0x21);
            press(VK_DOWN, 0x50);
            break;
        case 7:
            state("face-down");
            lists("face-down");
            press(VK_RETURN, 0x1c);
            break;
        }

        break;
    case 2:
        switch (step) {
        case 1:
            state("limit");
            lists("limit");
            alt('S', 0x1f);
            digit('2');
            digit('0');
            press(VK_RETURN, 0x1c);
            break;
        case 2:
            box("limit");
            press(VK_RETURN, 0x1c);
            break;
        case 3:
            state("limit-refused");
            alt('S', 0x1f);
            press(VK_DELETE, 0x53);
            press(VK_BACK, 0x0e);
            press(VK_BACK, 0x0e);
            press(VK_BACK, 0x0e);
            digit('0');
            press(VK_RETURN, 0x1c);
            break;
        case 4:
            box("limit-zero");
            press(VK_RETURN, 0x1c);
            break;
        case 5:
            state("limit-zero");
            press(VK_ESCAPE, 0x01);
            break;
        }

        break;
    case 3:
        switch (step) {
        case 1:
            state("nosel");
            lists("nosel");
            getLogFont("nosel");
            alt('F', 0x21);
            press(VK_DOWN, 0x50);
            break;
        case 2:
            state("nosel-face");
            lists("nosel-face");
            getLogFont("nosel-face");
            press(VK_RETURN, 0x1c);
            break;
        }

        break;
    case 4:
        switch (step) {
        case 1:
            state("scalable");
            lists("scalable");
            press(VK_ESCAPE, 0x01);
            break;
        }

        break;
    case 5:
        switch (step) {
        case 1:
            state("force");
            lists("force");
            press(VK_RETURN, 0x1c);
            break;
        case 2:
            box("force");
            press(VK_RETURN, 0x1c);
            break;
        case 3:
            state("force-refused");
            press(VK_ESCAPE, 0x01);
            break;
        }

        break;
    case 6:
        switch (step) {
        case 1:
            state("both");
            lists("both");
            alt('Y', 0x15);
            press(VK_DOWN, 0x50);
            break;
        case 2:
            state("both-style");
            alt('F', 0x21);
            press(VK_HOME, 0x47);
            break;
        case 3:
            state("both-first");
            lists("both-first");
            press(VK_RETURN, 0x1c);
            break;
        }

        break;
    case 7:
        switch (step) {
        case 1:
            state("plain");
            lists("plain");
            getLogFont("plain");
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

    out += wsprintf(out, "%d,%lx,%d,%lx,%lx,", answer ? 1 : 0, error(), cf.iPointSize, cf.Flags,
                    cf.rgbColors);

    if (leftover) {
        out += wsprintf(out, "%s,", (LPSTR)(cf.nFontType != 0x5555 ? "written" : "5555"));
    } else {
        out += wsprintf(out, "%x,", cf.nFontType);
    }

    out += wsprintf(out, "%s,", (LPSTR)style);
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
    cf.Flags = flags;
    cf.nFontType = 0x5555;
}

static void choose(LPCSTR what)
{
    UINT timer;
    BOOL answer;

    cf.Flags |= CF_ENABLEHOOK;
    cf.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))MakeProcInstance((FARPROC)Hook,
                                                                                instance);
    run++;
    step = 0;
    dialog = NULL;
    seenInit = 0;
    before[0] = '\0';
    beforeEnd = before;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)timerThunk);
    answer = chooseFont(&cf);
    KillTimer(NULL, timer);
    result(what, answer);
}

static void failure(LPCSTR what)
{
    BOOL answer = chooseFont(&cf);

    wsprintf(probeResult, "%d,%lx", answer ? 1 : 0, error());
    probe("error", what, probeResult);
}

LRESULT FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == helpMessage && helpMessage) {
        wsprintf(probeResult, "dialog=%d,param=%d", (HWND)wParam == dialog ? 1 : 0,
                 lParam == (LPARAM)(CHOOSEFONT FAR *)&cf ? 1 : 0);
        probe("help", "", probeResult);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE current, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    WNDCLASS wc;
    HDC ic;
    UINT timer;

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

    helpMessage = RegisterWindowMessage("commdlg_help");
    timerThunk = MakeProcInstance((FARPROC)Tick, instance);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = OwnerProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "FontOwner";
    RegisterClass(&wc);
    owner = CreateWindow("FontOwner", "Owner", WS_OVERLAPPEDWINDOW, 0, 0, 640, 480, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);
    SetCursorPos(639, 479);

    reset(CF_SCREENFONTS);
    cf.lStructSize = sizeof(cf) + 1;
    failure("size");
    reset(CF_SCREENFONTS | CF_ENABLEHOOK);
    failure("nohook");
    reset(CF_SCREENFONTS | CF_ENABLETEMPLATE);
    cf.lpTemplateName = "NOSUCH";
    failure("notemplate");
    reset(CF_SCREENFONTS | CF_ENABLETEMPLATEHANDLE);
    cf.hInstance = NULL;
    failure("nohandle");
    reset(CF_SCREENFONTS | CF_LIMITSIZE);
    cf.nSizeMin = 12;
    cf.nSizeMax = 8;
    failure("maxlessthanmin");

    /* Neither screen nor printer fonts: a box that says there are none. */
    reset(0);
    run = 0;
    step = 0;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)timerThunk);
    failure("nofonts");
    KillTimer(NULL, timer);
    run = 0;

    reset(CF_SCREENFONTS | CF_EFFECTS | CF_SHOWHELP | CF_APPLY | CF_INITTOLOGFONTSTRUCT);
    lf.lfHeight = -16;
    lf.lfWeight = FW_BOLD;
    lf.lfUnderline = 1;
    lstrcpy(lf.lfFaceName, "Arial");
    cf.rgbColors = RGB(128, 0, 0);
    choose("screen");

    reset(CF_SCREENFONTS | CF_USESTYLE | CF_LIMITSIZE | CF_ANSIONLY);
    lstrcpy(style, "Bold Italic");
    cf.nSizeMin = 8;
    cf.nSizeMax = 12;
    _fmemset(&lf, 0x55, sizeof(lf));
    lf.lfFaceName[0] = '\0';
    choose("limit");

    reset(CF_SCREENFONTS | CF_TTONLY | CF_NOSTYLESEL | CF_NOSIZESEL | CF_NOFACESEL |
          CF_INITTOLOGFONTSTRUCT);
    lf.lfHeight = -13;
    lf.lfWeight = FW_NORMAL;
    lstrcpy(lf.lfFaceName, "Courier New");
    leftover = 1;
    choose("nosel");
    leftover = 0;

    reset(CF_SCREENFONTS | CF_SCALABLEONLY | CF_FIXEDPITCHONLY | CF_NOVECTORFONTS |
          CF_NOSIMULATIONS);
    choose("scalable");

    reset(CF_SCREENFONTS | CF_FORCEFONTEXIST | CF_INITTOLOGFONTSTRUCT);
    lf.lfHeight = -16;
    lf.lfWeight = FW_NORMAL;
    lstrcpy(lf.lfFaceName, "NoSuchFace");
    choose("force");

    /* Printer fonts from an information context on the display: every face
     * is both the screen's and the "printer's". */
    ic = CreateIC("DISPLAY", NULL, NULL, NULL);
    reset(CF_BOTH | CF_WYSIWYG | CF_SCALABLEONLY);
    cf.hDC = ic;
    choose("both");
    DeleteDC(ic);

    reset(CF_SCREENFONTS);
    choose("plain");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
