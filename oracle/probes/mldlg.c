/*
 * A multi-line edit control in a dialog and out of one: what Escape, Enter
 * and Tab do. And a list box made one dialog unit square in a dialog with a
 * font, as Control Panel's Date & Time makes its AM and PM list, then moved
 * to other heights.
 *
 * The dialog is run with `DialogBoxIndirect`, from a template built in
 * memory in Helv 8 as Control Panel's are. It holds a multi-line edit control
 * (101), one with `ES_WANTRETURN` (102), a single-line one (103), a list box
 * (104) and one with `LBS_NOINTEGRALHEIGHT` (105), each a dialog unit square,
 * and OK (the default) and Cancel. The multi-line controls are tall enough
 * for three lines: one that does not scroll down takes nothing that would make
 * more lines than show (`USER.EXE` seg30 `07f3`), and at 12 dialog units
 * high, with a border, none shows. Its procedure writes down every
 * `WM_COMMAND` and `WM_CLOSE` and ends the dialog for neither, so each case is
 * taken in the same dialog. A timer's tick each half second takes the next
 * step, and the keys go in through USER's own `KEYBD_EVENT`, so the dialog's
 * own loop and `IsDialogMessage` take them.
 *
 * * `list`: each list box's row height (`LB_GETITEMHEIGHT`) and window
 *   height as the dialog starts, and after `MoveWindow` to each of several
 *   heights.
 * * `before`, for each case: the focus given to the case's control and its
 *   text set; then the key pressed. `after`: the commands and closes so far,
 *   the focus's identifier, the control's text (a CR as `|`, a LF as `/`, a
 *   tab as `^`) and whether the dialog is still shown.
 *
 * Then the same multi-line control as the only child of an ordinary window,
 * whose loop calls no `IsDialogMessage`, with the same keys.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MLDLG.OUT"

#define ID_ML 101
#define ID_RETURN 102
#define ID_SL 103
#define ID_LIST 104
#define ID_LOOSE 105
#define STEP_TIMER 77

typedef struct {
    int id;
    BYTE vk;
    BYTE scan;
    BYTE held;
    const char *name;
} CASE;

static const CASE CASES[] = {
    {ID_ML, 'A', 0x1e, 0, "letter"},           {ID_ML, VK_ESCAPE, 0x01, 0, "escape"},
    {ID_ML, VK_RETURN, 0x1c, 0, "enter"},      {ID_ML, VK_TAB, 0x0f, 0, "tab"},
    {ID_ML, VK_TAB, 0x0f, VK_SHIFT, "shift-tab"}, {ID_RETURN, VK_RETURN, 0x1c, 0, "enter"},
    {ID_RETURN, VK_ESCAPE, 0x01, 0, "escape"}, {ID_RETURN, VK_TAB, 0x0f, 0, "tab"},
    {ID_SL, VK_ESCAPE, 0x01, 0, "escape"},     {ID_SL, VK_RETURN, 0x1c, 0, "enter"},
    {ID_ML, 'A', 0x1e, 0, "letter-last"},
};

#define CASE_COUNT (sizeof(CASES) / sizeof(CASES[0]))

static const int HEIGHTS[] = {15, 13, 14, 20, 30, 2};

#define HEIGHT_COUNT (sizeof(HEIGHTS) / sizeof(HEIGHTS[0]))

static FARPROC keybdEvent;
static BYTE FAR *template;
static int at;
static char log[256];
static LPSTR logAt;
static int index;
static int phase;
static HWND plain;
static HWND plainEdit;

static void note(LPCSTR text)
{
    if (logAt - log >= (int)sizeof(log) - 16) {
        return;
    }

    logAt += wsprintf(logAt, "%s%s", (LPSTR)(logAt == log ? "" : " "), text);
}

static void clear(void)
{
    logAt = log;
    *logAt = '\0';
}

static WORD keyAX;
static WORD keyBX;

/* One key, pressed or released, as the keyboard driver hands it to USER:
 * AL the virtual key, AH 80h for a release, BL the scan code. */
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

static void press(const CASE FAR *one)
{
    if (one->held) {
        key(one->held, 0x2a, FALSE);
    }

    key(one->vk, one->scan, FALSE);
    key(one->vk, one->scan, TRUE);

    if (one->held) {
        key(one->held, 0x2a, TRUE);
    }
}

static void shown(HWND window, LPSTR out)
{
    char text[64];
    int i;

    GetWindowText(window, text, sizeof(text));

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            text[i] = '|';
        }

        if (text[i] == '\n') {
            text[i] = '/';
        }

        if (text[i] == '\t') {
            text[i] = '^';
        }
    }

    lstrcpy(out, text);
}

static void focusName(LPSTR out)
{
    HWND focus = GetFocus();

    if (focus == NULL) {
        lstrcpy(out, "none");
    } else {
        wsprintf(out, "%d", GetDlgCtrlID(focus));
    }
}

static void lists(HWND dialog, LPCSTR when)
{
    RECT list;
    RECT loose;

    GetWindowRect(GetDlgItem(dialog, ID_LIST), &list);
    GetWindowRect(GetDlgItem(dialog, ID_LOOSE), &loose);
    wsprintf(probeResult, "row=%ld,height=%d,loose-row=%ld,loose-height=%d",
             SendDlgItemMessage(dialog, ID_LIST, LB_GETITEMHEIGHT, 0, 0L), list.bottom - list.top,
             SendDlgItemMessage(dialog, ID_LOOSE, LB_GETITEMHEIGHT, 0, 0L),
             loose.bottom - loose.top);
    probe("list", when, probeResult);
}

static void moved(HWND dialog)
{
    char when[16];
    RECT r;
    int i;

    for (i = 0; i < (int)HEIGHT_COUNT; i++) {
        HWND list = GetDlgItem(dialog, ID_LIST);
        HWND loose = GetDlgItem(dialog, ID_LOOSE);

        GetWindowRect(list, &r);
        ScreenToClient(dialog, (POINT FAR *)&r);
        MoveWindow(list, r.left, r.top, 30, HEIGHTS[i], FALSE);
        GetWindowRect(loose, &r);
        ScreenToClient(dialog, (POINT FAR *)&r);
        MoveWindow(loose, r.left, r.top, 30, HEIGHTS[i], FALSE);
        wsprintf(when, "moved-%d", HEIGHTS[i]);
        lists(dialog, when);
    }
}

static void after(HWND window, const CASE *one, BOOL dialog)
{
    char focus[8];
    char text[64];
    char args[32];

    focusName(focus);
    shown(dialog ? GetDlgItem(window, one->id) : plainEdit, text);
    wsprintf(args, "%s,%d,%s", (LPSTR)(dialog ? "dialog" : "plain"), one->id, (LPSTR)one->name);
    wsprintf(probeResult, "log=%s,focus=%s,text=%s,up=%d", (LPSTR)log, (LPSTR)focus, (LPSTR)text,
             IsWindowVisible(window) ? 1 : 0);
    probe("after", args, probeResult);
    clear();
}

/* The next step of the dialog's cases. */
static void step(HWND dialog)
{
    const CASE *one;

    if (phase == 1) {
        after(dialog, &CASES[index], TRUE);
        index++;
        phase = 0;
    }

    if (index >= (int)CASE_COUNT) {
        KillTimer(dialog, STEP_TIMER);
        EndDialog(dialog, 7);
        return;
    }

    one = &CASES[index];
    SetDlgItemText(dialog, ID_ML, "ab");
    SetDlgItemText(dialog, ID_RETURN, "cd");
    SetDlgItemText(dialog, ID_SL, "ef");
    SetFocus(GetDlgItem(dialog, one->id));
    SendDlgItemMessage(dialog, one->id, EM_SETSEL, 0, MAKELONG(1, 1));
    clear();
    press(one);
    phase = 1;
}

BOOL FAR PASCAL _export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[16];

    switch (message) {
    case WM_INITDIALOG:
        lists(dialog, "made");
        moved(dialog);
        SetTimer(dialog, STEP_TIMER, 500, NULL);
        return TRUE;
    case WM_COMMAND:
        if (wParam < 100) {
            wsprintf(one, "%x:%x", wParam, HIWORD(lParam));
            note(one);
        }

        return TRUE;
    case WM_CLOSE:
        note("close");
        return FALSE;
    case WM_TIMER:
        if (wParam == STEP_TIMER) {
            step(dialog);
        }

        return TRUE;
    }

    return FALSE;
}

LONG FAR PASCAL _export PlainProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[16];

    switch (message) {
    case WM_COMMAND:
        if ((HWND)LOWORD(lParam) != plainEdit || HIWORD(lParam) < 0x100) {
            wsprintf(one, "%x:%x", wParam, HIWORD(lParam));
            note(one);
        }

        return 0;
    case WM_CLOSE:
        note("close");
        return 0;
    case WM_TIMER:
        if (phase == 1) {
            after(hwnd, &CASES[index], FALSE);
            index++;
            phase = 0;
        }

        while (index < (int)CASE_COUNT && CASES[index].id != ID_ML) {
            index++;
        }

        if (index >= (int)CASE_COUNT) {
            KillTimer(hwnd, STEP_TIMER);
            PostQuitMessage(0);
            return 0;
        }

        SetWindowText(plainEdit, "ab");
        SetFocus(plainEdit);
        SendMessage(plainEdit, EM_SETSEL, 0, MAKELONG(1, 1));
        clear();
        press(&CASES[index]);
        phase = 1;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
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

static void string(LPCSTR text)
{
    while (*text) {
        byte(*text++);
    }

    byte(0);
}

static void item(int x, int y, int cx, int cy, int id, DWORD style, BYTE kind, LPCSTR text)
{
    word(x);
    word(y);
    word(cx);
    word(cy);
    word(id);
    word(LOWORD(style | WS_CHILD | WS_VISIBLE));
    word(HIWORD(style | WS_CHILD | WS_VISIBLE));
    byte(kind);
    string(text);
    byte(0);
}

static void build(void)
{
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT | WS_VISIBLE;

    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(7);
    word(10);
    word(10);
    word(160);
    word(90);
    byte(0);
    byte(0);
    string("Edit Keys");
    word(8);
    string("Helv");
    item(6, 6, 40, 30, ID_ML, ES_MULTILINE | WS_BORDER | WS_TABSTOP | WS_GROUP, 0x81, "");
    item(56, 6, 40, 30, ID_RETURN, ES_MULTILINE | ES_WANTRETURN | WS_BORDER | WS_TABSTOP, 0x81,
         "");
    item(106, 6, 40, 12, ID_SL, ES_AUTOHSCROLL | WS_BORDER | WS_TABSTOP, 0x81, "");
    item(0, 0, 1, 1, ID_LIST, LBS_NOTIFY | WS_TABSTOP, 0x83, "");
    item(0, 0, 1, 1, ID_LOOSE, LBS_NOTIFY | LBS_NOINTEGRALHEIGHT, 0x83, "");
    item(30, 70, 40, 14, IDOK, BS_DEFPUSHBUTTON | WS_GROUP | WS_TABSTOP, 0x80, "OK");
    item(90, 70, 40, 14, IDCANCEL, BS_PUSHBUTTON | WS_TABSTOP, 0x80, "Cancel");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL memory;
    WNDCLASS windowClass;
    MSG message;
    int answer;

    probeOpen(OUTPUT);
    clear();

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    probe("entry", "", keybdEvent ? "found" : "missing");

    if (!keybdEvent) {
        probeFinish();
        return 0;
    }

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 512);
    template = (BYTE FAR *)GlobalLock(memory);
    build();
    GlobalUnlock(memory);
    answer = DialogBoxIndirect(instance, memory, NULL,
                               (DLGPROC)MakeProcInstance((FARPROC)DialogProc, instance));
    wsprintf(probeResult, "%d", answer);
    probe("dialog", "", probeResult);
    GlobalFree(memory);

    windowClass.style = 0;
    windowClass.lpfnWndProc = PlainProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "MlDlg";
    RegisterClass(&windowClass);
    plain = CreateWindow("MlDlg", "Plain", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
                         NULL, NULL, instance, NULL);
    plainEdit = CreateWindow("EDIT", "", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_MULTILINE, 10, 10,
                             120, 40, plain, (HMENU)ID_ML, instance, NULL);
    index = 0;
    phase = 0;
    clear();
    SetTimer(plain, STEP_TIMER, 500, NULL);

    while (GetMessage(&message, NULL, 0, 0)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    DestroyWindow(plain);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
