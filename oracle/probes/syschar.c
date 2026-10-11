/*
 * A character a window takes as a system key, with Alt's bit in its
 * `lParam` and without, and what `DefWindowProc` and the dialog manager do
 * with it: the menu a letter opens, a mnemonic matched or not, and the
 * characters a dialog keeps for itself. A beep cannot be heard here; what
 * goes to which window can.
 *
 * Windows at the top: P, with a caption and a system menu and no menu bar;
 * Q, a pop-up with neither; R, with a menu bar holding `&File`, which holds
 * `&Open`. M is a modeless dialog with a caption and a system menu, holding
 * an edit control M1 and a push button M2, `&Go` (102). Each case posts one
 * message to a window and takes the queue, through `IsDialogMessage(M)`
 * first for M's cases:
 *
 * * `msg`: each of `WM_CHAR`, `WM_SYSCHAR`, `WM_SYSCOMMAND`, `WM_COMMAND`,
 *   `WM_MENUCHAR`, `WM_INITMENU`, `WM_INITMENUPOPUP`, `WM_MENUSELECT`,
 *   `WM_SETFOCUS` and `WM_KILLFOCUS`
 *   that P, Q, R, M, M1 or M2 got: the window, the message, `wParam` and
 *   `lParam` in hexadecimal (a window by its name for the focus messages,
 *   and for `WM_COMMAND`'s control). `WM_ENTERMENULOOP` and
 *   `WM_EXITMENULOOP` are left out.
 * * `taken`: for M's cases, what `IsDialogMessage` answered for the message
 *   posted.
 * * `state`: the focus and the active window after the case.
 *
 * A timer of P's presses Escape with `KEYBD_EVENT` two seconds into a case,
 * in case a menu stays up, and `rescue` says so.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\SYSCHAR.OUT"


#define ID_M1 101
#define ID_M2 102
#define ID_OPEN 201
#define ALT_BIT 0x20000000L

static HINSTANCE instance;
static HWND windowP;
static HWND windowQ;
static HWND windowR;
static HWND dialogM;
static LPCSTR step = "";
static int number;
static FARPROC keybdEvent;
static WORD keyAX;
static WORD keyBX;
static WNDPROC editProc;
static WNDPROC buttonProc;
static FARPROC editSpy;
static FARPROC buttonSpy;

/* Records kept until the case is over: a window procedure in a menu's loop
 * has too little stack left for `probe`'s line. */
static char far queued[8000];
static unsigned queuedAt;

static void queue(LPCSTR function, LPCSTR args, LPCSTR result)
{
    char line[160];
    int length;

    length = wsprintf(line, "%s\t%s\t%s", function, args, result);

    if (queuedAt + length + 1 < sizeof(queued)) {
        _fmemcpy(queued + queuedAt, line, length + 1);
        queuedAt += length + 1;
    }
}

static void flush(void)
{
    static char function[16];
    static char args[64];
    static char result[128];
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

static void name(LPSTR out, HWND hwnd)
{
    if (hwnd == NULL) {
        lstrcpy(out, "0");
    } else if (hwnd == windowP) {
        lstrcpy(out, "P");
    } else if (hwnd == windowQ) {
        lstrcpy(out, "Q");
    } else if (hwnd == windowR) {
        lstrcpy(out, "R");
    } else if (hwnd == dialogM) {
        lstrcpy(out, "M");
    } else if (dialogM != NULL && IsWindow(hwnd) && GetParent(hwnd) == dialogM) {
        wsprintf(out, "M%d", GetDlgCtrlID(hwnd) - 100);
    } else {
        lstrcpy(out, "?");
    }
}

static void logMessage(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char who[8];
    char w[16];
    char l[16];

    switch (message) {
    case WM_CHAR:
    case WM_SYSCHAR:
    case WM_MENUCHAR:
    case WM_INITMENUPOPUP:
    case WM_MENUSELECT:
        wsprintf(w, "%04x", wParam);
        wsprintf(l, "%08lx", lParam);
        break;
    case WM_COMMAND:
        wsprintf(w, "%04x", wParam);
        name(l, (HWND)LOWORD(lParam));
        wsprintf(l + lstrlen(l), ",%04x", HIWORD(lParam));
        break;
    case WM_SYSCOMMAND:
        wsprintf(w, "%04x", wParam & 0xfff0);
        wsprintf(l, "%08lx", lParam);
        break;
    case WM_INITMENU:
        lstrcpy(w, "-");
        lstrcpy(l, "-");
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
        name(w, (HWND)wParam);
        lstrcpy(l, "-");
        break;
    default:
        return;
    }

    /* The menus' handles differ from run to run: only whether there is one. */
    if (message == WM_INITMENUPOPUP || message == WM_MENUCHAR) {
        wsprintf(l, "%04x,%d", LOWORD(lParam), HIWORD(lParam) != 0);
    } else if (message == WM_MENUSELECT) {
        wsprintf(l, "%04x,%d", LOWORD(lParam), HIWORD(lParam) != 0);
    }

    name(who, hwnd);
    wsprintf(probeArgs, "%s,%d", step, number++);
    wsprintf(probeResult, "%s,%04x,%s,%s", (LPSTR)who, message, (LPSTR)w, (LPSTR)l);
    queue("msg", probeArgs, probeResult);
}

static void key(BYTE vk, BOOL up)
{
    keyAX = (WORD)vk | (up ? 0x8000 : 0);
    keyBX = 1;

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

LONG FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    if (message == WM_TIMER && hwnd == windowP) {
        KillTimer(hwnd, 1);
        queue("rescue", step, "escape");
        key(VK_ESCAPE, FALSE);
        key(VK_ESCAPE, TRUE);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export EditSpy(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    return CallWindowProc((FARPROC)editProc, hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export ButtonSpy(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    return CallWindowProc((FARPROC)buttonProc, hwnd, message, wParam, lParam);
}

BOOL FAR PASCAL _export DialogProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        dialogM = hwnd;
        editProc = (WNDPROC)SetWindowLong(GetDlgItem(hwnd, ID_M1), GWL_WNDPROC, (LONG)editSpy);
        buttonProc =
            (WNDPROC)SetWindowLong(GetDlgItem(hwnd, ID_M2), GWL_WNDPROC, (LONG)buttonSpy);
    }

    logMessage(hwnd, message, wParam, lParam);

    return message == WM_INITDIALOG;
}

static void state(void)
{
    char focus[8];
    char active[8];

    name(focus, GetFocus());
    name(active, GetActiveWindow());
    wsprintf(probeResult, "focus=%s,active=%s", (LPSTR)focus, (LPSTR)active);
    queue("state", step, probeResult);
}

/* One message posted to a window, and the queue taken, with the timer that
 * would close a menu left up. */
static void post(LPCSTR label, HWND to, UINT message, WPARAM wParam, LPARAM lParam, BOOL dialog)
{
    MSG msg;
    char taken[8];

    step = label;
    number = 0;
    SetTimer(windowP, 1, 2000, NULL);
    PostMessage(to, message, wParam, lParam);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        if (dialog && msg.hwnd != windowP && msg.message != WM_TIMER) {
            BOOL answer = IsDialogMessage(dialogM, &msg);

            if (msg.message == message && msg.wParam == wParam) {
                wsprintf(taken, "%d", answer);
                queue("taken", label, taken);
            }

            if (answer) {
                continue;
            }
        }

        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    KillTimer(windowP, 1);
    state();
    flush();
}

/* A template in a global block. */
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

static void item(int x, int y, int id, DWORD style, BYTE type, LPCSTR text)
{
    word(x);
    word(y);
    word(60);
    word(12);
    word(id);
    word(LOWORD(style));
    word(HIWORD(style));
    byte(type);
    string(text);
    byte(0);
}

static void focus(LPCSTR label, HWND to)
{
    step = label;
    number = 0;
    SetFocus(to);
    state();
    flush();
}

int PASCAL WinMain(HINSTANCE hinst, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HGLOBAL memory;
    HMENU bar;
    HMENU file;
    DWORD style;

    instance = hinst;
    probeOpen(OUTPUT);
    editSpy = MakeProcInstance((FARPROC)EditSpy, instance);
    buttonSpy = MakeProcInstance((FARPROC)ButtonSpy, instance);
    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");

    wc.style = 0;
    wc.lpfnWndProc = WindowProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = NULL;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "ProbeSysChar";
    RegisterClass(&wc);

    bar = CreateMenu();
    file = CreatePopupMenu();
    AppendMenu(file, MF_STRING, ID_OPEN, "&Open");
    AppendMenu(bar, MF_POPUP, (UINT)file, "&File");

    windowR = CreateWindow("ProbeSysChar", "R", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 340, 240, 260,
                           160, NULL, bar, instance, NULL);
    windowQ = CreateWindow("ProbeSysChar", "Q", WS_POPUP | WS_BORDER | WS_VISIBLE, 340, 20, 200,
                           100, NULL, NULL, instance, NULL);
    windowP = CreateWindow("ProbeSysChar", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300,
                           200, NULL, NULL, instance, NULL);

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    template = (BYTE FAR *)GlobalLock(memory);
    style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | WS_VISIBLE;
    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(2);
    word(40);
    word(140);
    word(120);
    word(50);
    byte(0);
    byte(0);
    string("M");
    item(6, 6, ID_M1, ES_LEFT | WS_BORDER | WS_TABSTOP | WS_CHILD | WS_VISIBLE, 0x81, "");
    item(6, 24, ID_M2, BS_PUSHBUTTON | WS_TABSTOP | WS_CHILD | WS_VISIBLE, 0x80, "&Go");
    CreateDialogIndirect(instance, template, NULL, (DLGPROC)DialogProc);
    GlobalUnlock(memory);

    step = "made";
    SetActiveWindow(windowP);
    SetFocus(windowP);
    state();
    flush();

    /* P: no Alt, then Alt, then Escape without, then Tab with. */
    post("p-plain", windowP, WM_SYSCHAR, 'q', 0x00100001L, FALSE);
    post("p-alt", windowP, WM_SYSCHAR, 'q', ALT_BIT | 0x00100001L, FALSE);
    post("p-escape", windowP, WM_SYSCHAR, 0x1b, 0x00010001L, FALSE);
    post("p-alttab", windowP, WM_SYSCHAR, 0x09, ALT_BIT | 0x000f0001L, FALSE);
    post("p-nought", windowP, WM_SYSCHAR, 0, ALT_BIT | 0x00100001L, FALSE);

    /* Q: no menu and no system menu. */
    SetActiveWindow(windowQ);
    focus("q-focus", windowQ);
    post("q-alt", windowQ, WM_SYSCHAR, 'q', ALT_BIT | 0x00100001L, FALSE);
    post("q-plain", windowQ, WM_SYSCHAR, 'q', 0x00100001L, FALSE);

    /* R: a letter its bar has not. */
    SetActiveWindow(windowR);
    focus("r-focus", windowR);
    post("r-alt", windowR, WM_SYSCHAR, 'x', ALT_BIT | 0x002d0001L, FALSE);

    /* M: its edit control has the focus. */
    SetActiveWindow(dialogM);
    focus("m-focus1", GetDlgItem(dialogM, ID_M1));
    post("m-alt-none", GetDlgItem(dialogM, ID_M1), WM_SYSCHAR, 'q', ALT_BIT | 0x00100001L, TRUE);
    post("m-alt-go", GetDlgItem(dialogM, ID_M1), WM_SYSCHAR, 'g', ALT_BIT | 0x00220001L, TRUE);
    post("m-char-edit", GetDlgItem(dialogM, ID_M1), WM_CHAR, 'q', 0x00100001L, TRUE);

    /* The button has it, which takes no characters. */
    focus("m-focus2", GetDlgItem(dialogM, ID_M2));
    post("m-char-none", GetDlgItem(dialogM, ID_M2), WM_CHAR, 'q', 0x00100001L, TRUE);
    post("m-char-go", GetDlgItem(dialogM, ID_M2), WM_CHAR, 'g', 0x00220001L, TRUE);
    post("m-plain-sys", GetDlgItem(dialogM, ID_M2), WM_SYSCHAR, 'q', 0x00100001L, TRUE);

    /* Nothing has the focus. */
    focus("m-focus0", NULL);
    post("m-nofocus-sys", dialogM, WM_SYSCHAR, 'q', 0x00100001L, TRUE);
    post("m-nofocus-alt", dialogM, WM_SYSCHAR, 'q', ALT_BIT | 0x00100001L, TRUE);
    post("m-self-char", dialogM, WM_CHAR, 'q', 0x00100001L, TRUE);

    step = "finish";
    DestroyWindow(dialogM);
    DestroyWindow(windowP);
    DestroyWindow(windowQ);
    DestroyWindow(windowR);
    GlobalFree(memory);
    flush();
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
