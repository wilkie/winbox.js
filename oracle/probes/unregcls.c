/*
 * UnregisterClass, as a Solitaire of the corpus calls it as it ends, and
 * GetInputState, as Bubble Girl asks whether input waits.
 *
 * * `unregister`: the case; what UnregisterClass answered, and whether
 *   GetClassInfo finds the class after, as `answer,found`.
 * * `input`: the case; what GetInputState answered.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\UNREGCLS.OUT"

static HINSTANCE instance;

static BOOL make(LPCSTR name)
{
    WNDCLASS kind;

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.lpszClassName = name;
    return RegisterClass(&kind) != 0;
}

static void unregister(LPCSTR name, LPCSTR kind, HINSTANCE owner, HINSTANCE lookIn)
{
    WNDCLASS info;
    BOOL answer = UnregisterClass(kind, owner);
    BOOL found = GetClassInfo(lookIn, kind, &info) != 0;

    wsprintf(probeResult, "%d,%d", answer, found);
    probe("unregister", name, probeResult);
}

int PASCAL WinMain(HINSTANCE self, HINSTANCE previous, LPSTR command, int show)
{
    HWND window;
    MSG message;

    instance = self;
    probeOpen(OUTPUT);

    make("UnregOne");
    unregister("own", "UnregOne", instance, instance);
    unregister("own-again", "UnregOne", instance, instance);

    make("UnregTwo");
    unregister("other-instance", "UnregTwo", NULL, instance);
    unregister("two", "UnregTwo", instance, instance);

    make("UnregThree");
    window = CreateWindow("UnregThree", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance, NULL);
    unregister("with-window", "UnregThree", instance, instance);
    DestroyWindow(window);
    unregister("window-gone", "UnregThree", instance, instance);

    unregister("never", "UnregNever", instance, instance);
    unregister("system-button", "BUTTON", NULL, NULL);

    make("UnregFour");
    unregister("case", "unregfour", instance, instance);

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
    }

    wsprintf(probeResult, "%d", GetInputState());
    probe("input", "idle", probeResult);

    window = CreateWindow("UnregFour", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance, NULL);
    PostMessage(window, WM_KEYDOWN, 'A', 0);
    wsprintf(probeResult, "%d", GetInputState());
    probe("input", "posted-key", probeResult);
    DestroyWindow(window);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
