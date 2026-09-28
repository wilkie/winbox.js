/*
 * Windows made with no instance: what USER keeps as their instance, and
 * what a window procedure is called with.
 *
 * * `instance`: GetWindowWord's GWW_HINSTANCE for a window at the top and
 *   a child, each made with an instance of nought, as `ds-1` for the
 *   probe's data segment less one, `class` for the class's instance, or the
 *   number.
 * * `called`: the data segment the window procedure ran with, as its
 *   prologue takes it from AX, for WM_CREATE; `mine` for the probe's.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NULLINST.OUT"

WORD getDs(void);
#pragma aux getDs = "mov ax, ds" value [ax];

static WORD mine;
static WORD during;

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_CREATE) {
        during = getDs();
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void describe(LPCSTR what, HWND window, HINSTANCE instance)
{
    WORD kept = GetWindowWord(window, GWW_HINSTANCE);

    if (kept == mine - 1) {
        lstrcpy(probeResult, "ds-1");
    } else if (kept == (WORD)instance) {
        lstrcpy(probeResult, "class");
    } else {
        wsprintf(probeResult, "%x", kept);
    }

    probe("instance", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND top;
    HWND child;

    probeOpen(OUTPUT);
    mine = getDs();

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "NullInst";
    RegisterClass(&kind);

    during = 0;
    top = CreateWindow("NullInst", "Top", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL, NULL,
                       NULL);
    describe("top", top, instance);
    probe("called", "top", (LPSTR)(during == mine ? "mine" : "other"));

    during = 0;
    child = CreateWindow("NullInst", "Child", WS_CHILD, 0, 0, 50, 50, top, (HMENU)1, NULL, NULL);
    describe("child", child, instance);
    probe("called", "child", (LPSTR)(during == mine ? "mine" : "other"));

    DestroyWindow(top);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
