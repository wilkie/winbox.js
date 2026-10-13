/*
 * The system message filters, `WH_SYSMSGFILTER`, beside the task's,
 * `WH_MSGFILTER`: USER's one caller of the filters (`USER.EXE` seg1 `80cd`)
 * calls the system's first, and the task's only where the system's answered
 * nought in AX; neither while a system-modal window is up (`80d8`). Its
 * callers: a dialog box's loop with `MSGF_DIALOGBOX` (seg25 `0c38`), a
 * menu's with `MSGF_MENU` (seg10 `0079`, `1ec9`), a scroll bar's with
 * `MSGF_SCROLLBAR` (seg18 `15d2`), Alt and Tab's with `MSGF_NEXTWINDOW`
 * (seg23 `0a58`), and `CallMsgFilter` (seg1 `a85b`).
 *
 * `S`, the system filter, is put in with `SetWindowsHookEx` for no task; `F`,
 * the task's, with `SetWindowsHookEx` for the probe's. Each notes its code
 * and the message, `S0:100`, but not the mouse's moves, nor `WM_SYSTIMER`,
 * nor `WM_PAINT`; and passes on with `CallNextHookEx`, unless the case has it
 * answer 1.
 *
 * * `task`: `SetWindowsHookEx` with `WH_SYSMSGFILTER` for the probe's task.
 * * `direct`, `syseat`, `taskeat`: `CallMsgFilter` with `WM_USER + 1` and
 *   code 77; `S` answering 1; `F` answering 1.
 * * `dialog`: a modal dialog box, closed by an Escape posted from a timer.
 * * `msgbox`: a message box, the same.
 * * `menu`: a pop-up menu, the same.
 * * `scroll`: the left button pressed and let go through `MOUSE_EVENT` on a
 *   scroll bar control's down arrow, then all that is waiting dispatched.
 * * `move`: `T` moved one step from the keyboard, the keys posted first.
 * * `sysmodal`: `CallMsgFilter` while `T` is the system-modal window.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYSFILT.OUT"

static HINSTANCE module;
static HWND top;
static HWND bar;
static HHOOK sysHook;
static HHOOK taskHook;
static BOOL sysEat;
static BOOL taskEat;
static BOOL logging;
static FARPROC mouseEvent;
static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;
static BYTE FAR *template;
static int at;
static char events[1200];

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

static void note(char which, int code, LPARAM lParam)
{
    char one[24];
    MSG FAR *message = (MSG FAR *)lParam;
    UINT number = message ? message->message : 0;

    if (!logging || number == WM_MOUSEMOVE || number == WM_NCMOUSEMOVE || number == 0x118 ||
        number == WM_PAINT) {
        return;
    }

    wsprintf(one, "%c%d:%x", which, code, number);
    add(one);
}

LRESULT FAR PASCAL _export SysFilter(int code, WPARAM wParam, LPARAM lParam)
{
    note('S', code, lParam);

    if (sysEat && code >= 0) {
        return 1;
    }

    return CallNextHookEx(sysHook, code, wParam, lParam);
}

LRESULT FAR PASCAL _export TaskFilter(int code, WPARAM wParam, LPARAM lParam)
{
    note('F', code, lParam);

    if (taskEat && code >= 0) {
        return 1;
    }

    return CallNextHookEx(taskHook, code, wParam, lParam);
}

BOOL FAR PASCAL _export DialogProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_INITDIALOG:
        SetTimer(hwnd, 1, 50, NULL);
        return TRUE;

    case WM_TIMER:
        KillTimer(hwnd, 1);
        PostMessage(GetFocus(), WM_KEYDOWN, VK_ESCAPE, 0x00010001L);
        return TRUE;

    case WM_COMMAND:
        if (wParam == IDCANCEL) {
            EndDialog(hwnd, 7);
        }

        return TRUE;
    }

    return FALSE;
}

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_TIMER && wParam == 2) {
        KillTimer(hwnd, 2);
        PostMessage(hwnd, WM_KEYDOWN, VK_ESCAPE, 0x00010001L);
        return 0;
    }

    if (message == WM_TIMER && wParam == 3) {
        /* The message box: its button has the focus. */
        KillTimer(hwnd, 3);
        PostMessage(GetFocus(), WM_KEYDOWN, VK_ESCAPE, 0x00010001L);
        return 0;
    }

    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
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

static void build(void)
{
    DWORD style = WS_POPUP | WS_CAPTION | DS_MODALFRAME;
    DWORD edit = ES_LEFT | WS_BORDER | WS_TABSTOP | WS_CHILD | WS_VISIBLE;

    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(1);
    word(10);
    word(10);
    word(120);
    word(50);
    byte(0);
    byte(0);
    string("Filtered");
    word(6);
    word(6);
    word(80);
    word(12);
    word(101);
    word(LOWORD(edit));
    word(HIWORD(edit));
    byte(0x81);
    string("");
    byte(0);
}

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 200 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

static void begin(void)
{
    pump();
    events[0] = '\0';
    logging = TRUE;
}

static void end(LPCSTR name, LONG answer)
{
    char one[24];

    logging = FALSE;
    wsprintf(one, "=%ld", answer);
    lstrcat(events, one);
    probe("filter", name, events);
}

static LONG direct(void)
{
    MSG message;

    message.hwnd = top;
    message.message = WM_USER + 1;
    message.wParam = 0;
    message.lParam = 0;
    message.time = 0;
    message.pt.x = 0;
    message.pt.y = 0;
    return CallMsgFilter(&message, 77);
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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HGLOBAL memory;
    HMENU menu;
    HHOOK wrong;
    RECT rect;
    WORD x;
    WORD y;

    probeOpen(OUTPUT);
    module = instance;
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    kind.style = 0;
    kind.lpfnWndProc = TopProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SysFilt";
    RegisterClass(&kind);

    top = CreateWindow("SysFilt", "T", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL,
                       module, NULL);
    bar = CreateWindow("SCROLLBAR", "", WS_CHILD | WS_VISIBLE | SBS_VERT, 200, 10, 20, 120, top,
                       (HMENU)5, module, NULL);
    SetScrollRange(bar, SB_CTL, 0, 10, FALSE);
    ShowWindow(top, SW_SHOWNORMAL);
    UpdateWindow(top);
    pump();

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");

    wrong = SetWindowsHookEx(WH_SYSMSGFILTER,
                             (HOOKPROC)MakeProcInstance((FARPROC)SysFilter, instance), instance,
                             GetCurrentTask());
    probe("set", "task", wrong ? "handle" : "0");

    if (wrong) {
        UnhookWindowsHookEx(wrong);
    }

    sysHook = SetWindowsHookEx(WH_SYSMSGFILTER,
                               (HOOKPROC)MakeProcInstance((FARPROC)SysFilter, instance), instance,
                               NULL);
    probe("set", "system", sysHook ? "handle" : "0");
    taskHook = SetWindowsHookEx(WH_MSGFILTER,
                                (HOOKPROC)MakeProcInstance((FARPROC)TaskFilter, instance),
                                instance, GetCurrentTask());

    begin();
    end("direct", direct());
    sysEat = TRUE;
    begin();
    end("syseat", direct());
    sysEat = FALSE;
    taskEat = TRUE;
    begin();
    end("taskeat", direct());
    taskEat = FALSE;

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    template = (BYTE FAR *)GlobalLock(memory);
    build();
    begin();
    end("dialog", DialogBoxIndirect(instance, memory, top,
                                    (DLGPROC)MakeProcInstance((FARPROC)DialogProc, instance)));

    SetTimer(top, 3, 50, NULL);
    begin();
    end("msgbox", MessageBox(top, "Filtered", "Box", MB_OKCANCEL));

    menu = CreatePopupMenu();
    AppendMenu(menu, MF_STRING, 10, "One");
    AppendMenu(menu, MF_STRING, 11, "Two");
    SetTimer(top, 2, 50, NULL);
    begin();
    end("menu", TrackPopupMenu(menu, 0, 60, 60, 0, top, NULL));
    DestroyMenu(menu);

    if (mouseEvent) {
        GetWindowRect(bar, &rect);
        x = across((rect.left + rect.right) / 2);
        y = down(rect.bottom - 5);
        begin();
        mouse(0x8001, x, y);
        mouse(0x8002, x, y);
        mouse(0x8004, x, y);
        pump();
        end("scroll", GetScrollPos(bar, SB_CTL));
    }

    begin();
    PostMessage(top, WM_KEYDOWN, VK_RIGHT, 0L);
    PostMessage(top, WM_KEYDOWN, VK_RETURN, 0L);
    SendMessage(top, WM_SYSCOMMAND, SC_MOVE, 0L);
    GetWindowRect(top, &rect);
    end("move", rect.left);

    SetSysModalWindow(top);
    begin();
    end("sysmodal", direct());
    SetSysModalWindow(NULL);
    begin();
    end("after", direct());

    UnhookWindowsHookEx(taskHook);
    UnhookWindowsHookEx(sysHook);
    begin();
    end("unhooked", direct());

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
