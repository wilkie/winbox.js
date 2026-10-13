/*
 * Whether a message another program posts this one survives that program's
 * ending. Program Manager, told `[ExitProgman(0)]` by DDE, posts itself
 * `WM_CLOSE` and then posts the client its `WM_DDE_ACK`, and ends; the
 * client never sees the acknowledgement (`progdde`). This asks the same of
 * a program of the probe's own, POSTENDC.EXE (`postend.child.c`), started
 * once for each case with the case in its command line: a message posted
 * here, `WM_USER + 1` or `WM_DDE_ACK`, and the program ended at once from
 * `WinMain`, or by `WM_CLOSE` through its message loop, or by `WM_CLOSE`
 * posted while it handles a message this program posted it, as Program
 * Manager does; and, to compare, a program that posts and stays until it
 * is closed.
 *
 * Each record is the case and what this program's window, "Probe P", was
 * handed while it let the other run until it had ended and a while after:
 * `u` for `WM_USER + 1` and `a` for `WM_DDE_ACK`, with `lParam`'s low word,
 * or `nothing`. Then the same for messages about the DDE messages' range,
 * from 3DFh to 3E9h, each posted by a program that ends at once: `m`, the
 * message and `lParam`'s low word.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>

#define OUTPUT "C:\\ORACLE\\POSTEND.OUT"

static char seen[200];

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message >= 0x3df && message <= 0x3e9 && message != WM_DDE_ACK) {
        wsprintf(seen + lstrlen(seen), "m%x:%x;", message, LOWORD(lParam));
        return 0;
    }

    if (message == WM_USER + 1) {
        wsprintf(seen + lstrlen(seen), "u:%x;", LOWORD(lParam));
        return 0;
    }

    if (message == WM_DDE_ACK) {
        wsprintf(seen + lstrlen(seen), "a:%x;", LOWORD(lParam));
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

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

/* A message posted here by a program that then ends at once. */
static void message(UINT number)
{
    char line[24];
    int i;

    seen[0] = '\0';
    wsprintf(line, "POSTENDC.EXE x%03x", number);
    WinExec(line, SW_SHOWNORMAL);

    for (i = 0; i < 400 && GetModuleHandle("POSTENDC"); i++) {
        settle(1);
    }

    settle(50);
    wsprintf(probeArgs, "x%03x", number);
    wsprintf(probeResult, "%s", (LPSTR)(seen[0] ? seen : "nothing"));
    probe("received", probeArgs, probeResult);
}

static void run(int mode)
{
    char line[20];
    HWND other = NULL;
    int i;

    seen[0] = '\0';
    wsprintf(line, "POSTENDC.EXE %d", mode);
    WinExec(line, SW_SHOWNORMAL);

    if (mode >= 5) {
        for (i = 0; i < 200 && !other; i++) {
            other = FindWindow("PostEndQ", NULL);

            if (!other) {
                Yield();
            }
        }

        if (mode >= 7) {
            settle(50);
            PostMessage(other, WM_CLOSE, 0, 0L);
        } else {
            PostMessage(other, WM_USER + 5, 0, 0L);
        }
    }

    for (i = 0; i < 400 && GetModuleHandle("POSTENDC"); i++) {
        settle(1);
    }

    settle(50);
    wsprintf(probeArgs, "%d", mode);
    wsprintf(probeResult, "%s,%s", (LPSTR)(seen[0] ? seen : "nothing"),
             (LPSTR)(GetModuleHandle("POSTENDC") ? "running" : "ended"));
    probe("received", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND mine;
    int mode;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PostEndP";
    RegisterClass(&kind);
    mine = CreateWindow("PostEndP", "Probe P", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        module, NULL);
    ShowWindow(mine, SW_SHOWNORMAL);

    for (mode = 1; mode <= 8; mode++) {
        run(mode);
    }

    message(0x3df);
    message(WM_DDE_INITIATE);
    message(WM_DDE_TERMINATE);
    message(WM_DDE_DATA);
    message(WM_DDE_EXECUTE);
    message(0x3e9);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
