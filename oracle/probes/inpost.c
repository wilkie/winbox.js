/*
 * When the program that holds USER's system queue lets it go of its own
 * accord: at the start of each look of its, where the message it took last
 * is the one marked last for it (`USER.EXE` seg1 `281c`-`2847`). Taking an
 * event of the input marks the input (`303f`, `3058`); a message posted to
 * the program that holds the queue marks that message (`2430`-`2437`); and
 * a posted message taken marks itself (`55d4`-`55e9`).
 *
 * `A`, "Probe A", is this program's window at (40, 40), 200 by 150; `B`,
 * "Probe B", the window of INPOSTC.EXE (`inpost.child.c`), started at once,
 * which is active and has the focus. `A`'s procedure answers
 * `WM_MOUSEACTIVATE` with `MA_NOACTIVATE`, so a press on it leaves `B`
 * active; it writes `A:` and the message for each button's message it is
 * handed. Handed `WM_USER + 1`, it lets the other program run, with
 * `Yield`, forty times, and writes `A:posted`. Both programs write to
 * C:\ORACLE\POST.TXT.
 *
 * Each case puts in, through USER's own `MOUSE_EVENT` and `KEYBD_EVENT`, a
 * press and release of the left button in the middle of `A`, and then X
 * pressed and let go -- which go to `B` -- before anything is taken; then
 * takes and dispatches what comes, letting the other program run between
 * looks, for a while. The result is every line written since the case
 * began, `|` between.
 *
 * * `postself`: as it is handed `WM_LBUTTONUP`, `A` posts itself
 *   `WM_USER + 1`, and writes `A:done`.
 * * `filtered`: `A` posts itself `WM_USER + 1` before the input is put in,
 *   and takes the mouse's move, the press and the release with
 *   `PeekMessage` for the mouse's messages alone, one look each, before it
 *   takes all that comes.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\INPOST.OUT"
#define LOG "C:\\ORACLE\\POST.TXT"

static HINSTANCE module;
static HWND mine;
static HWND other;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static int mode;
static char text[1600];
static int seen;

static WORD keyAX;
static WORD keyBX;
static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static void note(LPCSTR line)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

/* The lines written since last asked, `|` between. */
static void since(LPCSTR function, LPCSTR what)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length = 0;
    int i;
    int lines = 0;
    char out[400];
    int at = 0;

    if (file != HFILE_ERROR) {
        length = _lread(file, text, sizeof(text) - 1);
        _lclose(file);
    }

    text[length < 0 ? 0 : length] = '\0';
    out[0] = '\0';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            continue;
        }

        if (text[i] == '\n') {
            lines++;

            if (lines > seen && at && out[at - 1] != '|') {
                out[at++] = '|';
            }

            continue;
        }

        if (lines >= seen && at < (int)sizeof(out) - 2) {
            out[at++] = text[i];
        }
    }

    out[at] = '\0';
    seen = lines;
    probe(function, what, out[0] ? out : "none");
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[24];
    int i;

    if (message == WM_MOUSEACTIVATE) {
        return MA_NOACTIVATE;
    }

    if (message >= WM_LBUTTONDOWN && message <= WM_LBUTTONDBLCLK) {
        wsprintf(line, "A:%x", message);
        note(line);
    }

    if (message == WM_LBUTTONUP) {
        if (mode == 1) {
            PostMessage(hwnd, WM_USER + 1, 0, 0L);
            note("A:done");
        }

        return 0;
    }

    if (message == WM_USER + 1) {
        for (i = 0; i < 40; i++) {
            Yield();
        }

        note("A:posted");
        return 0;
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

/* What comes taken and dispatched, the other program let run between
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

/* One look for the mouse's messages alone, and what it took dispatched:
 * the message, or nought for none. */
static UINT mouseLook(void)
{
    MSG message;

    if (PeekMessage(&message, NULL, WM_MOUSEFIRST, WM_MOUSELAST, PM_REMOVE | PM_NOYIELD)) {
        DispatchMessage(&message);
        return message.message;
    }

    return 0;
}

static void run(LPCSTR name, int how)
{
    RECT rect;
    WORD x;
    WORD y;
    int i;

    settle(20);
    since("before", name);
    mode = how;

    if (how == 2) {
        PostMessage(mine, WM_USER + 1, 0, 0L);
    }

    GetWindowRect(mine, &rect);
    x = across((rect.left + rect.right) / 2);
    y = down((rect.top + rect.bottom) / 2);
    mouse(0x8001, x, y);
    mouse(0x8002, x, y);
    mouse(0x8004, x, y);
    key(0x58, 0x2d, FALSE);
    key(0x58, 0x2d, TRUE);

    if (how == 2) {
        for (i = 0; i < 5 && mouseLook() != WM_LBUTTONUP; i++) {
        }
    }

    settle(100);
    mode = 0;
    since("input", name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HFILE file;
    int i;

    probeOpen(OUTPUT);
    module = instance;

    file = _lcreat(LOG, 0);
    _lclose(file);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "InPostA";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");

    if (!keybdEvent || !mouseEvent) {
        probe("entry", "KEYBD_EVENT", "missing");
        probeFinish();
        return 0;
    }

    mine = CreateWindow("InPostA", "Probe A", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        module, NULL);
    ShowWindow(mine, SW_SHOWNORMAL);
    UpdateWindow(mine);

    WinExec("INPOSTC.EXE", SW_SHOWNORMAL);

    for (i = 0; i < 200 && !other; i++) {
        settle(1);
        other = FindWindow(NULL, "Probe B");
    }

    probe("started", "B", (LPSTR)(other ? "yes" : "no"));
    probe("active", "B", (LPSTR)(GetActiveWindow() == other ? "yes" : "no"));

    if (other) {
        run("postself", 1);
        run("filtered", 2);
        SendMessage(other, WM_CLOSE, 0, 0L);
        settle(20);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
