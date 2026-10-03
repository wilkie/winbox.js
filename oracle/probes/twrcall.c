/*
 * How long the calls SimTower makes often take that `twrcost` timed only in
 * a pair, or not at all, under the recorder's DOSBox on the 256-colour
 * display, set against the instructions a millisecond of the same run.
 * Recorded at a fixed rate (`record.mjs --cycles`), a call's time is the
 * instructions Windows runs for it. Timings, not answers: kept in
 * `fixtures/timings/`, not replayed.
 *
 * Made as `twrcost`'s are, in a window whose device context has a palette
 * of 256 colours selected and realized, this one's entries reserved so that
 * they may be animated. Each call is made in a batch of 100, batch after
 * batch, until two seconds by `GetTickCount` have passed, three times over:
 *
 * * `rate`: `cpurate`'s `alu` workload in the same run, as instructions a
 *   millisecond, the passes and the milliseconds.
 * * `cost`: the call, as nanoseconds a call, the calls and the
 *   milliseconds. A name of two joined by `+` is the two made together.
 *
 * `SetCursor` of the arrow, loaded once; `TranslateAccelerator` of a
 * `WM_MOUSEMOVE`, which no accelerator matches, with the probe's own table;
 * `GlobalHandle` of a locked block's selector; `AnimatePalette` of 1, 16 and
 * 64 entries from 10; a 1 KiB block allocated and freed; `GetClientRect`;
 * and `FillRect`, `FrameRect` and `DrawFocusRect` of 10 by 10.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TWRCALL.OUT"

#define BATCH 100

static HWND window;
static HDC dc;
static HPALETTE palette;
static HCURSOR arrow;
static HACCEL accelerators;
static HGLOBAL block;
static UINT selector;
static HBRUSH brush;
static RECT a;
static RECT out;
static MSG mouse;
static PALETTEENTRY entries[256];
static int animated;

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

#define BATCHED(name, statement)                                                                   \
    static void name(void)                                                                         \
    {                                                                                              \
        int i;                                                                                     \
        for (i = 0; i < BATCH; i++) {                                                              \
            statement;                                                                             \
        }                                                                                          \
    }

BATCHED(doSetCursor, SetCursor(arrow))
BATCHED(doTranslateAccelerator, TranslateAccelerator(window, accelerators, &mouse))
BATCHED(doGlobalHandle, GlobalHandle(selector))
BATCHED(doAnimatePalette, AnimatePalette(palette, 10, animated, entries))
BATCHED(doGlobalAlloc, GlobalFree(GlobalAlloc(GMEM_MOVEABLE, 1024)))
BATCHED(doGetClientRect, GetClientRect(window, &out))
BATCHED(doFillRect, FillRect(dc, &a, brush))
BATCHED(doFrameRect, FrameRect(dc, &a, brush))
BATCHED(doDrawFocusRect, DrawFocusRect(dc, &a))

static void cost(LPCSTR name, void (*batch)(void))
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

        wsprintf(probeArgs, "%s,%d", name, run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((elapsed * 1000000L) / calls), calls,
                 (long)elapsed);
        probe("cost", probeArgs, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    struct {
        WORD version;
        WORD count;
        PALETTEENTRY entries[256];
    } logical;
    int k;

    probeOpen(OUTPUT);

    arrow = LoadCursor(NULL, IDC_ARROW);
    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = arrow;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "TwrCall";
    RegisterClass(&kind);

    window = CreateWindow("TwrCall", "TwrCall", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 640,
                          480, NULL, NULL, instance, NULL);
    UpdateWindow(window);
    dc = GetDC(window);

    logical.version = 0x300;
    logical.count = 256;

    for (k = 0; k < 256; k++) {
        logical.entries[k].peRed = (BYTE)k;
        logical.entries[k].peGreen = (BYTE)(255 - k);
        logical.entries[k].peBlue = (BYTE)(k * 3);
        logical.entries[k].peFlags = PC_RESERVED;
        entries[k] = logical.entries[k];
    }

    palette = CreatePalette((LOGPALETTE FAR *)&logical);
    SelectPalette(dc, palette, FALSE);
    RealizePalette(dc);

    accelerators = LoadAccelerators(instance, MAKEINTRESOURCE(1));
    block = GlobalAlloc(GMEM_MOVEABLE, 1024);
    selector = (UINT)((DWORD)GlobalLock(block) >> 16);
    brush = CreateSolidBrush(RGB(0, 0, 255));
    SetRect(&a, 10, 10, 20, 20);
    mouse.hwnd = window;
    mouse.message = WM_MOUSEMOVE;
    mouse.pt.x = 100;
    mouse.pt.y = 100;

    rate();
    cost("SetCursor", doSetCursor);
    cost("TranslateAccelerator", doTranslateAccelerator);
    cost("GlobalHandle", doGlobalHandle);
    animated = 1;
    cost("AnimatePalette/1", doAnimatePalette);
    animated = 16;
    cost("AnimatePalette/16", doAnimatePalette);
    animated = 64;
    cost("AnimatePalette/64", doAnimatePalette);
    cost("GlobalAlloc+GlobalFree", doGlobalAlloc);
    cost("GetClientRect", doGetClientRect);
    cost("FillRect", doFillRect);
    cost("FrameRect", doFrameRect);
    cost("DrawFocusRect", doDrawFocusRect);
    rate();

    DeleteObject(brush);
    GlobalUnlock(block);
    GlobalFree(block);
    ReleaseDC(window, dc);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
