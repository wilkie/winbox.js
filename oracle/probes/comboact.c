/*
 * A combo box's list dropped down and pressed: what window it is, and
 * whether a press on it, or on any window while another has the mouse,
 * makes a window active.
 *
 * `H` is an overlapped window at (40, 40), 300 by 200, with `A` in it, a
 * `CBS_DROPDOWNLIST` combo box at (10, 10), 120 by 100, holding `one` to
 * `six`. `Q` is another overlapped window at (360, 40), 200 by 150. A's list
 * is found among the desktop window's children by its class, `ComboLBox`,
 * and subclassed to see its messages.
 *
 * Records:
 *
 * * `list`: where the list was found -- whether it is a child of A, or of
 *   the desktop -- its parent and owner as `desktop`, `A`, `H` or `0`, its
 *   style and extended style in hexadecimal, and whether it is visible.
 * * For each case, `log`: the messages each window procedure was handed,
 *   in order, as the window (`H`, `Q`, `L` for the list) and the message
 *   in hexadecimal, of those listed in `LOGGED`; `WM_MOUSEACTIVATE` with its
 *   hit-test code and mouse message, and what the procedure answered, after
 *   `=`; `WM_WINDOWPOSCHANGING` with its flags; `WM_COMMAND` with its
 *   notification code. H and Q's `WM_MOUSEACTIVATE` and `WM_PARENTNOTIFY`,
 *   which a press on A brings H, are left out: the probe asks what a press
 *   on the list does, and the list is sent everything listed.
 * * For each case, `state`: which window is active and which has the focus
 *   and the mouse's capture (`H`, `Q`, `A`, `L`, `0`, or `?` for another),
 *   whether the list is dropped down and visible, its selection, and,
 *   while the list shows, the window first among the desktop's children
 *   (`-` while it does not: where a hidden window lies is not asked here).
 *
 * The cases, a second apart:
 *
 * * `drop`: H active and A focused, A's button pressed and let go.
 * * `press`: the list's third row pressed and let go.
 * * `shown`: Q active, A's list dropped down with `CB_SHOWDROPDOWN`.
 * * `inactive`: the list's second row pressed and let go, Q still active.
 * * `capture`: Q active, H given the mouse with `SetCapture`, and Q's client
 *   area pressed and let go; then the mouse released.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\COMBOACT.OUT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

#define SF_ABSOLUTE 0x8000
#define MOVE 0x0001
#define LEFTDOWN 0x0002
#define LEFTUP 0x0004

static const UINT LOGGED[] = {
    WM_MOUSEACTIVATE, WM_ACTIVATE,      WM_NCACTIVATE,        WM_SETFOCUS,   WM_KILLFOCUS,
    WM_LBUTTONDOWN,   WM_LBUTTONUP,     WM_WINDOWPOSCHANGING, WM_SHOWWINDOW, WM_PARENTNOTIFY,
    WM_COMMAND,       WM_ACTIVATEAPP,
};

static FARPROC mouseEvent;
static FARPROC listProc;
static HWND host;
static HWND other;
static HWND combo;
static HWND list;
static char log[768];
static LPSTR logAt;

static BOOL logged(UINT message)
{
    int index;

    for (index = 0; index < (int)(sizeof(LOGGED) / sizeof(LOGGED[0])); index++) {
        if (LOGGED[index] == message) {
            return TRUE;
        }
    }

    return FALSE;
}

static void note(LPCSTR who, UINT message, WPARAM wParam, LPARAM lParam)
{
    char extra[40];

    if (logAt - log >= (int)sizeof(log) - 40) {
        return;
    }

    extra[0] = '\0';

    if (message == WM_MOUSEACTIVATE) {
        wsprintf(extra, ":%x:%x", LOWORD(lParam), HIWORD(lParam));
    } else if (message == WM_WINDOWPOSCHANGING) {
        wsprintf(extra, ":%x", ((WINDOWPOS FAR *)lParam)->flags);
    } else if (message == WM_COMMAND) {
        wsprintf(extra, ":%x", HIWORD(lParam));
    }

    logAt += wsprintf(logAt, "%s%s%x%s", (LPSTR)(logAt == log ? "" : " "), who, message,
                      (LPSTR)extra);
}

static void answered(LONG result)
{
    if (logAt - log < (int)sizeof(log) - 12) {
        logAt += wsprintf(logAt, "=%ld", result);
    }
}

static LONG reply(LPCSTR who, HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    LONG result;
    BOOL mine = logged(message) && message != WM_MOUSEACTIVATE && message != WM_PARENTNOTIFY;

    if (mine) {
        note(who, message, wParam, lParam);
    }

    result = DefWindowProc(hwnd, message, wParam, lParam);

    if (mine && message == WM_MOUSEACTIVATE) {
        answered(result);
    }

    return result;
}

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return reply("H", hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export OtherProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return reply("Q", hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export ListSpy(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    LONG result;
    BOOL mine = logged(message);

    if (mine) {
        note("L", message, wParam, lParam);
    }

    result = CallWindowProc(listProc, hwnd, message, wParam, lParam);

    if (mine && message == WM_MOUSEACTIVATE) {
        answered(result);
    }

    return result;
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

static void click(int x, int y)
{
    mouse(SF_ABSOLUTE | MOVE, across(x), down(y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(x), down(y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(x), down(y));
}

/* Messages dispatched for a while: a second, at least. A timer of H's ends
 * it, taken and not dispatched. */
static void settle(void)
{
    MSG message;

    SetTimer(host, 99, 1000, NULL);

    while (GetMessage(&message, NULL, 0, 0)) {
        if (message.message == WM_TIMER && message.hwnd == host && message.wParam == 99) {
            break;
        }

        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    KillTimer(host, 99);
}

static void begin(void)
{
    logAt = log;
    *logAt = '\0';
}

static LPCSTR named(HWND hwnd)
{
    if (!hwnd) {
        return "0";
    }

    if (hwnd == host) {
        return "H";
    }

    if (hwnd == other) {
        return "Q";
    }

    if (hwnd == combo) {
        return "A";
    }

    if (list && hwnd == list) {
        return "L";
    }

    if (hwnd == GetDesktopWindow()) {
        return "desktop";
    }

    return "?";
}

static void finish(LPCSTR name)
{
    settle();
    probe("log", name, log);

    wsprintf(probeResult, "active=%s,focus=%s,capture=%s,dropped=%ld,visible=%d,sel=%ld,first=%s",
             named(GetActiveWindow()), named(GetFocus()), named(GetCapture()),
             SendMessage(combo, CB_GETDROPPEDSTATE, 0, 0), IsWindowVisible(list) ? 1 : 0,
             SendMessage(combo, CB_GETCURSEL, 0, 0),
             IsWindowVisible(list) ? named(GetWindow(GetDesktopWindow(), GW_CHILD)) : "-");
    probe("state", name, probeResult);
}

/* The list: among A's children, or the desktop's. */
static void find(void)
{
    HWND child;
    char kind[16];
    LPCSTR where = "none";

    for (child = GetWindow(combo, GW_CHILD); child && !list; child = GetWindow(child, GW_HWNDNEXT)) {
        GetClassName(child, kind, sizeof(kind));

        if (!lstrcmpi(kind, "ComboLBox")) {
            list = child;
            where = "combo";
        }
    }

    for (child = GetWindow(GetDesktopWindow(), GW_CHILD); child && !list;
         child = GetWindow(child, GW_HWNDNEXT)) {
        GetClassName(child, kind, sizeof(kind));

        if (!lstrcmpi(kind, "ComboLBox")) {
            list = child;
            where = "desktop";
        }
    }

    if (!list) {
        probe("list", "found", where);
        return;
    }

    wsprintf(probeResult, "%s,parent=%s,owner=%s,style=%lx,exstyle=%lx,visible=%d", where,
             named(GetParent(list)), named(GetWindow(list, GW_OWNER)),
             GetWindowLong(list, GWL_STYLE), GetWindowLong(list, GWL_EXSTYLE),
             IsWindowVisible(list) ? 1 : 0);
    probe("list", "found", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static LPCSTR ROWS[] = {"one", "two", "three", "four", "five", "six"};
    WNDCLASS kind;
    RECT r;
    int index;

    probeOpen(OUTPUT);
    begin();
    ShowCursor(FALSE);

    kind.style = 0;
    kind.lpfnWndProc = HostProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ComboActH";
    RegisterClass(&kind);

    kind.lpfnWndProc = OtherProc;
    kind.lpszClassName = "ComboActQ";
    RegisterClass(&kind);

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (!mouseEvent) {
        probeFinish();
        return 0;
    }

    other = CreateWindow("ComboActQ", "Q", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 360, 40, 200, 150,
                         NULL, NULL, instance, NULL);
    host = CreateWindow("ComboActH", "H", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 300, 200,
                        NULL, NULL, instance, NULL);
    combo = CreateWindow("COMBOBOX", "", WS_CHILD | WS_VISIBLE | WS_VSCROLL | CBS_DROPDOWNLIST, 10,
                         10, 120, 100, host, (HMENU)1, instance, NULL);

    for (index = 0; index < 6; index++) {
        SendMessage(combo, CB_ADDSTRING, 0, (LPARAM)ROWS[index]);
    }

    SendMessage(combo, CB_SETCURSEL, 0, 0);
    find();

    if (!list) {
        probeFinish();
        return 0;
    }

    listProc = (FARPROC)SetWindowLong(list, GWL_WNDPROC, (LONG)(WNDPROC)ListSpy);

    SetActiveWindow(host);
    SetFocus(combo);
    settle();

    begin();
    GetWindowRect(combo, &r);
    click(r.right - 6, (r.top + r.bottom) / 2);
    finish("drop");

    begin();
    GetWindowRect(list, &r);
    click((r.left + r.right) / 2, r.top + 1 + GetSystemMetrics(SM_CYMENU) * 5 / 2 - 4);
    finish("press");

    SetActiveWindow(other);
    settle();
    begin();
    SendMessage(combo, CB_SHOWDROPDOWN, TRUE, 0);
    finish("shown");

    begin();
    GetWindowRect(list, &r);
    click((r.left + r.right) / 2, r.top + 1 + GetSystemMetrics(SM_CYMENU) * 3 / 2 - 4);
    finish("inactive");

    SendMessage(combo, CB_SHOWDROPDOWN, FALSE, 0);
    SetActiveWindow(other);
    settle();
    begin();
    SetCapture(host);
    GetWindowRect(other, &r);
    click((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    settle();
    ReleaseCapture();
    finish("capture");

    DestroyWindow(other);
    DestroyWindow(host);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
