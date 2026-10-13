/*
 * What the dialog manager asks its controls with `WM_GETDLGCODE` and what it
 * does with the answers: the default push button chosen as a dialog is made,
 * the message filters `IsDialogMessage` calls, and a check box's or a radio
 * button's mnemonic.
 *
 * Read out of `USER.EXE`: as each control is made, it is sent `WM_SETFONT`
 * with the dialog's font, then `WM_GETDLGCODE`, and one that answers
 * `DLGC_DEFPUSHBUTTON` has its identifier written over the dialog's default
 * (seg24 `0892`-`08c2`). `IsDialogMessage` first calls `CallMsgFilter` with
 * the message and `MSGF_DIALOGBOX`, and takes a message a filter took (seg25
 * `0c32`-`0c44`). A mnemonic that names a button that is no push button gives
 * it the focus, and sends it 463h with 1 where no other control has the
 * mnemonic (seg19 `0233`-`025a`); a button answers 463h by sending itself
 * `WM_LBUTTONDOWN` and `WM_LBUTTONUP` (seg25 `1f3f`). An arrow onto an
 * automatic radio button unchecked sends it the same (seg25 `0dfc`-`0e22`).
 *
 * A control class of the probe's, `ProbeCtl`, answers `WM_GETDLGCODE` by
 * its identifier: 11 with `DLGC_BUTTON | DLGC_DEFPUSHBUTTON`, 12 with
 * `DLGC_BUTTON | DLGC_UNDEFPUSHBUTTON`, 13 with `DLGC_DEFPUSHBUTTON` alone,
 * and nought for any other. Each dialog is a template in memory, made with
 * `CreateDialogIndirect` unless it says otherwise, `WM_INITDIALOG`
 * answering TRUE:
 *
 * * `t1`, in MS Sans Serif 8: an edit control (30), X (11), a push button
 *   with `BS_DEFPUSHBUTTON` (22), Y (12).
 * * `t2`: a push button with `BS_DEFPUSHBUTTON` (21), X (11), an edit
 *   control (30).
 * * `t3`: a push button (21), Z (13), an edit control (30).
 * * `t4`: a push button (21) and an edit control (30), no default.
 *
 * Records, by case and number:
 *
 * * `msg`: each `WM_CREATE`, `WM_SETFONT`, `WM_GETDLGCODE` (`wParam`, and
 *   whether `lParam` is a message), `BM_SETSTYLE`, `WM_SETFOCUS` and
 *   `WM_KILLFOCUS` a `ProbeCtl` control got, and in the dialog `M` below
 *   each of those, 463h, `WM_LBUTTONDOWN`, `WM_LBUTTONUP`, `BM_SETCHECK`,
 *   `BM_SETSTATE` and `WM_USER + 5` its controls got, and `WM_COMMAND` the
 *   dialog got: the control by its identifier, the message, `wParam`, and
 *   what of `lParam` there is.
 * * `state`: `DM_GETDEFID` in hexadecimal as `WM_INITDIALOG` comes
 *   (`init`) and once the dialog is made (`made`), the focus's identifier,
 *   and each button's style, `BS_DEFPUSHBUTTON` or not.
 * * `hook`: the message filter (`WH_MSGFILTER`) called with a message of
 *   `WM_USER + 5`, `WM_CHAR`, `WM_SYSCHAR` or `WM_KEYDOWN`: its code, the
 *   message and the window, by identifier or `P`.
 * * `taken`: what `IsDialogMessage` or `CallMsgFilter` answered.
 *
 * The filter cases use M, a modeless dialog: `inside` posts `WM_USER + 5`
 * to M's edit control and hands it to `IsDialogMessage(M)`; `outside` the
 * same posted to the probe's window P; `swallow` with the filter answering
 * TRUE; `call` passes it to `CallMsgFilter` with 55h; `modal` runs a dialog
 * with `DialogBoxIndirect` that posts itself `WM_USER + 5` and ends as it
 * takes it.
 *
 * The mnemonic cases post `WM_SYSCHAR` with Alt's bit to the control with
 * the focus, taken through `IsDialogMessage(M)`, M's edit control (101)
 * given the focus first: M has an automatic check box `&Check` (102), an
 * automatic radio button `&Radio` (103) and another `R&2` (104) in a group,
 * a check box `&Plain` (105), a radio button `&Bare` (106), two automatic
 * check boxes `&Dup` (107, 108), static text `&Static` (109) and an edit
 * control after it (110), and a push button `&Go` (111). `state` gives the
 * focus and the check of 102 to 108 after each. `arrow` gives 103 the focus
 * and posts it Down.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\DLGCODE.OUT"

#define WM_PROBE (WM_USER + 5)

static HINSTANCE instance;
static HWND windowP;
static HWND dialogM;
static LPCSTR label = "";
static int number;
static BOOL quiet;
static BOOL swallow;
static BOOL modal;
static HOOKPROC filterProc;
static HOOKPROC nextFilter;
static WNDPROC buttonProc;
static WNDPROC editProc;
static FARPROC buttonSpy;
static FARPROC editSpy;

/* Records kept until the case is over: a window procedure deep in a
 * dialog's making has too little stack left for `probe`'s line. */
static char far queued[12000];
static unsigned queuedAt;

static void queue(LPCSTR function, LPCSTR result)
{
    char line[120];
    int length;

    length = wsprintf(line, "%s\t%s,%d\t%s", function, label, number++, result);

    if (queuedAt + length + 1 < sizeof(queued)) {
        _fmemcpy(queued + queuedAt, line, length + 1);
        queuedAt += length + 1;
    }
}

static void flush(void)
{
    static char function[16];
    static char args[64];
    static char result[160];
    unsigned at = 0;

    while (at < queuedAt) {
        LPSTR line = queued + at;
        LPSTR tab1 = line;
        LPSTR tab2;

        while (*tab1 != '\t') {
            tab1++;
        }

        tab2 = tab1 + 1;

        while (*tab2 != '\t') {
            tab2++;
        }

        lstrcpyn(function, line, (int)(tab1 - line) + 1);
        lstrcpyn(args, tab1 + 1, (int)(tab2 - tab1));
        lstrcpy(result, tab2 + 1);
        probe(function, args, result);
        at += lstrlen(line) + 1;
    }

    queuedAt = 0;
}

static void begin(LPCSTR name)
{
    label = name;
    number = 0;
}

static void who(LPSTR out, HWND hwnd)
{
    if (hwnd == NULL) {
        lstrcpy(out, "0");
    } else if (hwnd == windowP) {
        lstrcpy(out, "P");
    } else if (IsWindow(hwnd) && GetParent(hwnd) != NULL) {
        wsprintf(out, "%d", GetDlgCtrlID(hwnd));
    } else {
        lstrcpy(out, "D");
    }
}

static void logMessage(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char id[8];
    char line[64];

    if (quiet) {
        return;
    }

    switch (message) {
    case WM_SETFONT:
        /* The font's handle differs from run to run: only whether there is one. */
        wsprintf(line, "%04x,%d", message, wParam != 0);
        break;
    case WM_CREATE:
    case 0x463:
    case BM_SETCHECK:
    case BM_SETSTATE:
    case WM_PROBE:
        wsprintf(line, "%04x,%04x", message, wParam);
        break;
    case WM_GETDLGCODE:
        wsprintf(line, "%04x,%04x,%d", message, wParam, lParam != 0);
        break;
    case BM_SETSTYLE:
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
        wsprintf(line, "%04x,%04x,%lx", message, wParam, lParam);
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
        who(id, (HWND)wParam);
        wsprintf(line, "%04x,%s", message, (LPSTR)id);
        break;
    default:
        return;
    }

    who(id, hwnd);
    wsprintf(probeResult, "%s,%s", (LPSTR)id, (LPSTR)line);
    queue("msg", probeResult);
}

LONG FAR PASCAL _export CtlProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    if (message == WM_GETDLGCODE) {
        switch (GetWindowWord(hwnd, GWW_ID)) {
        case 11:
            return DLGC_BUTTON | DLGC_DEFPUSHBUTTON;
        case 12:
            return DLGC_BUTTON | DLGC_UNDEFPUSHBUTTON;
        case 13:
            return DLGC_DEFPUSHBUTTON;
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export ButtonSpy(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    return CallWindowProc((FARPROC)buttonProc, hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export EditSpy(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    return CallWindowProc((FARPROC)editProc, hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* Apart, so that the far pointer is loaded only where it is one. */
static void logFilter(int code, MSG FAR *msg)
{
    char id[8];

    if (quiet) {
        return;
    }

    if (msg->message == WM_PROBE || msg->message == WM_CHAR || msg->message == WM_SYSCHAR ||
        msg->message == WM_KEYDOWN) {
        who(id, msg->hwnd);
        wsprintf(probeResult, "%d,%04x,%s", code, msg->message, (LPSTR)id);
        queue("hook", probeResult);
    }
}

DWORD FAR PASCAL _export FilterProc(int code, WPARAM wParam, LPARAM lParam)
{
    if (code >= 0) {
        logFilter(code, (MSG FAR *)lParam);

        if (swallow) {
            return 1;
        }
    }

    return DefHookProc(code, wParam, lParam, &nextFilter);
}

/* `DM_GETDEFID`, the focus, and each button's default style. */
static void state(HWND dialog, LPCSTR when)
{
    char line[160];
    HWND child;
    BOOL was = quiet;

    quiet = TRUE;
    wsprintf(line, "%s:def=%lx,focus=", when, SendMessage(dialog, DM_GETDEFID, 0, 0L));
    who(line + lstrlen(line), GetFocus());

    for (child = GetWindow(dialog, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        char name[16];

        GetClassName(child, name, sizeof(name));

        if (lstrcmpi(name, "Button") == 0) {
            wsprintf(line + lstrlen(line), ",%d=%s", GetDlgCtrlID(child),
                     (LPSTR)((GetWindowLong(child, GWL_STYLE) & 0x0f) == BS_DEFPUSHBUTTON ? "def"
                                                                                       : "-"));
        }
    }

    quiet = was;
    queue("state", line);
}

/* The focus and the check of M's buttons 102 to 108. */
static void checks(LPCSTR when)
{
    char line[120];
    int id;

    quiet = TRUE;
    wsprintf(line, "%s:focus=", when);
    who(line + lstrlen(line), GetFocus());

    for (id = 102; id <= 108; id++) {
        wsprintf(line + lstrlen(line), ",%d", (int)SendDlgItemMessage(dialogM, id, BM_GETCHECK, 0,
                                                                      0L));
    }

    quiet = FALSE;
    queue("state", line);
}

BOOL FAR PASCAL _export DialogProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        state(hwnd, "init");

        if (modal) {
            PostMessage(hwnd, WM_PROBE, 0, 0L);
        }

        return TRUE;
    }

    if (message == WM_COMMAND && !quiet) {
        wsprintf(probeResult, "D,%04x,%04x,%d", message, wParam, HIWORD(lParam));
        queue("msg", probeResult);
    }

    if (message == WM_PROBE && modal) {
        EndDialog(hwnd, 1);
        return TRUE;
    }

    return FALSE;
}

/* A template in a global block. */
static HGLOBAL memory;
static BYTE FAR *template;
static int at;

static void byte(BYTE value)
{
    template[at++] = value;
}

static void word(WORD value)
{
    byte(LOBYTE(value));
    byte(HIBYTE(value));
}

static void string(LPCSTR text)
{
    while (*text) {
        byte(*text++);
    }

    byte(0);
}

static void header(DWORD style, int count, int width, int height)
{
    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte((BYTE)count);
    word(20);
    word(20);
    word(width);
    word(height);
    byte(0);
    byte(0);
    string("Probe");

    if (style & DS_SETFONT) {
        word(8);
        string("MS Sans Serif");
    }
}

static void item(int x, int y, int cx, int id, DWORD style, BYTE type, LPCSTR text)
{
    word(x);
    word(y);
    word(cx);
    word(12);
    word(id);
    word(LOWORD(style));
    word(HIWORD(style));
    byte(type);
    string(text);
    byte(0);
}

/* An item of the probe's own class, named in the template. */
static void custom(int x, int y, int id, DWORD style)
{
    word(x);
    word(y);
    word(40);
    word(12);
    word(id);
    word(LOWORD(style));
    word(HIWORD(style));
    string("ProbeCtl");
    string("");
    byte(0);
}

#define CHILD (WS_CHILD | WS_VISIBLE)
#define DIALOG (WS_POPUP | WS_CAPTION | WS_VISIBLE | DS_MODALFRAME)

/* One template made, shown and destroyed. */
static void made(LPCSTR name)
{
    HWND dialog;

    begin(name);
    dialog = CreateDialogIndirect(instance, template, windowP, (DLGPROC)DialogProc);
    state(dialog, "made");
    quiet = TRUE;
    DestroyWindow(dialog);
    quiet = FALSE;
    flush();
}

static void pump(void)
{
    MSG msg;
    char taken[8];

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        if (msg.message == WM_PROBE || msg.message == WM_SYSCHAR || msg.message == WM_KEYDOWN) {
            BOOL answer = IsDialogMessage(dialogM, &msg);

            wsprintf(taken, "%d", answer);
            queue("taken", taken);

            if (answer) {
                continue;
            }
        }

        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

static void focus(int id)
{
    quiet = TRUE;
    SetFocus(GetDlgItem(dialogM, id));
    quiet = FALSE;
}

static void mnemonic(LPCSTR name, int from, char letter)
{
    begin(name);
    focus(from);
    PostMessage(GetFocus(), WM_SYSCHAR, letter, 0x20000001L);
    pump();
    checks("after");
    flush();
}

static void spy(int id, FARPROC with, WNDPROC *original)
{
    *original = (WNDPROC)SetWindowLong(GetDlgItem(dialogM, id), GWL_WNDPROC, (LONG)with);
}

int PASCAL WinMain(HINSTANCE hinst, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    MSG msg;
    int id;
    char taken[8];

    instance = hinst;
    probeOpen(OUTPUT);
    buttonSpy = MakeProcInstance((FARPROC)ButtonSpy, instance);
    editSpy = MakeProcInstance((FARPROC)EditSpy, instance);
    filterProc = (HOOKPROC)MakeProcInstance((FARPROC)FilterProc, instance);

    wc.style = 0;
    wc.lpfnWndProc = WindowProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = NULL;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "ProbeDlgCode";
    RegisterClass(&wc);

    wc.lpfnWndProc = CtlProc;
    wc.lpszClassName = "ProbeCtl";
    RegisterClass(&wc);

    windowP = CreateWindow("ProbeDlgCode", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 400,
                           300, NULL, NULL, instance, NULL);
    UpdateWindow(windowP);

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 1024);
    template = (BYTE FAR *)GlobalLock(memory);

    /* The default push button chosen as the dialog is made. */
    header(DIALOG | DS_SETFONT, 4, 160, 80);
    item(6, 6, 60, 30, ES_LEFT | WS_BORDER | WS_TABSTOP | CHILD, 0x81, "");
    custom(6, 24, 11, WS_TABSTOP | CHILD);
    item(56, 24, 40, 22, BS_DEFPUSHBUTTON | WS_TABSTOP | CHILD, 0x80, "B2");
    custom(106, 24, 12, WS_TABSTOP | CHILD);
    made("t1");

    header(DIALOG, 3, 160, 80);
    item(6, 6, 40, 21, BS_DEFPUSHBUTTON | CHILD, 0x80, "B1");
    custom(56, 6, 11, CHILD);
    item(6, 24, 60, 30, ES_LEFT | WS_BORDER | WS_TABSTOP | CHILD, 0x81, "");
    made("t2");

    header(DIALOG, 3, 160, 80);
    item(6, 6, 40, 21, BS_PUSHBUTTON | WS_TABSTOP | CHILD, 0x80, "B1");
    custom(56, 6, 13, CHILD);
    item(6, 24, 60, 30, ES_LEFT | WS_BORDER | WS_TABSTOP | CHILD, 0x81, "");
    made("t3");

    header(DIALOG, 2, 160, 80);
    item(6, 6, 40, 21, BS_PUSHBUTTON | WS_TABSTOP | CHILD, 0x80, "B1");
    item(6, 24, 60, 30, ES_LEFT | WS_BORDER | WS_TABSTOP | CHILD, 0x81, "");
    made("t4");

    /* M, for the filters and the mnemonics. */
    header(DIALOG, 11, 200, 160);
    item(6, 6, 60, 101, ES_LEFT | WS_BORDER | WS_TABSTOP | CHILD, 0x81, "");
    item(6, 20, 60, 102, BS_AUTOCHECKBOX | WS_TABSTOP | CHILD, 0x80, "&Check");
    item(6, 34, 60, 103, BS_AUTORADIOBUTTON | WS_GROUP | WS_TABSTOP | CHILD, 0x80, "&Radio");
    item(6, 48, 60, 104, BS_AUTORADIOBUTTON | CHILD, 0x80, "R&2");
    item(6, 62, 60, 105, BS_CHECKBOX | WS_GROUP | WS_TABSTOP | CHILD, 0x80, "&Plain");
    item(6, 76, 60, 106, BS_RADIOBUTTON | WS_GROUP | WS_TABSTOP | CHILD, 0x80, "&Bare");
    item(6, 90, 60, 107, BS_AUTOCHECKBOX | WS_GROUP | WS_TABSTOP | CHILD, 0x80, "&Dup");
    item(6, 104, 60, 108, BS_AUTOCHECKBOX | WS_TABSTOP | CHILD, 0x80, "&Dup");
    item(80, 6, 60, 109, SS_LEFT | WS_GROUP | CHILD, 0x82, "&Static");
    item(80, 20, 60, 110, ES_LEFT | WS_BORDER | WS_TABSTOP | CHILD, 0x81, "");
    item(80, 40, 60, 111, BS_PUSHBUTTON | WS_TABSTOP | CHILD, 0x80, "&Go");

    begin("m");
    quiet = TRUE;
    dialogM = CreateDialogIndirect(instance, template, windowP, (DLGPROC)DialogProc);
    quiet = FALSE;
    flush();

    for (id = 102; id <= 111; id++) {
        if (id != 109 && id != 110) {
            spy(id, buttonSpy, &buttonProc);
        }
    }

    spy(101, editSpy, &editProc);
    spy(110, editSpy, &editProc);

    nextFilter = SetWindowsHook(WH_MSGFILTER, filterProc);

    /* The filters. */
    begin("inside");
    focus(101);
    PostMessage(GetDlgItem(dialogM, 101), WM_PROBE, 1, 0L);
    pump();
    flush();

    begin("outside");
    PostMessage(windowP, WM_PROBE, 2, 0L);
    pump();
    flush();

    begin("swallow");
    swallow = TRUE;
    PostMessage(GetDlgItem(dialogM, 101), WM_PROBE, 3, 0L);
    pump();
    swallow = FALSE;
    flush();

    begin("call");
    msg.hwnd = GetDlgItem(dialogM, 101);
    msg.message = WM_PROBE;
    msg.wParam = 4;
    msg.lParam = 0;
    msg.time = 0;
    msg.pt.x = 0;
    msg.pt.y = 0;
    wsprintf(taken, "%d", CallMsgFilter(&msg, 0x55));
    queue("taken", taken);
    swallow = TRUE;
    wsprintf(taken, "%d", CallMsgFilter(&msg, 0x55));
    queue("taken", taken);
    swallow = FALSE;
    flush();

    begin("modal");
    modal = TRUE;
    header(DIALOG & ~WS_VISIBLE, 1, 160, 80);
    item(6, 6, 40, 21, BS_PUSHBUTTON | WS_TABSTOP | CHILD, 0x80, "B1");
    GlobalUnlock(memory);
    wsprintf(taken, "%d", DialogBoxIndirect(instance, memory, windowP, (DLGPROC)DialogProc));
    template = (BYTE FAR *)GlobalLock(memory);
    queue("taken", taken);
    modal = FALSE;
    flush();

    /* The mnemonics. */
    mnemonic("check", 101, 'c');
    mnemonic("check2", 102, 'c');
    mnemonic("radio", 101, 'r');
    mnemonic("plain", 101, 'p');
    mnemonic("bare", 101, 'b');
    mnemonic("dup", 101, 'd');
    mnemonic("dup2", 107, 'd');
    mnemonic("static", 101, 's');
    mnemonic("go", 101, 'g');

    begin("arrow");
    focus(103);
    PostMessage(GetFocus(), WM_KEYDOWN, VK_DOWN, 0x00500001L);
    pump();
    checks("after");
    flush();

    UnhookWindowsHook(WH_MSGFILTER, filterProc);
    quiet = TRUE;
    DestroyWindow(dialogM);
    DestroyWindow(windowP);
    GlobalUnlock(memory);
    GlobalFree(memory);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
