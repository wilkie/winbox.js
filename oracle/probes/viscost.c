/*
 * What a window's visible region costs a drawing call: `callcost`'s
 * `BitBlt` of 16 by 16 within a window, `SRCCOPY`, and a `PatBlt` of 16 by
 * 16, made through a context got once, while what lies over the window
 * changes. GDI draws through each rectangle of the region in turn
 * (`GDI.EXE` seg1 `2e74`-`2ec3`), so the more rectangles, the more work.
 * Timings, kept in `fixtures/timings/` and not replayed; recorded at a fixed
 * rate (`--cycles 80000`), where a call's time is its instructions.
 *
 * The window is `callcost`'s, 300 by 200 at (40, 40). The drawing is at
 * (40, 40) in its client area. The cases:
 *
 * * nothing over the window;
 * * a pop-up 60 by 40 over the client area at (200, 120), clear of
 *   the drawing;
 * * a pop-up 60 by 40 over the client area at (48, 20), over the right
 *   half of the drawing;
 * * eight pop-ups 10 by 10 over the client area, clear of the drawing,
 *   in two rows.
 *
 * `kind` is the kind of region the context draws through in each.
 *
 * `rate` is `cpurate`'s `alu`, as in `callcost`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\VISCOST.OUT"

#define BATCH 100

static HWND window;
static HDC dc;
static HINSTANCE module;
static HWND covers[8];
static int coverCount;

static void passAlu(void)
{
    _asm {
        mov cx, 65535
        mov bx, 3
        mov dx, 5
    top:
        add ax, bx
        sub ax, cx
        xor ax, dx
        and ax, bx
        or ax, cx
        shl ax, 1
        inc ax
        dec ax
        loop top
    }
}

static void rate(void)
{
    int run;

    for (run = 1; run <= 3; run++) {
        DWORD start = GetTickCount();
        DWORD elapsed;
        long passes = 0;

        do {
            passAlu();
            passes++;
            elapsed = GetTickCount() - start;
        } while (elapsed < 2000);

        wsprintf(probeArgs, "alu,%d", run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((passes * 65535L * 9L) / (long)elapsed),
                 passes, (long)elapsed);
        probe("rate", probeArgs, probeResult);
    }
}

static void batchBitBlt(void)
{
    int i;

    for (i = 0; i < BATCH; i++) {
        BitBlt(dc, 40, 40, 16, 16, dc, 0, 0, SRCCOPY);
    }
}

static void batchPatBlt(void)
{
    int i;

    for (i = 0; i < BATCH; i++) {
        PatBlt(dc, 40, 40, 16, 16, PATCOPY);
    }
}

static void cost(LPCSTR name, LPCSTR cover, void (*batch)(void))
{
    int run;

    for (run = 1; run <= 3; run++) {
        DWORD start = GetTickCount();
        DWORD elapsed;
        long calls = 0;

        do {
            batch();
            calls += BATCH;
            elapsed = GetTickCount() - start;
        } while (elapsed < 2000);

        wsprintf(probeArgs, "%s/%s,%d", name, cover, run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((elapsed * 1000000L) / calls), calls,
                 (long)elapsed);
        probe("cost", probeArgs, probeResult);
    }
}

/* A pop-up over the window's client area, `x, y` from its corner. */
static void cover(int x, int y, int width, int height)
{
    POINT at;

    at.x = x;
    at.y = y;
    ClientToScreen(window, &at);
    covers[coverCount++] = CreateWindow("VisCost", "", WS_POPUP | WS_VISIBLE, at.x, at.y, width,
                                        height, window, NULL, module, NULL);
}

static void uncover(void)
{
    while (coverCount) {
        DestroyWindow(covers[--coverCount]);
    }
}

/* The region the context draws through, as its kind: 2 one rectangle. */
static void clipKind(LPCSTR cover)
{
    RECT box;

    wsprintf(probeResult, "%d", GetClipBox(dc, &box));
    probe("kind", cover, probeResult);
}

static void costs(LPCSTR name)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    clipKind(name);
    cost("BitBlt", name, batchBitBlt);
    cost("PatBlt", name, batchPatBlt);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    int i;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "VisCost";
    RegisterClass(&kind);

    window = CreateWindow("VisCost", "VisCost", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 300,
                          200, NULL, NULL, instance, NULL);
    UpdateWindow(window);
    dc = GetDC(window);
    SelectObject(dc, GetStockObject(GRAY_BRUSH));

    rate();
    costs("nothing over the window");

    cover(200, 120, 60, 40);
    costs("a pop-up over the window clear of the drawing");
    uncover();

    cover(48, 20, 60, 40);
    costs("a pop-up over half the drawing");
    uncover();

    for (i = 0; i < 8; i++) {
        cover(100 + (i % 4) * 30, 100 + (i / 4) * 30, 10, 10);
    }

    costs("eight pop-ups over the window clear of the drawing");
    uncover();
    rate();

    ReleaseDC(window, dc);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
