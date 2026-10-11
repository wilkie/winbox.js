/*
 * What the mouse's thresholds and speed and the screen saver's delay do
 * that a program can see.
 *
 * The mouse: `MOUSE_EVENT` moves the pointer by BX and CX without bit
 * 8000h, which USER doubles where the move is more than the first
 * threshold, and doubles again where it is more than the second and the
 * speed is 2 (`USER.EXE` seg1 `5209`). Each `mouse` record sets the three
 * with `SPI_SETMOUSE`, then for each move from (300, 200) -- put there
 * with `SetCursorPos` -- gives how far the pointer went, as
 * `GetCursorPos` has it: across for `x`, then down for `y`, each a list of
 * the moves 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 20 and -5.
 *
 * The screen saver: USER looks every ten seconds, on a timer of its own
 * (seg5 `0470`), and where it is active and its delay has passed since the
 * last input, posts the active window `WM_SYSCOMMAND` with
 * `SC_SCREENSAVE` (seg1 `3388`-`33f7`); `DefWindowProc` runs the program
 * `SYSTEM.INI`'s `[boot] SCRNSAVE.EXE` names, with ` /s` (`05f9`). `W` is
 * an overlapped window, active; `H` a hidden one. Each writes each
 * `WM_SYSCOMMAND` it is handed, its letter, `p` where it was posted, its
 * `wParam` and `lParam`. Each `saver` record waits, taking and dispatching
 * what comes, for so many seconds of `GetTickCount`'s, and gives what was
 * written, `|` between:
 *
 * * `off`: a delay of 1 second, not active: 12 seconds.
 * * `on`: active: until the first `SC_SCREENSAVE`, or 25 seconds.
 * * `again`: 12 seconds more, with no input meanwhile.
 * * `run`: `W` now passes `SC_SCREENSAVE` to `DefWindowProc`, and
 *   `SCRNSAVE.EXE` names SPIIDLEC.EXE (`spiidle.child.c`), which writes
 *   the command line it is given; the mouse moved a pixel with
 *   `MOUSE_EVENT`; then until the screen saver has written, or 25
 *   seconds; then its line (`saver.txt`).
 * * `key`: `SCRNSAVE.EXE` as `SYSTEM.INI` then has it.
 * * `sent`: `W` sent `WM_SYSCOMMAND` with `SC_SCREENSAVE` by the probe
 *   itself, passed on; five seconds; then the screen saver's lines.
 * * `WinExec`: SPIIDLEC.EXE started by the probe with `/x`, whether it
 *   was (an instance above 32); five seconds (`direct`); then its lines.
 *
 * Every setting is put back at the end.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SPIIDLE.OUT"
#define SAVER "C:\\ORACLE\\SAVER.TXT"

static HINSTANCE module;
static HWND w;
static HWND h;
static FARPROC mouseEvent;
static BOOL dispatching;
static BOOL passOn;
static int screenSaves;
static char log[800];

static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static void note(LPCSTR text)
{
    if (lstrlen(log) + lstrlen(text) + 2 < sizeof(log)) {
        if (log[0]) {
            lstrcat(log, "|");
        }

        lstrcat(log, text);
    }
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_SYSCOMMAND) {
        char line[60];

        wsprintf(line, "%c:%c:%x:%lx", hwnd == w ? 'W' : hwnd == h ? 'H' : '?',
                 dispatching ? 'p' : 's', wParam, lParam);
        note(line);

        if ((wParam & 0xfff0) == SC_SCREENSAVE) {
            screenSaves++;

            if (!passOn) {
                return 0;
            }
        }
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void mouse(WORD flags, int x, int y)
{
    mouseFlags = flags;
    mouseX = (WORD)x;
    mouseY = (WORD)y;

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

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        dispatching = TRUE;
        DispatchMessage(&message);
        dispatching = FALSE;
    }
}

static const int MOVES[] = {1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 20, -5};

static void moves(LPCSTR name, int first, int second, int speed)
{
    WORD settings[3];
    char text[40];
    POINT at;
    int i;
    int across;

    settings[0] = first;
    settings[1] = second;
    settings[2] = speed;
    SystemParametersInfo(SPI_SETMOUSE, 0, settings, 0);

    for (across = 1; across >= 0; across--) {
        probeResult[0] = '\0';

        for (i = 0; i < sizeof(MOVES) / sizeof(MOVES[0]); i++) {
            SetCursorPos(300, 200);
            mouse(0x0001, across ? MOVES[i] : 0, across ? 0 : MOVES[i]);
            pump();
            GetCursorPos(&at);
            wsprintf(text, "%s%d", (LPSTR)(i ? " " : ""), across ? at.x - 300 : at.y - 200);
            lstrcat(probeResult, text);
        }

        wsprintf(probeArgs, "%s,%d:%d:%d,%s", name, first, second, speed,
                 (LPSTR)(across ? "x" : "y"));
        probe("mouse", probeArgs, probeResult);
    }
}

static BOOL saverWrote(LPSTR out)
{
    HFILE file = _lopen(SAVER, OF_READ);
    int length;

    if (file == HFILE_ERROR) {
        return FALSE;
    }

    length = _lread(file, out, 150);
    _lclose(file);
    out[length < 0 ? 0 : length] = '\0';

    while (length > 0 && (out[length - 1] == '\r' || out[length - 1] == '\n')) {
        out[--length] = '\0';
    }

    return length > 0;
}

static void wait(LPCSTR name, DWORD seconds, BOOL untilOne, BOOL untilSaver)
{
    DWORD start = GetTickCount();
    char saver[160];

    log[0] = '\0';
    screenSaves = 0;

    while (GetTickCount() - start < seconds * 1000L) {
        pump();

        if (untilOne && screenSaves) {
            break;
        }

        if (untilSaver && saverWrote(saver)) {
            break;
        }

        Yield();
    }

    pump();
    probe("saver", name, log[0] ? log : "none");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    WORD mouseWas[3];
    int timeoutWas;
    BOOL activeWas;
    char saver[160];

    probeOpen(OUTPUT);
    module = instance;

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SpiIdle";
    RegisterClass(&kind);

    w = CreateWindow("SpiIdle", "W", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL, module,
                     NULL);
    h = CreateWindow("SpiIdle", "H", WS_OVERLAPPEDWINDOW, 300, 40, 200, 150, NULL, NULL, module,
                     NULL);
    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);
    pump();

    SystemParametersInfo(SPI_GETMOUSE, 0, mouseWas, 0);
    wsprintf(probeResult, "%d:%d:%d", mouseWas[0], mouseWas[1], mouseWas[2]);
    probe("mousewas", "", probeResult);

    moves("start", mouseWas[0], mouseWas[1], mouseWas[2]);
    moves("none", 0, 0, 0);
    moves("one", 4, 8, 1);
    moves("two", 4, 8, 2);
    moves("high", 10, 20, 2);
    moves("zero", 0, 0, 2);
    SystemParametersInfo(SPI_SETMOUSE, 0, mouseWas, 0);

    SystemParametersInfo(SPI_GETSCREENSAVETIMEOUT, 0, &timeoutWas, 0);
    SystemParametersInfo(SPI_GETSCREENSAVEACTIVE, 0, &activeWas, 0);

    SystemParametersInfo(SPI_SETSCREENSAVETIMEOUT, 1, NULL, 0);
    SystemParametersInfo(SPI_SETSCREENSAVEACTIVE, 0, NULL, 0);
    wait("off", 12, FALSE, FALSE);

    SystemParametersInfo(SPI_SETSCREENSAVEACTIVE, 1, NULL, 0);
    wait("on", 25, TRUE, FALSE);
    wait("again", 12, FALSE, FALSE);

    WritePrivateProfileString("boot", "SCRNSAVE.EXE", "SPIIDLEC.EXE", "SYSTEM.INI");
    passOn = TRUE;
    mouse(0x0001, 1, 0);
    wait("run", 25, FALSE, TRUE);
    passOn = FALSE;
    probe("saver.txt", "", saverWrote(saver) ? saver : "none");

    GetPrivateProfileString("boot", "SCRNSAVE.EXE", "<none>", saver, sizeof(saver),
                            "SYSTEM.INI");
    probe("key", "SCRNSAVE.EXE", saver);

    passOn = TRUE;
    log[0] = '\0';
    SendMessage(w, WM_SYSCOMMAND, SC_SCREENSAVE, 0L);
    wait("sent", 5, FALSE, TRUE);
    passOn = FALSE;
    probe("saver.txt", "sent", saverWrote(saver) ? saver : "none");

    wsprintf(probeResult, "%d", WinExec("SPIIDLEC.EXE /x", SW_SHOWNORMAL) > 32);
    probe("WinExec", "SPIIDLEC.EXE /x", probeResult);
    wait("direct", 5, FALSE, FALSE);
    probe("saver.txt", "direct", saverWrote(saver) ? saver : "none");

    SystemParametersInfo(SPI_SETSCREENSAVEACTIVE, activeWas, NULL, 0);
    SystemParametersInfo(SPI_SETSCREENSAVETIMEOUT, timeoutWas, NULL, 0);
    WritePrivateProfileString("boot", "SCRNSAVE.EXE", NULL, "SYSTEM.INI");

    DestroyWindow(h);
    DestroyWindow(w);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
