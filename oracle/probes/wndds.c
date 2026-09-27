/*
 * The data segment a program's window procedure is called with: its
 * message dispatched by the program, sent from a library, dispatched from
 * a library's own loop -- as the common dialogs' is -- and called through
 * CallWindowProc from a library.
 *
 * * `wndds`: whether DS is the stack's segment, and whether a global of the
 *   program's reads as the program set it, as `ds=ss,global`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WNDDS.OUT"

typedef void(FAR PASCAL *DELIVER)(HWND);

unsigned GetDS(void);
#pragma aux GetDS = "mov ax,ds" value[ax];
unsigned GetSS(void);
#pragma aux GetSS = "mov ax,ss" value[ax];

static int marker = 0x5a3c;
static unsigned seenDS;
static unsigned seenSS;
static int seenMarker;

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        seenDS = GetDS();
        seenSS = GetSS();
        seenMarker = marker;
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void record(LPCSTR what)
{
    wsprintf(probeResult, "%s,%s", (LPSTR)(seenDS == seenSS ? "yes" : "no"),
             (LPSTR)(seenMarker == 0x5a3c ? "ours" : "other"));
    probe("wndds", what, probeResult);
    seenDS = 0;
    seenSS = 1;
    seenMarker = 0;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HINSTANCE library;
    MSG msg;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "WndDS";
    RegisterClass(&kind);
    window = CreateWindow("WndDS", "A", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL, instance,
                          NULL);

    PostMessage(window, WM_USER, 0, 0L);

    while (PeekMessage(&msg, window, WM_USER, WM_USER, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    record("dispatched by the program");

    library = LoadLibrary("WNDDSD.DLL");

    if (library >= HINSTANCE_ERROR) {
        ((DELIVER)GetProcAddress(library, "Send"))(window);
        record("sent from a library");
        ((DELIVER)GetProcAddress(library, "Dispatch"))(window);
        record("dispatched from a library");
        ((DELIVER)GetProcAddress(library, "Call"))(window);
        record("called from a library");
        FreeLibrary(library);
    } else {
        probe("wndds", "library", "not loaded");
    }

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
