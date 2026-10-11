/*
 * Where Notepad's window goes: Notepad asks for `CW_USEDEFAULT` for its place
 * and its size, with a class of `CS_BYTEALIGNCLIENT`.
 *
 * The probe starts `NOTEPAD.EXE` and waits for its window, the top-level
 * window whose caption begins "Notepad", and records:
 *
 * * `window`: the window's rectangle on the screen, and its client area's
 *   size;
 * * `class`: its class's style, in hexadecimal.
 *
 * Then the window is closed.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NOTEPOS.OUT"

static HWND found;

BOOL CALLBACK _export FindProc(HWND window, LPARAM lParam)
{
    char caption[64];

    GetWindowText(window, caption, sizeof(caption));

    if (_fstrncmp(caption, "Notepad", 7) == 0) {
        found = window;
        return FALSE;
    }

    (void)lParam;
    return TRUE;
}

static void pump(int rounds)
{
    MSG msg;
    int round;

    for (round = 0; round < rounds; round++) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        Yield();
    }
}

static void report(LPCSTR view, HWND window)
{
    RECT rect;
    RECT client;

    GetWindowRect(window, &rect);
    GetClientRect(window, &client);
    wsprintf(probeResult, "%d,%d,%d,%d client %d,%d", rect.left, rect.top, rect.right,
             rect.bottom, client.right, client.bottom);
    probe("window", view, probeResult);

}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT answer;
    int tries;

    probeOpen(OUTPUT);

    answer = WinExec("NOTEPAD.EXE", SW_SHOWNORMAL);
    wsprintf(probeResult, "%u", answer >= 32 ? 32 : answer);
    probe("started", "NOTEPAD.EXE", probeResult);

    for (tries = 0; tries < 200 && !found; tries++) {
        pump(5);
        EnumWindows(FindProc, 0);
    }

    if (found) {
        pump(50);
        report("first", found);
        wsprintf(probeResult, "%x", GetClassWord(found, GCW_STYLE));
        probe("class", "first", probeResult);
        PostMessage(found, WM_CLOSE, 0, 0);
        pump(100);
    } else {
        probe("window", "first", "none");
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
