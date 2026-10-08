/*
 * Escape and Enter pressed while a combo box's list is dropped down in a
 * dialog: whether the combo box keeps them and only puts its list away, or
 * the dialog manager takes them as `IDCANCEL` and the default button.
 *
 * A dialog run with `DialogBoxIndirect`, from a template built in memory,
 * holds a drop-down list (101) and a drop-down (102), three items each, and
 * OK (the default) and Cancel. Its procedure writes down every
 * `WM_COMMAND` and does not end the dialog for one, so each case is taken in
 * the same dialog. A timer's tick each half second takes the next step,
 * and the keys and the mouse go in through USER's own `KEYBD_EVENT` and
 * `MOUSE_EVENT`, as the drivers put them, so the dialog's own loop and
 * `IsDialogMessage` take them:
 *
 * * Each case starts with both lists put away (`CB_SHOWDROPDOWN`), both
 *   first items chosen and the case's combo box given the focus.
 * * It is dropped with F4, with Alt and Down (`altdown`), or by a press of
 *   its button (`click`), and Down then moves its selection; or it is left
 *   as it is (`none`).
 * * `before`: the `WM_COMMAND`s so far, each its identifier and
 *   notification in hexadecimal; whether each list is dropped
 *   (`CB_GETDROPPEDSTATE`); the selection; the focus's identifier, with the
 *   combo box's edit control's own (1001) written `e`; and what the focus
 *   answers `WM_GETDLGCODE` with an Escape's `WM_KEYDOWN` for its message.
 * * Escape, Enter or F4 is then pressed, and `after` writes the same, and
 *   whether the dialog is still shown.
 *
 * Then `GetOpenFileName`, with a hook, as Notepad's and Media Player's File
 * Open use it: the drives' combo box (`cmb2`) given the focus and dropped
 * by a press of its button, F4 or Alt and Down, then Escape or Enter
 * pressed. `before` and `after` as above, the hook writing down the
 * commands for `IDOK`, `IDCANCEL` and the drives; where the dialog is still
 * up afterwards, Cancel is posted. `open` writes what `GetOpenFileName`
 * answered and how many of the hook's steps ran: three where the dialog
 * outlived the key, two where the key ended it.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>

#define OUTPUT "C:\\ORACLE\\COMBOESC.OUT"

#define ID_LIST 101
#define ID_DROP 102
#define STEP_TIMER 77
#define SF_ABSOLUTE 0x8000
#define MOUSE_MOVE 0x0001
#define MOUSE_LEFTDOWN 0x0002
#define MOUSE_LEFTUP 0x0004

typedef BOOL(FAR PASCAL *OPENPROC)(OPENFILENAME FAR *);

enum { NONE, F4, ALTDOWN, CLICK };
enum { ESCAPE, ENTER, AGAIN };

static const char *DROPS[] = {"none", "f4", "altdown", "click"};
static const char *KEYS[] = {"escape", "enter", "f4"};

typedef struct {
    int id;
    int drop;
    int key;
} CASE;

static const CASE CASES[] = {
    {ID_LIST, NONE, ESCAPE},  {ID_LIST, NONE, ENTER},     {ID_LIST, F4, ESCAPE},
    {ID_LIST, F4, ENTER},     {ID_LIST, F4, AGAIN},       {ID_LIST, ALTDOWN, ESCAPE},
    {ID_LIST, ALTDOWN, ENTER}, {ID_LIST, ALTDOWN, AGAIN}, {ID_LIST, CLICK, ESCAPE},
    {ID_LIST, CLICK, ENTER},  {ID_LIST, CLICK, AGAIN},    {ID_DROP, NONE, ESCAPE},
    {ID_DROP, NONE, ENTER},   {ID_DROP, F4, ESCAPE},      {ID_DROP, F4, ENTER},
    {ID_DROP, F4, AGAIN},     {ID_DROP, ALTDOWN, ESCAPE}, {ID_DROP, ALTDOWN, ENTER},
    {ID_DROP, ALTDOWN, AGAIN}, {ID_DROP, CLICK, ESCAPE},  {ID_DROP, CLICK, ENTER},
    {ID_DROP, CLICK, AGAIN},
};

#define CASE_COUNT (sizeof(CASES) / sizeof(CASES[0]))

static const CASE OPENS[] = {
    {cmb2, CLICK, ESCAPE}, {cmb2, F4, ESCAPE}, {cmb2, ALTDOWN, ESCAPE}, {cmb2, F4, ENTER},
};

#define OPEN_COUNT (sizeof(OPENS) / sizeof(OPENS[0]))

static FARPROC keybdEvent;
static FARPROC mouseEvent;
static BYTE FAR *template;
static int at;
static char log[512];
static LPSTR logAt;
static const CASE *current;
static int index;
static int phase;
static int steps;

static void note(WPARAM id, WORD code)
{
    if (logAt - log >= (int)sizeof(log) - 16) {
        return;
    }

    logAt += wsprintf(logAt, "%s%x:%x", (LPSTR)(logAt == log ? "" : " "), id, code);
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

static void press(BYTE vk, BYTE scan)
{
    key(vk, scan, FALSE);
    key(vk, scan, TRUE);
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

/* A point of the screen as MOUSE_EVENT's absolute coordinates, 0 to 65535. */
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

/* A combo box's button pressed and let go. */
static void clickButton(HWND combo)
{
    RECT r;
    int x;
    int y;

    GetWindowRect(combo, &r);
    x = r.right - 8;
    y = (r.top + r.bottom) / 2;
    mouse(SF_ABSOLUTE | MOUSE_MOVE, across(x), down(y));
    mouse(SF_ABSOLUTE | MOUSE_MOVE | MOUSE_LEFTDOWN, across(x), down(y));
    mouse(SF_ABSOLUTE | MOUSE_MOVE | MOUSE_LEFTUP, across(x), down(y));
}

/* The list dropped as the case says. */
static void drop(HWND combo, int how)
{
    switch (how) {
    case F4:
        press(VK_F4, 0x3e);
        break;
    case ALTDOWN:
        key(VK_MENU, 0x38, FALSE);
        press(VK_DOWN, 0x50);
        key(VK_MENU, 0x38, TRUE);
        break;
    case CLICK:
        clickButton(combo);
        break;
    }
}

static void finalKey(int which)
{
    switch (which) {
    case ESCAPE:
        press(VK_ESCAPE, 0x01);
        break;
    case ENTER:
        press(VK_RETURN, 0x1c);
        break;
    case AGAIN:
        press(VK_F4, 0x3e);
        break;
    }
}

/* The focus's identifier, `e` for a combo box's edit control. */
static void focusName(LPSTR out)
{
    HWND focus = GetFocus();

    if (focus == NULL) {
        lstrcpy(out, "none");
    } else if (GetDlgCtrlID(focus) == 1001) {
        lstrcpy(out, "e");
    } else {
        wsprintf(out, "%x", GetDlgCtrlID(focus));
    }
}

/* What the focus answers WM_GETDLGCODE for an Escape's WM_KEYDOWN. */
static UINT escapeCode(void)
{
    MSG message;
    HWND focus = GetFocus();

    if (focus == NULL) {
        return 0;
    }

    message.hwnd = focus;
    message.message = WM_KEYDOWN;
    message.wParam = VK_ESCAPE;
    message.lParam = 0x00010001L;
    message.time = 0;
    message.pt.x = 0;
    message.pt.y = 0;
    return (UINT)SendMessage(focus, WM_GETDLGCODE, VK_ESCAPE, (LPARAM)(MSG FAR *)&message);
}

static void state(HWND dialog, LPCSTR function, BOOL both)
{
    char focus[8];
    char args[32];
    int id = current->id;

    focusName(focus);
    wsprintf(args, "%s,%s,%s", (LPSTR)(id == ID_LIST ? "list" : id == ID_DROP ? "drop" : "drives"),
             (LPSTR)DROPS[current->drop], (LPSTR)KEYS[current->key]);

    if (both) {
        wsprintf(probeResult, "log=%s,dropped=%d/%d,sel=%d,focus=%s,code=%x,up=%d", (LPSTR)log,
                 (int)SendDlgItemMessage(dialog, ID_LIST, CB_GETDROPPEDSTATE, 0, 0L),
                 (int)SendDlgItemMessage(dialog, ID_DROP, CB_GETDROPPEDSTATE, 0, 0L),
                 (int)SendDlgItemMessage(dialog, id, CB_GETCURSEL, 0, 0L), (LPSTR)focus,
                 escapeCode(), IsWindowVisible(dialog) ? 1 : 0);
    } else {
        wsprintf(probeResult, "log=%s,dropped=%d,focus=%s,code=%x,up=%d", (LPSTR)log,
                 (int)SendDlgItemMessage(dialog, id, CB_GETDROPPEDSTATE, 0, 0L), (LPSTR)focus,
                 escapeCode(), IsWindowVisible(dialog) ? 1 : 0);
    }

    probe(function, args, probeResult);
    clear();
}

/* The next step of the dialog's cases. */
static void step(HWND dialog)
{
    HWND combo;

    if (phase == 1) {
        state(dialog, "before", TRUE);
        finalKey(current->key);
        phase = 2;
        return;
    }

    if (phase == 2) {
        state(dialog, "after", TRUE);
        index++;
    }

    if (index >= (int)CASE_COUNT) {
        KillTimer(dialog, STEP_TIMER);
        EndDialog(dialog, 7);
        return;
    }

    current = &CASES[index];
    combo = GetDlgItem(dialog, current->id);
    SendDlgItemMessage(dialog, ID_LIST, CB_SHOWDROPDOWN, FALSE, 0L);
    SendDlgItemMessage(dialog, ID_DROP, CB_SHOWDROPDOWN, FALSE, 0L);
    SendDlgItemMessage(dialog, ID_LIST, CB_SETCURSEL, 0, 0L);
    SendDlgItemMessage(dialog, ID_DROP, CB_SETCURSEL, 0, 0L);
    SetFocus(combo);
    clear();
    drop(combo, current->drop);

    if (current->drop != NONE) {
        press(VK_DOWN, 0x50);
    }

    phase = 1;
}

BOOL FAR PASCAL _export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    static const char *ITEMS[] = {"one", "two", "three"};
    int i;

    switch (message) {
    case WM_INITDIALOG:
        for (i = 0; i < 3; i++) {
            SendDlgItemMessage(dialog, ID_LIST, CB_ADDSTRING, 0, (LPARAM)(LPSTR)ITEMS[i]);
            SendDlgItemMessage(dialog, ID_DROP, CB_ADDSTRING, 0, (LPARAM)(LPSTR)ITEMS[i]);
        }

        SetTimer(dialog, STEP_TIMER, 500, NULL);
        return TRUE;
    case WM_COMMAND:
        note(wParam, HIWORD(lParam));
        return TRUE;
    case WM_TIMER:
        if (wParam == STEP_TIMER) {
            step(dialog);
        }

        return TRUE;
    }

    return FALSE;
}

/* The Open dialog's hook: each tick, the next step of its one case. */
UINT FAR PASCAL _export Hook(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    HWND drives;

    switch (message) {
    case WM_INITDIALOG:
        SetTimer(dialog, STEP_TIMER, 500, NULL);
        return TRUE;
    case WM_COMMAND:
        if (wParam == IDOK || wParam == IDCANCEL || wParam == cmb2) {
            note(wParam, HIWORD(lParam));
        }

        return FALSE;
    case WM_TIMER:
        if (wParam != STEP_TIMER) {
            return FALSE;
        }

        steps++;
        drives = GetDlgItem(dialog, cmb2);

        if (steps == 1) {
            SetFocus(drives);
            clear();
            drop(drives, current->drop);
        } else if (steps == 2) {
            state(dialog, "before", FALSE);
            finalKey(current->key);
        } else {
            state(dialog, "after", FALSE);
            KillTimer(dialog, STEP_TIMER);
            PostMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
        }

        return TRUE;
    }

    return FALSE;
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
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | WS_VISIBLE;

    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(4);
    word(10);
    word(10);
    word(160);
    word(90);
    byte(0);
    byte(0);
    string("Combo Keys");
    item(6, 6, 64, 60, ID_LIST, CBS_DROPDOWNLIST | WS_VSCROLL | WS_TABSTOP, 0x85, "");
    item(86, 6, 64, 60, ID_DROP, CBS_DROPDOWN | WS_VSCROLL | WS_TABSTOP, 0x85, "");
    item(30, 70, 40, 14, IDOK, BS_DEFPUSHBUTTON | WS_GROUP | WS_TABSTOP, 0x80, "OK");
    item(90, 70, 40, 14, IDCANCEL, BS_PUSHBUTTON | WS_TABSTOP, 0x80, "Cancel");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL memory;
    HINSTANCE library;
    OPENPROC open;
    OPENFILENAME ofn;
    char file[260];
    int answer;

    probeOpen(OUTPUT);
    clear();

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    library = LoadLibrary("COMMDLG.DLL");
    open = library >= (HINSTANCE)32 ? (OPENPROC)GetProcAddress(library, "GetOpenFileName") : NULL;
    probe("entry", "", keybdEvent && mouseEvent && open ? "found" : "missing");

    if (!keybdEvent || !mouseEvent || !open) {
        probeFinish();
        return 0;
    }

    wsprintf(probeResult, "%d", GetKeyState(VK_NUMLOCK) & 1);
    probe("numlock", "", probeResult);

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 512);
    template = (BYTE FAR *)GlobalLock(memory);
    build();
    GlobalUnlock(memory);
    answer = DialogBoxIndirect(instance, memory, NULL,
                               (DLGPROC)MakeProcInstance((FARPROC)DialogProc, instance));
    wsprintf(probeResult, "%d", answer);
    probe("dialog", "", probeResult);
    GlobalFree(memory);

    for (index = 0; index < (int)OPEN_COUNT; index++) {
        char args[32];

        current = &OPENS[index];
        steps = 0;
        clear();
        file[0] = '\0';
        _fmemset(&ofn, 0, sizeof(ofn));
        ofn.lStructSize = sizeof(ofn);
        ofn.hInstance = instance;
        ofn.lpstrFilter = "Text Files (*.TXT)\0*.txt\0";
        ofn.nFilterIndex = 1;
        ofn.lpstrFile = file;
        ofn.nMaxFile = sizeof(file);
        ofn.lpstrInitialDir = "C:\\WINDOWS";
        ofn.Flags = OFN_ENABLEHOOK | OFN_HIDEREADONLY;
        ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))MakeProcInstance(
            (FARPROC)Hook, instance);

        answer = open(&ofn) ? 1 : 0;
        wsprintf(args, "drives,%s,%s", (LPSTR)DROPS[current->drop], (LPSTR)KEYS[current->key]);
        wsprintf(probeResult, "answer=%d,steps=%d,log=%s", answer, steps, (LPSTR)log);
        probe("open", args, probeResult);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
