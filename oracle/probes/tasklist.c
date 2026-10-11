/*
 * Control and Escape, and the Task List: USER's system queue takes the key
 * for itself, `DefWindowProc` starts TASKMAN.EXE for `SC_TASKLIST`, and the
 * Task List switches to a window, ends a task, cascades, tiles and arranges
 * the icons.
 *
 * `T`, "Probe T", is an overlapped window at (40, 40), 300 by 200; `W`,
 * "Probe W", one at (360, 60), 240 by 160, shown first, so `T` is active.
 * Each window procedure writes the keys' messages it is handed and
 * `WM_SYSCOMMAND` with its `wParam` and `lParam`, and `W`'s `WM_CLOSE`,
 * which it does not pass on. Until `taskman`, `SC_TASKLIST` is not passed to
 * `DefWindowProc` either. Keys go in through USER's own `KEYBD_EVENT`, as the
 * keyboard driver puts them in, before any is taken.
 *
 * * `desktop`: whether the desktop window is the probe's task's, and its
 *   class's style.
 * * `ctrlesc`: Control pressed, Escape pressed and let go, Control let go;
 *   then everything taken and dispatched.
 * * `peek`: Control pressed and taken; Escape pressed; what `PeekMessage`
 *   with `PM_NOREMOVE` finds (`peek:`); Escape and Control let go, and
 *   everything taken.
 * * `taskman`: `SC_TASKLIST` passed to `DefWindowProc` from here on. Control
 *   and Escape again; the Task List waited for: whether it is active, where
 *   it is, the strings of its list (`|` between) and the one selected. Then
 *   its Cancel, and the window active after it has gone.
 * * `dblclk`: `W` minimized; the desktop window -- this task's, as the
 *   first program's -- sent `WM_LBUTTONDBLCLK` at (100, 100); the Task List's place; then `W`
 *   selected and Switch To, and after the Task List has gone, the window
 *   active and whether `W` is still an icon.
 * * `endtask`: `T` made active; Control and Escape; `W` selected, End Task;
 *   what the windows were handed, and the window active.
 * * `cascade`, `tile`: the Task List's Cascade and Tile, and where `T` and
 *   `W` are after.
 * * `arrange`: `W` minimized and its icon moved to (300, 300); the Task
 *   List's Arrange Icons, and where the icon is after.
 * * `mouse`: the left button pressed and let go twice over the desktop, at
 *   (630, 10), through USER's own `MOUSE_EVENT`; whether a Task List came,
 *   and where. Then its Cancel.
 *
 * A window's place is written left, top, right, bottom.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TASKLIST.OUT"

static HINSTANCE module;
static HWND top;
static HWND other;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static BOOL passOn;
static char events[600];

static WORD keyAX;
static WORD keyBX;
static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static LPCSTR whose(HWND hwnd)
{
    static char handle[8];

    if (hwnd == NULL) {
        return "none";
    }

    if (hwnd == top) {
        return "T";
    }

    if (hwnd == other) {
        return "W";
    }

    if (hwnd == FindWindow(NULL, "Task List")) {
        return "L";
    }

    wsprintf(handle, "%04x", hwnd);
    return handle;
}

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

static void note(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];

    if (message >= WM_KEYDOWN && message <= WM_SYSCHAR) {
        wsprintf(one, "%s%x:%x", whose(hwnd), message, wParam);
    } else if (message == WM_SYSCOMMAND) {
        wsprintf(one, "%s112:%x:%lx", whose(hwnd), wParam, lParam);
    } else if (message == WM_CLOSE) {
        wsprintf(one, "%s10", whose(hwnd));
    } else {
        return;
    }

    add(one);
}

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam, lParam);

    if (message == WM_SYSCOMMAND && (wParam & 0xfff0) == SC_TASKLIST && !passOn) {
        return 0;
    }

    if (message == WM_CLOSE && hwnd == other) {
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* One key, as the keyboard driver hands it to USER: AL the virtual key, AH
 * 80h for a release, BL the scan code. */
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

/* Everything waiting taken, translated and dispatched. */
static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 80 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

/* The Task List, once it is there and shown, or gone, as asked: the
 * messages taken meanwhile and other programs let run. */
static HWND waitList(BOOL shown)
{
    HWND list = NULL;
    int i;

    for (i = 0; i < 400; i++) {
        pump();
        list = FindWindow(NULL, "Task List");

        if (shown ? (list && IsWindowVisible(list)) : list == NULL) {
            break;
        }

        Yield();
    }

    pump();
    return list;
}

static void place(LPSTR out, HWND hwnd)
{
    RECT rect;

    if (!IsWindow(hwnd)) {
        lstrcpy(out, "none");
        return;
    }

    GetWindowRect(hwnd, &rect);
    wsprintf(out, "%d,%d,%d,%d", rect.left, rect.top, rect.right, rect.bottom);
}

#define VK_K 0x4b

static void controlEscape(void)
{
    key(VK_CONTROL, 0x1d, FALSE);
    key(VK_ESCAPE, 0x01, FALSE);
    key(VK_ESCAPE, 0x01, TRUE);
    key(VK_CONTROL, 0x1d, TRUE);
}

/* The Task List's list: its strings, `|` between, and the one selected. */
static void listed(LPCSTR name, HWND list)
{
    HWND box = GetDlgItem(list, 100);
    char text[80];
    int count;
    int i;

    probeResult[0] = '\0';
    count = (int)SendMessage(box, LB_GETCOUNT, 0, 0L);

    for (i = 0; i < count; i++) {
        SendMessage(box, LB_GETTEXT, i, (LPARAM)(LPSTR)text);

        if (i) {
            lstrcat(probeResult, "|");
        }

        lstrcat(probeResult, text);
    }

    probe("list", name, probeResult);
    wsprintf(probeResult, "%d", (int)SendMessage(box, LB_GETCURSEL, 0, 0L));
    probe("selected", name, probeResult);
}

/* The Task List's entry for a window selected. */
static void choose(HWND list, HWND hwnd)
{
    HWND box = GetDlgItem(list, 100);
    int count = (int)SendMessage(box, LB_GETCOUNT, 0, 0L);
    int i;

    for (i = 0; i < count; i++) {
        if ((HWND)LOWORD(SendMessage(box, LB_GETITEMDATA, i, 0L)) == hwnd) {
            SendMessage(box, LB_SETCURSEL, i, 0L);
        }
    }
}

/* The Task List opened with Control and Escape, one of its buttons pressed,
 * and waited for to go. */
static HWND pressed(LPCSTR name, WORD id, HWND select)
{
    HWND list;
    char text[40];

    events[0] = '\0';
    controlEscape();
    list = waitList(TRUE);

    if (!list) {
        probe("found", name, "none");
        return NULL;
    }

    if (select) {
        choose(list, select);
    }

    SendMessage(list, WM_COMMAND, id, 0L);
    list = waitList(FALSE);
    probe("gone", name, list ? "no" : "yes");
    pump();
    wsprintf(text, "%s", whose(GetActiveWindow()));
    probe("active", name, text);
    return list;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG message;
    HWND list;
    HWND desk;
    char text[80];
    int i;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = TopProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "TaskTop";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");

    if (!keybdEvent || !mouseEvent) {
        probe("entry", "KEYBD_EVENT", "missing");
        probeFinish();
        return 0;
    }

    desk = GetDesktopWindow();
    wsprintf(text, "%s,%x", (LPSTR)(GetWindowTask(desk) == GetCurrentTask() ? "own" : "other"),
             GetClassWord(desk, GCW_STYLE));
    probe("desktop", "task,style", text);

    other = CreateWindow("TaskTop", "Probe W", WS_OVERLAPPEDWINDOW, 360, 60, 240, 160, NULL,
                         NULL, module, NULL);
    top = CreateWindow("TaskTop", "Probe T", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL,
                       module, NULL);
    ShowWindow(other, SW_SHOWNORMAL);
    UpdateWindow(other);
    ShowWindow(top, SW_SHOWNORMAL);
    UpdateWindow(top);
    pump();

    /* ctrlesc */
    events[0] = '\0';
    controlEscape();
    pump();
    add(whose(GetActiveWindow()));
    probe("keys", "ctrlesc", events);

    /* peek */
    events[0] = '\0';
    key(VK_CONTROL, 0x1d, FALSE);
    pump();
    key(VK_ESCAPE, 0x01, FALSE);

    if (PeekMessage(&message, NULL, 0, 0, PM_NOREMOVE)) {
        wsprintf(text, "peek:%s%x:%x", whose(message.hwnd), message.message, message.wParam);
    } else {
        lstrcpy(text, "peek:none");
    }

    add(text);
    key(VK_ESCAPE, 0x01, TRUE);
    key(VK_CONTROL, 0x1d, TRUE);
    pump();
    probe("keys", "peek", events);

    /* taskman */
    passOn = TRUE;
    events[0] = '\0';
    controlEscape();
    list = waitList(TRUE);
    probe("keys", "taskman", events);

    if (list) {
        probe("active", "taskman", whose(GetActiveWindow()));
        place(text, list);
        probe("place", "taskman", text);
        GetWindowText(list, text, sizeof(text));
        probe("title", "taskman", text);
        probe("task", "taskman",
              (LPSTR)(GetWindowTask(list) == GetCurrentTask() ? "own" : "other"));
        listed("taskman", list);
        SendMessage(list, WM_COMMAND, IDCANCEL, 0L);
        list = waitList(FALSE);
        probe("gone", "taskman", list ? "no" : "yes");
        pump();
        probe("active", "taskman after", whose(GetActiveWindow()));
    } else {
        probe("found", "taskman", "none");
    }

    /* dblclk */
    ShowWindow(other, SW_MINIMIZE);
    SetActiveWindow(top);
    pump();
    events[0] = '\0';
    SendMessage(desk, WM_LBUTTONDBLCLK, 0, MAKELONG(100, 100));
    list = waitList(TRUE);

    if (list) {
        place(text, list);
        probe("place", "dblclk", text);
        listed("dblclk", list);
        choose(list, other);
        SendMessage(list, WM_COMMAND, IDOK, 0L);
        list = waitList(FALSE);
        probe("gone", "dblclk", list ? "no" : "yes");
        pump();
        wsprintf(text, "%s,%s", whose(GetActiveWindow()),
                 (LPSTR)(IsIconic(other) ? "icon" : "open"));
        probe("active", "dblclk", text);
        probe("keys", "dblclk", events);
    } else {
        probe("found", "dblclk", "none");
    }

    /* endtask */
    SetActiveWindow(top);
    pump();
    pressed("endtask", 101, other);
    probe("keys", "endtask", events);

    /* cascade, tile */
    SetActiveWindow(top);
    pump();
    pressed("cascade", 102, NULL);
    place(text, top);
    probe("place", "cascade T", text);
    place(text, other);
    probe("place", "cascade W", text);

    SetActiveWindow(top);
    pump();
    pressed("tile", 103, NULL);
    place(text, top);
    probe("place", "tile T", text);
    place(text, other);
    probe("place", "tile W", text);

    /* arrange */
    ShowWindow(other, SW_MINIMIZE);
    SetWindowPos(other, NULL, 300, 300, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    SetActiveWindow(top);
    pump();
    place(text, other);
    probe("place", "arrange before", text);
    pressed("arrange", 104, NULL);
    place(text, other);
    probe("place", "arrange W", text);

    /* mouse */
    ShowWindow(other, SW_RESTORE);
    MoveWindow(top, 40, 40, 300, 200, TRUE);
    MoveWindow(other, 360, 60, 240, 160, TRUE);
    SetActiveWindow(top);
    pump();
    events[0] = '\0';

    for (i = 0; i < 2; i++) {
        mouse(0x8001, across(630), down(10));
        mouse(0x8002, across(630), down(10));
        mouse(0x8004, across(630), down(10));
    }

    list = waitList(TRUE);

    if (list) {
        place(text, list);
        probe("place", "mouse", text);
        SendMessage(list, WM_COMMAND, IDCANCEL, 0L);
        waitList(FALSE);
    } else {
        probe("found", "mouse", "none");
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
