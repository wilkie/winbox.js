/*
 * `LockInput`: what it takes and answers, what it does to the focus, the
 * active window, the capture, the system-modal window, the cursor's clip
 * and the other programs, and what letting go puts back (`USER.EXE` seg1
 * `4983`-`4af8`).
 *
 * `W`, "Probe W", is an overlapped window at (40, 40), 300 by 200, with a
 * child `K`; `L`, "Probe L", another at (100, 260), 200 by 100. `C`,
 * "Probe C", is the window of LOCKINPC.EXE (`lockinp.child.c`), started at
 * once, which answers `WM_USER` posted to it by posting `WM_USER + 1` back.
 * Before the lock `W` is active with the focus and the capture, and the
 * cursor is held to (0, 0)-(320, 240).
 *
 * * `state`: the window with the focus, the active one, the one with the
 *   capture, the system-modal one, the cursor's clip, and `IsTaskLocked`,
 *   the task locked, as `none`, `mine` or `other`.
 * * `LockInput`: what it answered for the arguments given -- the reserved
 *   handle, the window, and whether to lock -- and the messages `W` and `L`
 *   were sent meanwhile, as the window and the message in hex; not the
 *   paints, the cursor's or the mouse's.
 * * `replied`: whether `C` answered `WM_USER`, posted it, after twenty
 *   looks each followed by `Yield`.
 * * `key`: X pressed and let go through USER's `KEYBD_EVENT`, then twenty
 *   looks: the windows that were handed its messages.
 * * `EnableHardwareInput`: what it answered. Last, the hardware input is
 *   switched off, and a key put in before the lock, during it and after it,
 *   with `W` active and with the focus again.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOCKINP.OUT"

typedef HTASK(FAR PASCAL *ISTASKLOCKED)(void);

static HINSTANCE module;
static HWND w;
static HWND k;
static HWND l;
static HWND c;
static FARPROC keybdEvent;
static ISTASKLOCKED isTaskLocked;
static BOOL logging;
static BOOL replied;
static char events[1200];

static WORD keyAX;
static WORD keyBX;

static LPCSTR whose(HWND hwnd)
{
    static char handle[8];

    if (hwnd == NULL) {
        return "none";
    }

    if (hwnd == w) {
        return "W";
    }

    if (hwnd == k) {
        return "K";
    }

    if (hwnd == l) {
        return "L";
    }

    if (hwnd == c) {
        return "C";
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

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[24];

    if (message == WM_USER + 1) {
        replied = TRUE;
        return 0;
    }

    if (logging && message != WM_PAINT && message != WM_ERASEBKGND && message != WM_NCPAINT &&
        message != WM_SETCURSOR && message != WM_NCHITTEST && message != WM_MOUSEMOVE &&
        message != WM_NCMOUSEMOVE && message != WM_CTLCOLOR) {
        wsprintf(one, "%s%x", whose(hwnd), message);
        add(one);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
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

/* What comes taken and dispatched, the other programs let run between
 * looks, so many times. */
static void settle(int times)
{
    MSG message;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE | PM_NOYIELD)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }

        Yield();
    }
}

static LPCSTR taskName(HTASK task)
{
    if (task == NULL) {
        return "none";
    }

    return task == GetCurrentTask() ? "mine" : "other";
}

static void state(LPCSTR when)
{
    RECT clip;
    char result[160];

    GetClipCursor(&clip);
    wsprintf(result, "focus=%s,", whose(GetFocus()));
    wsprintf(result + lstrlen(result), "active=%s,", whose(GetActiveWindow()));
    wsprintf(result + lstrlen(result), "capture=%s,", whose(GetCapture()));
    wsprintf(result + lstrlen(result), "sysmodal=%s,", whose(GetSysModalWindow()));
    wsprintf(result + lstrlen(result), "clip=%d,%d,%d,%d,", clip.left, clip.top, clip.right,
             clip.bottom);
    wsprintf(result + lstrlen(result), "locked=%s",
             isTaskLocked ? taskName(isTaskLocked()) : "missing");
    probe("state", when, result);
}

static void lock(HANDLE reserved, HWND hwnd, BOOL fLock)
{
    char args[40];
    char result[1300];
    BOOL answer;

    events[0] = '\0';
    logging = TRUE;
    answer = LockInput(reserved, hwnd, fLock);
    logging = FALSE;
    wsprintf(args, "%d,%s,%d", reserved, whose(hwnd), fLock);
    wsprintf(result, "%d:%s", answer, (LPSTR)(events[0] ? events : "none"));
    probe("LockInput", args, result);
}

static void reply(LPCSTR when)
{
    replied = FALSE;
    PostMessage(c, WM_USER, (WPARAM)w, 0L);
    settle(20);
    probe("replied", when, (LPSTR)(replied ? "yes" : "no"));
}

static void typed(LPCSTR when)
{
    events[0] = '\0';
    logging = TRUE;
    key(0x58, 0x2d, FALSE);
    key(0x58, 0x2d, TRUE);
    settle(20);
    logging = FALSE;
    probe("key", when, events[0] ? events : "none");
}

static void enable(BOOL on)
{
    char args[8];
    char result[8];

    wsprintf(args, "%d", on);
    wsprintf(result, "%d", EnableHardwareInput(on));
    probe("EnableHardwareInput", args, result);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    RECT clip;
    int i;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "LockInpW";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    isTaskLocked = (ISTASKLOCKED)GetProcAddress(GetModuleHandle("KERNEL"), "ISTASKLOCKED");

    w = CreateWindow("LockInpW", "Probe W", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL,
                     module, NULL);
    k = CreateWindow("LockInpW", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 100, 60, w,
                     (HMENU)1, module, NULL);
    l = CreateWindow("LockInpW", "Probe L", WS_OVERLAPPEDWINDOW, 100, 260, 200, 100, NULL, NULL,
                     module, NULL);
    ShowWindow(l, SW_SHOWNORMAL);
    UpdateWindow(l);
    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);

    WinExec("LOCKINPC.EXE", SW_SHOWNORMAL);

    for (i = 0; i < 200 && !c; i++) {
        settle(1);
        c = FindWindow(NULL, "Probe C");
    }

    probe("started", "C", (LPSTR)(c ? "yes" : "no"));

    if (c && keybdEvent) {
        SetActiveWindow(w);
        SetFocus(w);
        settle(20);
        SetCapture(w);
        SetRect(&clip, 0, 0, 320, 240);
        ClipCursor(&clip);
        state("before");
        reply("before");

        lock((HANDLE)1, l, TRUE);
        lock(NULL, NULL, TRUE);
        lock(NULL, k, TRUE);
        lock(NULL, NULL, FALSE);
        state("refused");

        lock(NULL, l, TRUE);
        state("locked");
        lock(NULL, w, TRUE);
        reply("locked");
        typed("locked");

        lock(NULL, NULL, FALSE);
        state("unlocked");
        lock(NULL, NULL, FALSE);
        reply("unlocked");

        SetActiveWindow(w);
        SetFocus(w);
        settle(5);
        enable(FALSE);
        typed("disabled");
        lock(NULL, l, TRUE);
        typed("disabledlocked");
        lock(NULL, NULL, FALSE);
        typed("disabledafter");
        enable(TRUE);
        typed("enabled");

        ReleaseCapture();
        ClipCursor(NULL);
        SendMessage(c, WM_CLOSE, 0, 0L);
        settle(20);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
