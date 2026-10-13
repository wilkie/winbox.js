/*
 * The hooks while USER's system error box is up. `SysErrorBox` sets the
 * word at `0E0h` of USER's data (`USER.EXE` seg1 `9350`-`9359`), which keeps
 * the keyboard and mouse hooks from being called and the computer-based
 * training hooks from being told of keys and clicks skipped (`32de`,
 * `2e6e`); and makes the desktop window the system-modal one (`9392`-
 * `939b`), which keeps the journal hooks from being called (`4e42`). Its
 * loop takes the keyboard through `PeekMessage`'s own look (`9768`).
 *
 * Put in for the probe's task with `SetWindowsHookEx`, each passing on with
 * `CallNextHookEx`, and each noting its calls but the mouse's moves: a
 * keyboard hook `k<code>:<key>`, a mouse hook `m<code>:<message>`, a
 * computer-based training hook `c<code>:<wParam>`, a message hook
 * `g<code>:<message>`; and for no task, a journal record hook
 * `j<code>:<message>`.
 *
 * * `box`: the box, with an OK button, written before it comes up; Enter is
 *   pressed at it from outside (`record.mjs --then`). Then what the hooks
 *   were called with while it was up, and its answer.
 * * `after`: X pressed and let go through `KEYBD_EVENT` once it is gone,
 *   and all that is waiting taken: the hooks called again.
 *
 * The probe's window `W`, overlapped, has the focus throughout.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SEBHOOK.OUT"

#define SEB_OK 1
#define SEB_DEFBUTTON 0x8000

/* `SysErrorBox`, USER's export 320, which `windows.h` does not declare. */
typedef int(FAR PASCAL *SYSERRORBOX)(LPCSTR, LPCSTR, UINT, UINT, UINT);

static HHOOK keyboardHook;
static HHOOK mouseHook;
static HHOOK cbtHook;
static HHOOK messageHook;
static HOOKPROC recordProc;
static HOOKPROC nextRecord;
static FARPROC keybdEvent;
static SYSERRORBOX sysErrorBox;
static WORD keyAX;
static WORD keyBX;
static BOOL logging;
static char events[1200];

static void add(LPCSTR text)
{
    if (logging && lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

static BOOL moving(UINT message)
{
    return message == WM_MOUSEMOVE || message == WM_NCMOUSEMOVE;
}

LRESULT FAR PASCAL _export KeyboardHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[24];

    wsprintf(one, "k%d:%x", code, wParam);
    add(one);
    return CallNextHookEx(keyboardHook, code, wParam, lParam);
}

LRESULT FAR PASCAL _export MouseHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[24];

    if (!moving(wParam)) {
        wsprintf(one, "m%d:%x", code, wParam);
        add(one);
    }

    return CallNextHookEx(mouseHook, code, wParam, lParam);
}

LRESULT FAR PASCAL _export CbtHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[24];

    if (!(code == HCBT_CLICKSKIPPED && moving(wParam))) {
        wsprintf(one, "c%d:%x", code, wParam);
        add(one);
    }

    return CallNextHookEx(cbtHook, code, wParam, lParam);
}

LRESULT FAR PASCAL _export MessageHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[24];
    MSG FAR *message = (MSG FAR *)lParam;

    if (!moving(message->message) && message->message != WM_PAINT &&
        message->message != 0x118) {
        wsprintf(one, "g%d:%x", code, message->message);
        add(one);
    }

    return CallNextHookEx(messageHook, code, wParam, lParam);
}

DWORD FAR PASCAL _export RecordHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[24];

    if (code == HC_ACTION) {
        EVENTMSG FAR *event = (EVENTMSG FAR *)lParam;

        if (!moving(event->message)) {
            wsprintf(one, "j%d:%x", code, event->message);
            add(one);
        }
    } else {
        wsprintf(one, "j%d", code);
        add(one);
    }

    return DefHookProc(code, wParam, lParam, &nextRecord);
}

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

LONG FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char one[16];
    int answer;
    WNDCLASS kind;
    HWND window;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = WindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SebHook";
    RegisterClass(&kind);
    window = CreateWindow("SebHook", "W", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);
    SetFocus(window);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);
    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    sysErrorBox = (SYSERRORBOX)GetProcAddress(GetModuleHandle("USER"), MAKEINTRESOURCE(320));
    pump();

    keyboardHook = SetWindowsHookEx(WH_KEYBOARD,
                                    (HOOKPROC)MakeProcInstance((FARPROC)KeyboardHook, instance),
                                    instance, GetCurrentTask());
    mouseHook = SetWindowsHookEx(WH_MOUSE,
                                 (HOOKPROC)MakeProcInstance((FARPROC)MouseHook, instance),
                                 instance, GetCurrentTask());
    cbtHook = SetWindowsHookEx(WH_CBT, (HOOKPROC)MakeProcInstance((FARPROC)CbtHook, instance),
                               instance, GetCurrentTask());
    messageHook = SetWindowsHookEx(WH_GETMESSAGE,
                                   (HOOKPROC)MakeProcInstance((FARPROC)MessageHook, instance),
                                   instance, GetCurrentTask());
    recordProc = (HOOKPROC)MakeProcInstance((FARPROC)RecordHook, instance);
    nextRecord = (HOOKPROC)SetWindowsHook(WH_JOURNALRECORD, recordProc);

    probe("box", "", "up");
    events[0] = '\0';
    logging = TRUE;
    answer = sysErrorBox ? sysErrorBox("Hooked?", "Probe", SEB_OK | SEB_DEFBUTTON, 0, 0) : -1;
    logging = FALSE;
    wsprintf(one, "=%d", answer);
    lstrcat(events, one);
    probe("hooks", "box", events);

    events[0] = '\0';
    logging = TRUE;

    if (keybdEvent) {
        key(0x58, 0x2d, FALSE);
        key(0x58, 0x2d, TRUE);
    }

    pump();
    logging = FALSE;
    probe("hooks", "after", events);

    UnhookWindowsHook(WH_JOURNALRECORD, recordProc);
    UnhookWindowsHookEx(messageHook);
    UnhookWindowsHookEx(cbtHook);
    UnhookWindowsHookEx(mouseHook);
    UnhookWindowsHookEx(keyboardHook);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
