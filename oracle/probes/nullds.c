/*
 * A procedure the program exports, handed to EnumTaskWindows without
 * MakeProcInstance, so that USER calls it with AX 1 and its patched prologue
 * takes 1 for its data segment: whether it is called, and what becomes of
 * what it reads and writes through that segment. It reports through a far
 * pointer to the caller's stack, which it does not reach through DS.
 *
 * * `calls`: how many times it was called.
 * * `ds`: the data segment it ran with.
 * * `read`: what it read of a static set to 1234.
 * * `counter`: a static it adds one to for each call, after.
 * * `answer`: EnumTaskWindows' answer.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NULLDS.OUT"

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

typedef struct {
    int calls;
    WORD ds;
    int read;
} OUT;

static int counter;
static int preset = 1234;

WORD getDs(void);
#pragma aux getDs = "mov ax, ds" value [ax];

BOOL CALLBACK __export Visit(HWND window, LPARAM lParam)
{
    OUT FAR *out = (OUT FAR *)lParam;

    out->calls++;
    out->ds = getDs();
    out->read = preset;
    counter++;
    (void)window;
    return TRUE;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    OUT out;
    BOOL answer;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "NullDs";
    RegisterClass(&kind);
    window = CreateWindow("NullDs", "NullDs", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL,
                          instance, NULL);

    out.calls = 0;
    out.ds = 0;
    out.read = 0;
    probe("start", "", "yes");
    answer = EnumTaskWindows(GetCurrentTask(), (WNDENUMPROC)Visit, (LPARAM)(OUT FAR *)&out);
    wsprintf(probeResult, "%d", out.calls);
    probe("calls", "", probeResult);
    wsprintf(probeResult, "%x", out.ds);
    probe("ds", "", probeResult);
    wsprintf(probeResult, "%d", out.read);
    probe("read", "", probeResult);
    wsprintf(probeResult, "%d", counter);
    probe("counter", "", probeResult);
    wsprintf(probeResult, "%d", answer);
    probe("answer", "", probeResult);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
