/*
 * COMMDLG's Find and Replace dialogs, `FindText` and `ReplaceText`, as a
 * program uses them: modeless, its own window their owner, its message loop
 * passing their messages through `IsDialogMessage`, and what they tell it
 * coming as `FINDMSGSTRING`'s registered message.
 *
 * * `error`: each call that fails, with what it answers and
 *   `CommDlgExtendedError` after it: a size of nought, a null structure, an
 *   owner that is no window, no text or no room for it, a hook asked for and
 *   not given, a template asked for by a name the program has not got, and
 *   by a handle of nought; `ReplaceText` with no replacement or no room for
 *   it. And what a successful call leaves of a hook not asked for.
 * * `init`: the messages the hook was given up to its `WM_INITDIALOG`, and
 *   whether that one's `lParam` was the structure.
 * * `state`: each control's text, check, enabled and shown, the control
 *   with the focus and the default button.
 * * `pixels`: the dialog, a row of the screen at a time, each pixel the
 *   letter of its colour of the sixteen (a for black to p for white), runs
 *   as the letter and its count.
 * * `found`: what the owner was sent: the flags, in hexadecimal, and the
 *   text to find and to replace with; `help` for `HELPMSGSTRING`.
 * * `hook`: the `WM_COMMAND`s the hook was given since the last record.
 *
 * Keys go in through USER's `KEYBD_EVENT`, as the keyboard driver gives
 * them, so the dialog manager's mnemonics, Enter and Escape are what is
 * measured; a timer of the owner's takes a step at a time.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\FINDREPL.OUT"

typedef HWND(FAR PASCAL *FINDPROC)(FINDREPLACE FAR *);
typedef DWORD(FAR PASCAL *ERRORPROC)(void);

#define STEP_TIMER 1

static FINDPROC findText;
static FINDPROC replaceText;
static ERRORPROC extendedError;
static FARPROC keybdEvent;
static HINSTANCE instance;
static HWND owner;
static HWND dialog;
static UINT findMessage;
static UINT helpMessage;
static FINDREPLACE fr;
static char findWhat[64];
static char replaceWith[64];
static int step;
static BOOL eatOk;
static LRESULT answer;
static char hookLog[512];
static LPSTR hookAt;
static char initLog[512];
static LPSTR initAt;
static BOOL initing;
static BOOL initParam;
static BYTE FAR *template;
static HGLOBAL templateHandle;
static int at;

static const char LETTERS[] = "abcdefghijklmnop";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
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

/* One key, pressed or released, as the keyboard driver hands it to USER. */
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

/* A letter with Alt held: a mnemonic. */
static void alt(BYTE vk, BYTE scan)
{
    key(VK_MENU, 0x38, FALSE);
    press(vk, scan);
    key(VK_MENU, 0x38, TRUE);
}

static void hookNote(LPCSTR text)
{
    if (hookAt - hookLog < (int)sizeof(hookLog) - 20) {
        hookAt += wsprintf(hookAt, "%s%s", (LPSTR)(hookAt == hookLog ? "" : " "), text);
    }
}

static void hookFlush(void)
{
    probe("hook", "", hookLog);
    hookAt = hookLog;
    *hookAt = '\0';
}

UINT FAR PASCAL _export Hook(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[24];

    if (initing) {
        if (message == WM_INITDIALOG) {
            initing = FALSE;
            initParam = lParam == (LPARAM)(FINDREPLACE FAR *)&fr;
        }

        if (initAt - initLog < (int)sizeof(initLog) - 8) {
            initAt += wsprintf(initAt, "%s%x", (LPSTR)(initAt == initLog ? "" : " "), message);
        }
    }

    if (message == WM_COMMAND) {
        wsprintf(text, "%x:%x", wParam, HIWORD(lParam));
        hookNote(text);

        if (eatOk && wParam == IDOK) {
            return TRUE;
        }
    }

    (void)hwnd;
    return message == WM_INITDIALOG ? TRUE : FALSE;
}

static DWORD error(void)
{
    return extendedError ? extendedError() : 0xffffffffL;
}

static void reset(DWORD flags)
{
    _fmemset(&fr, 0, sizeof(fr));
    fr.lStructSize = sizeof(fr);
    fr.hwndOwner = owner;
    fr.hInstance = instance;
    fr.Flags = flags;
    fr.lpstrFindWhat = findWhat;
    fr.wFindWhatLen = sizeof(findWhat);
    fr.lpstrReplaceWith = replaceWith;
    fr.wReplaceWithLen = sizeof(replaceWith);
    fr.lpfnHook = NULL;
}

static void failure(LPCSTR what, FINDPROC proc)
{
    HWND result = proc(&fr);

    wsprintf(probeResult, "%d,%lx", result ? 1 : 0, error());
    probe("error", what, probeResult);

    if (result) {
        DestroyWindow(result);
    }
}

static void state(LPCSTR what)
{
    static const int IDS[] = {edt1, edt2, chx1, chx2, grp1, rad1, rad2, IDOK, psh1, psh2, IDCANCEL, pshHelp};
    LPSTR out = probeResult;
    HWND focus = GetFocus();
    int index;
    char text[40];

    for (index = 0; index < (int)(sizeof(IDS) / sizeof(IDS[0])); index++) {
        HWND control = GetDlgItem(dialog, IDS[index]);

        if (!control) {
            continue;
        }

        GetWindowText(control, text, sizeof(text));
        out += wsprintf(out, "%x=%s/%d/%d/%d ", IDS[index], (LPSTR)text,
                        (int)IsDlgButtonChecked(dialog, IDS[index]), IsWindowEnabled(control) ? 1 : 0,
                        IsWindowVisible(control) ? 1 : 0);
    }

    GetWindowText(dialog, text, sizeof(text));
    wsprintf(out, "caption=%s focus=%x def=%x visible=%d", (LPSTR)text,
             focus ? GetDlgCtrlID(focus) : 0,
             LOWORD(SendMessage(dialog, DM_GETDEFID, 0, 0L)), IsWindowVisible(dialog) ? 1 : 0);
    probe("state", what, probeResult);
}

static void pixels(LPCSTR what)
{
    RECT r;
    HDC dc;
    int x;
    int y;

    HideCaret(NULL);
    GetWindowRect(dialog, &r);
    wsprintf(probeResult, "%d,%d,%d,%d", r.left, r.top, r.right, r.bottom);
    probe("rect", what, probeResult);
    dc = GetDC(NULL);

    for (y = r.top; y < r.bottom; y++) {
        LPSTR out = probeResult;
        char last = 0;
        int run = 0;

        for (x = r.left; x <= r.right; x++) {
            char now = x < r.right ? letter(GetPixel(dc, x, y)) : 0;

            if (now == last) {
                run++;
                continue;
            }

            if (run) {
                *out++ = last;

                if (run > 1) {
                    out += wsprintf(out, "%d", run);
                }
            }

            last = now;
            run = 1;
        }

        *out = '\0';
        wsprintf(probeArgs, "%s %d", what, y - r.top);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, dc);
    ShowCaret(NULL);
}

static void byte(BYTE value)
{
    template[at++] = value;
}

static void word(WORD value)
{
    byte(LOBYTE(value));
    byte(HIBYTE(value));
}

static void text(LPCSTR s)
{
    while (*s) {
        byte((BYTE)*s++);
    }

    byte(0);
}

static void item(int x, int y, int cx, int cy, int id, DWORD style, BYTE kind, LPCSTR caption)
{
    word((WORD)x);
    word((WORD)y);
    word((WORD)cx);
    word((WORD)cy);
    word((WORD)id);
    word(LOWORD(style));
    word(HIWORD(style));
    byte(kind);
    text(caption);
    byte(0);
}

/* A Find dialog of the program's own: the text, Match Case, and the buttons. */
static void buildTemplate(void)
{
    templateHandle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 512);
    template = (BYTE FAR *)GlobalLock(templateHandle);
    at = 0;
    word(LOWORD(WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT));
    word(HIWORD(WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT));
    byte(5);
    word(20);
    word(20);
    word(160);
    word(50);
    byte(0);
    byte(0);
    text("Mine");
    word(8);
    text("Helv");
    item(4, 6, 100, 12, edt1, WS_CHILD | WS_VISIBLE | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, 0x81,
         "");
    item(4, 24, 80, 12, chx2, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_AUTOCHECKBOX, 0x80, "&Case");
    item(110, 4, 44, 14, IDOK, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON, 0x80, "Next");
    item(110, 22, 44, 14, IDCANCEL, WS_CHILD | WS_VISIBLE | WS_TABSTOP, 0x80, "Stop");
    item(4, 38, 40, 10, stc1, WS_CHILD | WS_VISIBLE, 0x82, "Own");
    GlobalUnlock(templateHandle);
}

static void open(LPCSTR what, FINDPROC proc, DWORD flags, LPCSTR find, LPCSTR replace)
{
    reset(flags);
    lstrcpy(findWhat, find);
    lstrcpy(replaceWith, replace);
    fr.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))MakeProcInstance((FARPROC)Hook,
                                                                                instance);

    if (flags & FR_ENABLETEMPLATEHANDLE) {
        fr.hInstance = (HINSTANCE)templateHandle;
    }

    initAt = initLog;
    *initAt = '\0';
    hookAt = hookLog;
    *hookAt = '\0';
    initing = TRUE;
    initParam = FALSE;
    dialog = proc(&fr);
    initing = FALSE;
    wsprintf(probeResult, "%d,%lx,init=%s,param=%d,active=%d", dialog ? 1 : 0, error(),
             (LPSTR)initLog, initParam ? 1 : 0, GetActiveWindow() == dialog ? 1 : 0);
    probe("open", what, probeResult);
    hookAt = hookLog;
    *hookAt = '\0';
}

/* The steps, one a tick: what to do, and then what to record. */
static void next(void)
{
    step++;

    switch (step) {
    case 1:
        open("find", findText, FR_ENABLEHOOK | FR_SHOWHELP, "abc", "");
        break;
    case 2:
        state("find");
        pixels("find");
        hookFlush();
        alt('C', 0x2e);
        press(VK_RETURN, 0x1c);
        break;
    case 3:
        hookFlush();
        state("match-case");
        alt('U', 0x16);
        press(VK_RETURN, 0x1c);
        break;
    case 4:
        hookFlush();
        state("up");
        alt('W', 0x11);
        press(VK_RETURN, 0x1c);
        break;
    case 5:
        hookFlush();
        state("whole-word");
        alt('N', 0x31);
        press(VK_DELETE, 0x53);
        break;
    case 6:
        hookFlush();
        state("emptied");
        press('X', 0x2d);
        press('Y', 0x15);
        break;
    case 7:
        hookFlush();
        state("typed");
        press(VK_RETURN, 0x1c);
        break;
    case 8:
        hookFlush();
        alt('H', 0x23);
        break;
    case 9:
        hookFlush();
        eatOk = TRUE;
        press(VK_RETURN, 0x1c);
        break;
    case 10:
        hookFlush();
        eatOk = FALSE;
        press(VK_ESCAPE, 0x01);
        break;
    case 11:
        hookFlush();
        wsprintf(probeResult, "%d", IsWindow(dialog) ? 1 : 0);
        probe("alive", "find", probeResult);
        open("hidden", findText, FR_ENABLEHOOK | FR_HIDEUPDOWN | FR_HIDEMATCHCASE | FR_HIDEWHOLEWORD,
             "", "");
        break;
    case 12:
        state("hidden");
        pixels("hidden");
        SendMessage(dialog, WM_CLOSE, 0, 0L);
        break;
    case 13:
        hookFlush();
        wsprintf(probeResult, "%d", IsWindow(dialog) ? 1 : 0);
        probe("alive", "hidden", probeResult);
        open("disabled", findText,
             FR_ENABLEHOOK | FR_NOUPDOWN | FR_NOMATCHCASE | FR_NOWHOLEWORD | FR_DOWN | FR_MATCHCASE |
                 FR_WHOLEWORD | FR_FINDNEXT | FR_REPLACE,
             "Hello", "");
        break;
    case 14:
        state("disabled");
        press(VK_RETURN, 0x1c);
        break;
    case 15:
        hookFlush();
        press(VK_ESCAPE, 0x01);
        break;
    case 16:
        hookFlush();
        open("replace", replaceText, FR_ENABLEHOOK | FR_SHOWHELP, "abc", "def");
        break;
    case 17:
        state("replace");
        pixels("replace");
        answer = 1;
        alt('R', 0x13);
        break;
    case 18:
        hookFlush();
        state("replaced");
        answer = 0;
        alt('A', 0x1e);
        break;
    case 19:
        hookFlush();
        press(VK_RETURN, 0x1c);
        break;
    case 20:
        hookFlush();
        alt('N', 0x31);
        press(VK_DELETE, 0x53);
        break;
    case 21:
        hookFlush();
        state("replace-emptied");
        alt('H', 0x23);
        break;
    case 22:
        hookFlush();
        press(VK_ESCAPE, 0x01);
        break;
    case 23:
        hookFlush();
        open("own", findText, FR_ENABLEHOOK | FR_ENABLETEMPLATEHANDLE | FR_MATCHCASE, "own", "");
        break;
    case 24:
        state("own");
        pixels("own");
        press(VK_RETURN, 0x1c);
        break;
    case 25:
        hookFlush();
        press(VK_ESCAPE, 0x01);
        break;
    case 26:
        hookFlush();
        open("nohook", findText, FR_DOWN, "plain", "");
        break;
    case 27:
        state("nohook");
        press(VK_RETURN, 0x1c);
        break;
    case 28:
        SendMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
        break;
    default:
        KillTimer(owner, STEP_TIMER);
        PostQuitMessage(0);
        break;
    }
}

LRESULT FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == findMessage && findMessage) {
        FINDREPLACE FAR *sent = (FINDREPLACE FAR *)lParam;

        wsprintf(probeResult, "%lx,%s,%s,same=%d,wparam=%x", sent->Flags, sent->lpstrFindWhat,
                 sent->lpstrReplaceWith ? sent->lpstrReplaceWith : (LPSTR) "(null)",
                 sent == (FINDREPLACE FAR *)&fr ? 1 : 0, wParam);
        probe("found", "", probeResult);
        return answer;
    }

    if (message == helpMessage && helpMessage) {
        wsprintf(probeResult, "dialog=%d,same=%d", (HWND)wParam == dialog ? 1 : 0,
                 lParam == (LPARAM)(FINDREPLACE FAR *)&fr ? 1 : 0);
        probe("help", "", probeResult);
        return 0;
    }

    switch (message) {
    case WM_TIMER:
        next();
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE current, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    WNDCLASS wc;
    MSG msg;

    instance = current;
    probeOpen(OUTPUT);
    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    library = LoadLibrary("COMMDLG.DLL");

    if (library >= (HINSTANCE)32) {
        findText = (FINDPROC)GetProcAddress(library, "FindText");
        replaceText = (FINDPROC)GetProcAddress(library, "ReplaceText");
        extendedError = (ERRORPROC)GetProcAddress(library, "CommDlgExtendedError");
    }

    probe("entry", "", keybdEvent && findText && replaceText && extendedError ? "found" : "missing");

    if (!keybdEvent || !findText || !replaceText || !extendedError) {
        probeFinish();
        return 0;
    }

    findMessage = RegisterWindowMessage("commdlg_FindReplace");
    helpMessage = RegisterWindowMessage("commdlg_help");

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = OwnerProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "FindOwner";
    RegisterClass(&wc);
    owner = CreateWindow("FindOwner", "Owner", WS_OVERLAPPEDWINDOW, 0, 0, 640, 480, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);
    SetCursorPos(639, 479);
    buildTemplate();

    /* What fails, and what CommDlgExtendedError says of it. */
    reset(0);
    fr.lStructSize = 0;
    failure("size0", findText);
    wsprintf(probeResult, "%d,%lx", findText(NULL) ? 1 : 0, error());
    probe("error", "null", probeResult);
    reset(0);
    fr.hwndOwner = NULL;
    failure("noowner", findText);
    reset(0);
    fr.lpstrFindWhat = NULL;
    failure("nofind", findText);
    reset(0);
    fr.wFindWhatLen = 0;
    failure("nolength", findText);
    reset(FR_ENABLEHOOK);
    failure("nohook", findText);
    reset(FR_ENABLETEMPLATE);
    fr.lpTemplateName = "NOSUCH";
    failure("notemplate", findText);
    reset(FR_ENABLETEMPLATEHANDLE);
    fr.hInstance = NULL;
    failure("nohandle", findText);
    reset(0);
    fr.lpstrReplaceWith = NULL;
    failure("replace-noreplace", replaceText);
    reset(0);
    fr.wReplaceWithLen = 0;
    failure("replace-nolength", replaceText);
    reset(0);
    fr.lStructSize = sizeof(fr) - 1;
    failure("replace-size", replaceText);
    reset(0);
    fr.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))0x12345678L;
    dialog = findText(&fr);
    wsprintf(probeResult, "%d,%lx,hook=%lx,visible=%d", dialog ? 1 : 0, error(),
             (DWORD)fr.lpfnHook, dialog && IsWindowVisible(dialog) ? 1 : 0);
    probe("unhooked", "", probeResult);
    DestroyWindow(dialog);
    dialog = NULL;

    SetTimer(owner, STEP_TIMER, 400, NULL);

    while (GetMessage(&msg, NULL, 0, 0)) {
        if (dialog && IsWindow(dialog) && IsDialogMessage(dialog, &msg)) {
            continue;
        }

        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
