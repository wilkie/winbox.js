/*
 * How a dialog ends: what `EndDialog` does at once and what is left to
 * `DialogBox`'s loop, the messages the dialog, its owner and their
 * controls are sent, where the activation and the focus go, and what
 * `DialogBox` answers.
 *
 * Two windows at the top: W, shown first, and O, shown after it and so
 * active, with an edit control E in it that has the focus. The dialogs are
 * built in memory: D, a pop-up with a caption, a system menu and a modal
 * frame, holding an edit control D1 and a push button D2; N, a dialog like
 * it with a button N1, run over D. Each case runs D with
 * `DialogBoxIndirect` owned by O, unless it says otherwise. D's procedure
 * answers TRUE to `WM_INITDIALOG` and posts itself a message; that message
 * sets a timer, and the timer's tick does the case's ending.
 *
 * * `msg`: each of `WM_ENABLE`, `WM_SHOWWINDOW`, `WM_SETFOCUS`,
 *   `WM_KILLFOCUS`, `WM_NCACTIVATE`, `WM_ACTIVATE`, `WM_ACTIVATEAPP`,
 *   `WM_WINDOWPOSCHANGING`, `WM_WINDOWPOSCHANGED`, `WM_CANCELMODE`,
 *   `WM_DESTROY` and `WM_NCDESTROY` that O, E, W, D, D1, D2, N or N1 got,
 *   by case and number: the window, the message in hexadecimal, its
 *   `wParam` (a window by its name for the focus messages), and for the
 *   activation messages the window named in `lParam`'s low word, for the
 *   position messages the flags' low byte.
 * * `state`: at a point of the case, `GetFocus`, `GetActiveWindow`,
 *   whether D shows, whether O is enabled, `GetLastActivePopup(O)`,
 *   whether D is still a window, and its `DM_GETDEFID`.
 * * `answer`: what `DialogBoxIndirect` answered.
 *
 * The set-up between cases -- O made active again with the focus in E,
 * enabled and restored, or disabled or minimized for the next -- writes
 * its `state` and not its messages.
 *
 * The cases:
 *
 * * `end`: `EndDialog(D, 7)` at the tick. `init` and `posted` note the
 *   state as `WM_INITDIALOG` comes and as the posted message is taken.
 * * `twice`: `EndDialog(D, 3)` then `EndDialog(D, 4)`.
 * * `initdlg`: `EndDialog(D, 5)` in `WM_INITDIALOG`; `initvis` the same
 *   with D's template `WS_VISIBLE`.
 * * `disabled`: O disabled before `DialogBox`.
 * * `minimized`: O minimized before `DialogBox`.
 * * `noowner`: D owned by no window.
 * * `outside`: the tick posts O a message, and O's procedure ends D.
 * * `destroy`: `DestroyWindow(D)` at the tick, no `EndDialog`.
 * * `nested`: at D's tick D2 is given the focus and N run over D; N's own
 *   tick ends N, then D is ended.
 * * `modeless`: D made by `CreateDialogIndirect`, shown, active, its focus
 *   in D1, ended, then destroyed. `mldis` the same with O disabled first;
 *   `mlinactive` with W made active before D is ended.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\ENDDLG.OUT"

#define ID_D1 101
#define ID_D2 102
#define ID_N1 201
#define TICK 1
#define WM_START (WM_USER + 1)
#define WM_ENDIT (WM_USER + 2)

enum {
    END,
    TWICE,
    INITDLG,
    DISABLED,
    MINIMIZED,
    NOOWNER,
    OUTSIDE,
    DESTROY,
    NESTED
};

static HINSTANCE instance;
static HWND windowO;
static HWND windowW;
static HWND editE;
static HWND dialogD;
static HWND dialogN;
static HGLOBAL memoryD;
static HGLOBAL memoryN;
static int kind;
static LPCSTR step = "";
static int number;
/* Set-up between cases, whose messages are not written. */
static BOOL quiet;
static WNDPROC editProc;
static WNDPROC buttonProc;

/* Records kept until `WinMain` writes them: a window procedure deep in a
 * dialog's making has too little stack left for `probe`'s line. */
static char far queued[24000];
static unsigned queuedAt;

static void queue(LPCSTR function, LPCSTR args, LPCSTR result)
{
    char line[200];
    int length;

    length = wsprintf(line, "%s\t%s\t%s", function, args, result);

    if (queuedAt + length + 1 < sizeof(queued)) {
        _fmemcpy(queued + queuedAt, line, length + 1);
        queuedAt += length + 1;
    }
}

/* Each record queued, written. */
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

/* A window's name: O, E, W, D, D1, D2, N, N1, 0, or ? for any other. */
static void name(LPSTR out, HWND hwnd)
{
    if (hwnd == NULL) {
        lstrcpy(out, "0");
    } else if (hwnd == windowO) {
        lstrcpy(out, "O");
    } else if (hwnd == windowW) {
        lstrcpy(out, "W");
    } else if (hwnd == editE) {
        lstrcpy(out, "E");
    } else if (hwnd == dialogD) {
        lstrcpy(out, "D");
    } else if (hwnd == dialogN) {
        lstrcpy(out, "N");
    } else if (dialogD != NULL && IsWindow(hwnd) && GetParent(hwnd) == dialogD) {
        wsprintf(out, "D%d", GetDlgCtrlID(hwnd) - 100);
    } else if (dialogN != NULL && IsWindow(hwnd) && GetParent(hwnd) == dialogN) {
        wsprintf(out, "N%d", GetDlgCtrlID(hwnd) - 200);
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
    case WM_ENABLE:
    case WM_SHOWWINDOW:
    case WM_NCACTIVATE:
    case WM_CANCELMODE:
    case WM_DESTROY:
    case WM_NCDESTROY:
        wsprintf(w, "%u", wParam);
        lstrcpy(l, "-");
        break;
    case WM_ACTIVATE:
        wsprintf(w, "%u", wParam);
        name(l, (HWND)LOWORD(lParam));
        break;
    case WM_ACTIVATEAPP:
        wsprintf(w, "%u", wParam);
        lstrcpy(l, "-");
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
        name(w, (HWND)wParam);
        lstrcpy(l, "-");
        break;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        lstrcpy(w, "-");
        wsprintf(l, "%02x", LOBYTE(((WINDOWPOS FAR *)lParam)->flags));
        break;
    default:
        return;
    }

    if (quiet) {
        return;
    }

    name(who, hwnd);
    wsprintf(probeArgs, "%s,%d", step, number++);
    wsprintf(probeResult, "%s,%04x,%s,%s", (LPSTR)who, message, (LPSTR)w, (LPSTR)l);
    queue("msg", probeArgs, probeResult);
}

static void begin(LPCSTR name)
{
    step = name;
    number = 0;
    quiet = FALSE;
}

static void hush(LPCSTR name)
{
    begin(name);
    quiet = TRUE;
}

static void state(LPCSTR at)
{
    char focus[8];
    char active[8];
    char last[8];
    DWORD defId = 0;

    name(focus, GetFocus());
    name(active, GetActiveWindow());
    name(last, GetLastActivePopup(windowO));

    if (dialogD != NULL && IsWindow(dialogD)) {
        defId = SendMessage(dialogD, DM_GETDEFID, 0, 0L);
    }

    wsprintf(probeArgs, "%s,%s", step, at);
    wsprintf(probeResult, "focus=%s,active=%s,D=%d,O=%d,last=%s,window=%d,defid=%08lx",
             (LPSTR)focus, (LPSTR)active, dialogD != NULL && IsWindowVisible(dialogD),
             IsWindowEnabled(windowO) ? 1 : 0, (LPSTR)last,
             dialogD != NULL && IsWindow(dialogD), defId);
    queue("state", probeArgs, probeResult);
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

/* Through thunks: USER calls a dialog's edit control with its own data
 * segment for the instance, not the program's. */
static FARPROC editSpy;
static FARPROC buttonSpy;

static void spy(HWND dialog, int id, BOOL edit)
{
    HWND control = GetDlgItem(dialog, id);

    if (control == NULL) {
        return;
    }

    if (edit) {
        editProc = (WNDPROC)SetWindowLong(control, GWL_WNDPROC, (LONG)editSpy);
    } else {
        buttonProc = (WNDPROC)SetWindowLong(control, GWL_WNDPROC, (LONG)buttonSpy);
    }
}

LONG FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    if (message == WM_ENDIT) {
        begin("outside-end");
        EndDialog(dialogD, 9);
        state("ended");
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

BOOL FAR PASCAL _export NestedProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        dialogN = hwnd;
        spy(hwnd, ID_N1, FALSE);
    }

    logMessage(hwnd, message, wParam, lParam);

    switch (message) {
    case WM_INITDIALOG:
        PostMessage(hwnd, WM_START, 0, 0L);
        return TRUE;
    case WM_START:
        SetTimer(hwnd, TICK, 200, NULL);
        return TRUE;
    case WM_TIMER:
        KillTimer(hwnd, TICK);
        begin("nested-endN");
        state("before");
        EndDialog(hwnd, 11);
        state("ended");
        return TRUE;
    }

    return FALSE;
}

BOOL FAR PASCAL _export DialogProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    int answer;

    if (message == WM_INITDIALOG) {
        dialogD = hwnd;
        spy(hwnd, ID_D1, TRUE);
        spy(hwnd, ID_D2, FALSE);
    }

    logMessage(hwnd, message, wParam, lParam);

    switch (message) {
    case WM_INITDIALOG:
        state("init");

        if (kind == INITDLG) {
            EndDialog(hwnd, 5);
            state("init-ended");
            return TRUE;
        }

        PostMessage(hwnd, WM_START, 0, 0L);
        return TRUE;

    case WM_START:
        state("posted");
        SetTimer(hwnd, TICK, 200, NULL);
        return TRUE;

    case WM_TIMER:
        KillTimer(hwnd, TICK);
        state("shown");

        switch (kind) {
        case TWICE:
            EndDialog(hwnd, 3);
            state("ended");
            begin("twice-again");
            EndDialog(hwnd, 4);
            state("ended");
            break;
        case OUTSIDE:
            PostMessage(windowO, WM_ENDIT, 0, 0L);
            break;
        case DESTROY:
            DestroyWindow(hwnd);
            state("destroyed");
            break;
        case NESTED:
            SetFocus(GetDlgItem(hwnd, ID_D2));
            begin("nested-run");
            answer = DialogBoxIndirect(instance, memoryN, hwnd, (DLGPROC)NestedProc);
            dialogN = NULL;
            begin("nested-back");
            wsprintf(probeResult, "%d", answer);
            queue("answer", "nested-N", probeResult);
            state("back");
            begin("nested-endD");
            EndDialog(hwnd, 12);
            state("ended");
            break;
        default:
            EndDialog(hwnd, 7);
            state("ended");
            break;
        }

        return TRUE;
    }

    return FALSE;
}

/* A template in a global block: its header, then each control. */
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

static void header(DWORD style, int count, int x, LPCSTR title)
{
    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte((BYTE)count);
    word(x);
    word(20);
    word(120);
    word(60);
    byte(0);
    byte(0);
    string(title);
}

#define DIALOG_STYLE (WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME)

static void buildD(HGLOBAL memory, BOOL visible)
{
    template = (BYTE FAR *)GlobalLock(memory);
    header(DIALOG_STYLE | (visible ? WS_VISIBLE : 0), 2, 40, "D");
    item(6, 6, ID_D1, ES_LEFT | WS_BORDER | WS_TABSTOP | WS_CHILD | WS_VISIBLE, 0x81, "");
    item(6, 24, ID_D2, BS_PUSHBUTTON | WS_TABSTOP | WS_CHILD | WS_VISIBLE, 0x80, "B");
    GlobalUnlock(memory);
}

static void buildN(HGLOBAL memory)
{
    template = (BYTE FAR *)GlobalLock(memory);
    header(DIALOG_STYLE, 1, 80, "N");
    item(6, 6, ID_N1, BS_PUSHBUTTON | WS_TABSTOP | WS_CHILD | WS_VISIBLE, 0x80, "N");
    GlobalUnlock(memory);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

/* O active again, its focus in E, and enabled, between cases. */
static void settle(void)
{
    hush("settle");

    if (!IsWindowEnabled(windowO)) {
        EnableWindow(windowO, TRUE);
    }

    if (IsIconic(windowO)) {
        ShowWindow(windowO, SW_RESTORE);
    }

    SetActiveWindow(windowO);
    SetFocus(editE);
    pump();
    state("settled");
    dialogD = NULL;
    flush();
}

static void modal(int which, LPCSTR label, HWND owner)
{
    int answer;

    kind = which;
    begin(label);
    state("start");
    answer = DialogBoxIndirect(instance, memoryD, owner, (DLGPROC)DialogProc);
    begin(label);
    number = 100;
    wsprintf(probeResult, "%d", answer);
    queue("answer", label, probeResult);
    state("after");
    pump();
    state("pumped");
    flush();
}

static void modeless(LPCSTR label, int how)
{
    char after[16];

    kind = END;
    begin(label);

    if (how == 1) {
        EnableWindow(windowO, FALSE);
    }

    dialogD = CreateDialogIndirect(instance, template, windowO, (DLGPROC)DialogProc);
    /* Its posted message is taken here, and no tick is let come. */
    pump();
    KillTimer(dialogD, TICK);
    SetFocus(GetDlgItem(dialogD, ID_D1));

    if (how == 2) {
        SetActiveWindow(windowW);
    }

    pump();
    state("made");
    lstrcpy(after, label);
    lstrcat(after, "-end");
    begin(after);
    EndDialog(dialogD, 8);
    state("ended");
    pump();
    state("pumped");
    lstrcpy(after, label);
    lstrcat(after, "-destroy");
    begin(after);
    DestroyWindow(dialogD);
    state("destroyed");
    pump();
    flush();
}

int PASCAL WinMain(HINSTANCE hinst, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;

    instance = hinst;
    probeOpen(OUTPUT);
    editSpy = MakeProcInstance((FARPROC)EditSpy, instance);
    buttonSpy = MakeProcInstance((FARPROC)ButtonSpy, instance);

    wc.style = 0;
    wc.lpfnWndProc = OwnerProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = NULL;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "ProbeEndDlg";
    RegisterClass(&wc);

    memoryD = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    memoryN = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    buildD(memoryD, FALSE);
    buildN(memoryN);

    begin("create");
    windowW = CreateWindow("ProbeEndDlg", "W", WS_OVERLAPPEDWINDOW, 300, 200, 300, 200, NULL,
                           NULL, instance, NULL);
    ShowWindow(windowW, SW_SHOWNORMAL);
    windowO = CreateWindow("ProbeEndDlg", "O", WS_OVERLAPPEDWINDOW, 20, 20, 400, 300, NULL,
                           NULL, instance, NULL);
    editE = CreateWindow("EDIT", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 100, 20,
                         windowO, (HMENU)1, instance, NULL);
    editProc = (WNDPROC)SetWindowLong(editE, GWL_WNDPROC, (LONG)editSpy);
    ShowWindow(windowO, SW_SHOWNORMAL);
    SetFocus(editE);
    pump();
    state("made");
    flush();

    modal(END, "end", windowO);
    settle();
    modal(TWICE, "twice", windowO);
    settle();
    modal(INITDLG, "initdlg", windowO);
    settle();

    buildD(memoryD, TRUE);
    modal(INITDLG, "initvis", windowO);
    settle();
    buildD(memoryD, FALSE);

    hush("disabled-set");
    EnableWindow(windowO, FALSE);
    modal(DISABLED, "disabled", windowO);
    settle();

    hush("minimized-set");
    ShowWindow(windowO, SW_MINIMIZE);
    pump();
    modal(MINIMIZED, "minimized", windowO);
    settle();

    modal(NOOWNER, "noowner", NULL);
    settle();

    modal(OUTSIDE, "outside", windowO);
    settle();

    modal(DESTROY, "destroy", windowO);
    settle();

    modal(NESTED, "nested", windowO);
    settle();

    buildD(memoryD, TRUE);
    template = (BYTE FAR *)GlobalLock(memoryD);
    modeless("modeless", 0);
    settle();
    modeless("mldis", 1);
    settle();
    modeless("mlinactive", 2);
    settle();
    GlobalUnlock(memoryD);

    begin("finish");
    DestroyWindow(windowO);
    DestroyWindow(windowW);
    GlobalFree(memoryD);
    GlobalFree(memoryN);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
