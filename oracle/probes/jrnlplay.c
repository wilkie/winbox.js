/*
 * A journal playback hook, `WH_JOURNALPLAYBACK`, as Recorder puts one in
 * to play a macro: how USER asks it for each event, what the events become,
 * and what becomes of the keyboard and the mouse meanwhile.
 *
 * `T` is an overlapped window at (40, 40), 400 by 300, with two children
 * of the probe's own class, `A` at (10, 10) and `B` at (210, 10), each 150
 * by 100; `A` has the focus, and a child pressed with the left button takes
 * it. The hook is put in with `SetWindowsHook` and plays a script of
 * events. Asked with `HC_GETNEXT` it fills the `EVENTMSG` at `lParam` with
 * the event due, its time the script's own, and answers the delay the
 * script gives that event the first time it is asked for it, nought after.
 * Told `HC_SKIP`, it goes on to the next event; past the last it takes
 * itself out. Each `HC_SKIP` is written as `s` and the event it ended; the
 * first `HC_GETNEXT` for each event as `g` and the event; any other code as
 * `c` and the code. A window procedure's messages are written as the
 * window and the message's number in hex, a key's with its virtual key and
 * `lParam`, a button's with the point, and each played back with the time
 * `GetMessageTime` gives, in hex, after `@` -- not a character's, whose
 * time is when `TranslateMessage` posted it.
 *
 * The script, `message/paramL/paramH/time`:
 *
 * 1. X pressed, `100/2d58/1/1000`, and let go, `101/2d58/1/1010`.
 * 2. The left button pressed in the middle of `B` and let go there,
 *    `201`/`202`, at the times 1020 and 1030.
 * 3. Y pressed and let go, `100/1559/1/1040` and `101/1559/1/1050`, the
 *    press asked to wait 200 ms.
 * 4. The mouse moved to (300, 300), `200/12c/12c/1060`.
 *
 * As Y's press is taken, its window procedure puts Z in through USER's own
 * `KEYBD_EVENT`, and moves the mouse to (100, 100) through `MOUSE_EVENT`, as
 * the drivers would. Once the hook has taken itself out, all that is waiting
 * is taken.
 *
 * The result: the calls and messages in order (`play`); whether the time
 * from Y's first `HC_GETNEXT` to its press being taken was at least 150 ms
 * (`waited`); the hook's own `HC_GETNEXT` count for Y's press, more than
 * one or not (`asked`); where the cursor is after (`cursor`); and the window
 * with the focus.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\JRNLPLAY.OUT"

static HINSTANCE module;
static HWND top;
static HWND a;
static HWND b;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static HOOKPROC procPlay;
static HOOKPROC next;
static BOOL playing;
static char events[1600];

static WORD keyAX;
static WORD keyBX;
static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

typedef struct {
    UINT message;
    UINT paramL;
    UINT paramH;
    DWORD time;
    DWORD delay;
} STEP;

static STEP script[8];
static int steps;
static int at;
static int asked;
static int askedY;
static DWORD askedAt;
static DWORD tookAt;

static LPCSTR whose(HWND hwnd)
{
    static char handle[8];

    if (hwnd == NULL) {
        return "none";
    }

    if (hwnd == top) {
        return "T";
    }

    if (hwnd == a) {
        return "A";
    }

    if (hwnd == b) {
        return "B";
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

DWORD FAR PASCAL _export Play(int code, WPARAM wParam, LPARAM lParam)
{
    char one[48];

    if (code == HC_GETNEXT) {
        EVENTMSG FAR *event = (EVENTMSG FAR *)lParam;
        DWORD delay = 0;

        if (at >= steps) {
            return 0;
        }

        event->message = script[at].message;
        event->paramL = script[at].paramL;
        event->paramH = script[at].paramH;
        event->time = script[at].time;

        if (asked == 0) {
            /* Not `wParam`: USER leaves its own data segment there
             * (`USER.EXE` seg1 `82ce`). */
            wsprintf(one, "g%d", at);
            add(one);
            delay = script[at].delay;

            if (at == 4) {
                askedAt = GetTickCount();
            }
        }

        if (at == 4) {
            askedY++;
        }

        asked++;
        return delay;
    }

    if (code == HC_SKIP) {
        wsprintf(one, "s%d:%x:%lx", at, wParam, lParam);
        add(one);
        at++;
        asked = 0;

        if (at >= steps) {
            wsprintf(one, "u%d", UnhookWindowsHook(WH_JOURNALPLAYBACK, procPlay));
            add(one);
            playing = FALSE;
        }

        return 0;
    }

    wsprintf(one, "c%d:%x:%lx", code, wParam, lParam);
    add(one);
    return DefHookProc(code, wParam, lParam, &next);
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

static void note(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[48];

    if (message >= WM_KEYDOWN && message <= WM_SYSCHAR) {
        /* The time of a message played back; a character's is the time it
         * was posted, and a key's after the playback the keyboard's. */
        if (playing && message != WM_CHAR && message != WM_SYSCHAR) {
            wsprintf(one, "%s%x:%x/%lx@%lx", whose(hwnd), message, wParam, lParam,
                     GetMessageTime());
        } else {
            wsprintf(one, "%s%x:%x/%lx", whose(hwnd), message, wParam, lParam);
        }

        add(one);

        /* Y's press: the keyboard and the mouse used meanwhile. */
        if (message == WM_KEYDOWN && wParam == 0x59 && playing) {
            tookAt = GetTickCount();
            key(0x5a, 0x2c, FALSE);
            key(0x5a, 0x2c, TRUE);
            mouse(0x8001, across(100), down(100));
        }
    } else if (message == WM_LBUTTONDOWN || message == WM_LBUTTONUP) {
        wsprintf(one, "%s%x:%lx@%lx", whose(hwnd), message, lParam, GetMessageTime());
        add(one);
    } else if (message == WM_SETFOCUS) {
        wsprintf(one, "%s%x", whose(hwnd), message);
        add(one);
    }
}

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam, lParam);
    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export KidProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam, lParam);

    if (message == WM_LBUTTONDOWN) {
        SetFocus(hwnd);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
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

static void step(UINT message, UINT paramL, UINT paramH, DWORD time, DWORD delay)
{
    script[steps].message = message;
    script[steps].paramL = paramL;
    script[steps].paramH = paramH;
    script[steps].time = time;
    script[steps].delay = delay;
    steps++;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG message;
    RECT rect;
    POINT cursor;
    char one[32];
    int x;
    int y;
    int count = 0;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = TopProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "JplyTop";
    RegisterClass(&kind);

    kind.lpfnWndProc = KidProc;
    kind.lpszClassName = "JplyKid";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "KEYBD_EVENT", keybdEvent ? "found" : "missing");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (keybdEvent && mouseEvent) {
        top = CreateWindow("JplyTop", "T", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, NULL, NULL,
                           module, NULL);
        a = CreateWindow("JplyKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 150, 100, top,
                         (HMENU)1, module, NULL);
        b = CreateWindow("JplyKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 210, 10, 150, 100, top,
                         (HMENU)2, module, NULL);
        ShowWindow(top, SW_SHOWNORMAL);
        UpdateWindow(top);
        SetFocus(a);
        pump();

        GetWindowRect(b, &rect);
        x = (rect.left + rect.right) / 2;
        y = (rect.top + rect.bottom) / 2;

        step(WM_KEYDOWN, 0x2d58, 1, 1000L, 0L);
        step(WM_KEYUP, 0x2d58, 1, 1010L, 0L);
        step(WM_LBUTTONDOWN, x, y, 1020L, 0L);
        step(WM_LBUTTONUP, x, y, 1030L, 0L);
        step(WM_KEYDOWN, 0x1559, 1, 1040L, 200L);
        step(WM_KEYUP, 0x1559, 1, 1050L, 0L);
        step(WM_MOUSEMOVE, 300, 300, 1060L, 0L);

        events[0] = '\0';
        playing = TRUE;
        procPlay = (HOOKPROC)MakeProcInstance((FARPROC)Play, instance);
        next = (HOOKPROC)SetWindowsHook(WH_JOURNALPLAYBACK, procPlay);

        while (playing && count < 400 && GetMessage(&message, NULL, 0, 0)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
            count++;
        }

        add("|");
        pump();
        probe("play", "", events);

        probe("waited", "", tookAt - askedAt >= 150 ? "yes" : "no");
        probe("asked", "", askedY > 1 ? "again" : "once");

        GetCursorPos(&cursor);
        wsprintf(one, "%d,%d", cursor.x, cursor.y);
        probe("cursor", "", one);
        probe("focus", "", whose(GetFocus()));
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
