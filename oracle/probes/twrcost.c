/*
 * How long the calls SimTower makes most take, where `callcost` and
 * `wingcost` did not time them, under the recorder's DOSBox on the
 * 256-colour display, set against the instructions a millisecond of the
 * same run. Timings, not answers: kept in `fixtures/timings/`, not replayed.
 *
 * Made in a window whose device context has a palette of 256 colours
 * selected and realized, as SimTower's has. Each call is made in a batch of
 * 100, batch after batch, until two seconds by `GetTickCount` have passed,
 * three times over:
 *
 * * `rate`: `cpurate`'s `alu` workload in the same run, as instructions a
 *   millisecond, the passes and the milliseconds.
 * * `cost`: the call, as nanoseconds a call, the calls and the
 *   milliseconds. A name of two joined by `+` is the two made together, as
 *   one: a call that cannot be made over and over alone without something
 *   left behind, a pen made and deleted.
 *
 * The rectangle calls on rectangles of the window's size; `GetWindowRect`,
 * `IsIconic`, `ScreenToClient`, `SetWindowPos` (moving and sizing nothing),
 * `GetActiveWindow`, `SetCursor` of the arrow; `DefWindowProc` and
 * `DispatchMessage` of `WM_NULL` to the window; `TranslateMessage` of a
 * `WM_MOUSEMOVE`; `SelectPalette` of the palette again and `RealizePalette`
 * of it realized already; `GetPaletteEntries` of all 256; `GetStockObject`
 * of the white brush; `GetCurrentPosition`; a pen and a brush made and
 * deleted; a 1 KiB block locked and unlocked; and the probe's own resource
 * found, loaded and freed, and locked and unlocked.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TWRCOST.OUT"

#define BATCH 100

static HINSTANCE self;
static HWND window;
static HDC dc;
static HPALETTE palette;
static HGLOBAL block;
static HRSRC resource;
static HGLOBAL loaded;
static RECT a;
static RECT b;
static RECT out;
static MSG mouse;
static PALETTEENTRY entries[256];

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

BATCHED(doSetRect, SetRect(&a, 0, 0, 640, 480))
BATCHED(doOffsetRect, OffsetRect(&a, 1, 1))
BATCHED(doIntersectRect, IntersectRect(&out, &a, &b))
BATCHED(doPtInRect, PtInRect(&b, mouse.pt))
BATCHED(doEqualRect, EqualRect(&a, &b))
BATCHED(doIsRectEmpty, IsRectEmpty(&a))
BATCHED(doGetWindowRect, GetWindowRect(window, &out))
BATCHED(doIsIconic, IsIconic(window))
BATCHED(doGetCursorPos, GetCursorPos(&mouse.pt))
BATCHED(doScreenToClient, ScreenToClient(window, &mouse.pt))
BATCHED(doGetActiveWindow, GetActiveWindow())
BATCHED(doSetWindowPos,
        SetWindowPos(window, NULL, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE))
BATCHED(doSetCursor, SetCursor(LoadCursor(NULL, IDC_ARROW)))
BATCHED(doDefWindowProc, DefWindowProc(window, WM_NULL, 0, 0))
BATCHED(doDispatchMessage, { MSG m = mouse; m.message = WM_NULL; DispatchMessage(&m); })
BATCHED(doTranslateMessage, TranslateMessage(&mouse))
BATCHED(doSelectPalette, SelectPalette(dc, palette, FALSE))
BATCHED(doRealizePalette, RealizePalette(dc))
BATCHED(doGetPaletteEntries, GetPaletteEntries(palette, 0, 256, entries))
BATCHED(doGetStockObject, GetStockObject(WHITE_BRUSH))
BATCHED(doGetCurrentPosition, GetCurrentPosition(dc))
BATCHED(doCreatePen, DeleteObject(CreatePen(PS_SOLID, 1, RGB(255, 0, 0))))
BATCHED(doCreateSolidBrush, DeleteObject(CreateSolidBrush(RGB(0, 0, 255))))
BATCHED(doGlobalLock, { GlobalLock(block); GlobalUnlock(block); })
BATCHED(doFindResource, FindResource(self, MAKEINTRESOURCE(1), RT_RCDATA))
BATCHED(doLoadResource, FreeResource(LoadResource(self, resource)))
BATCHED(doLockResource, { LockResource(loaded); GlobalUnlock(loaded); })

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
    self = instance;

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "TwrCost";
    RegisterClass(&kind);

    window = CreateWindow("TwrCost", "TwrCost", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 640,
                          480, NULL, NULL, instance, NULL);
    UpdateWindow(window);
    dc = GetDC(window);

    logical.version = 0x300;
    logical.count = 256;

    for (k = 0; k < 256; k++) {
        logical.entries[k].peRed = (BYTE)k;
        logical.entries[k].peGreen = (BYTE)(255 - k);
        logical.entries[k].peBlue = (BYTE)(k * 3);
        logical.entries[k].peFlags = 0;
    }

    palette = CreatePalette((LOGPALETTE FAR *)&logical);
    SelectPalette(dc, palette, FALSE);
    RealizePalette(dc);

    SetRect(&a, 0, 0, 640, 480);
    SetRect(&b, 10, 10, 320, 240);
    mouse.hwnd = window;
    mouse.message = WM_MOUSEMOVE;
    mouse.pt.x = 100;
    mouse.pt.y = 100;
    block = GlobalAlloc(GMEM_MOVEABLE, 1024);
    resource = FindResource(instance, MAKEINTRESOURCE(1), RT_RCDATA);
    loaded = LoadResource(instance, resource);

    rate();
    cost("SetRect", doSetRect);
    cost("OffsetRect", doOffsetRect);
    cost("IntersectRect", doIntersectRect);
    cost("PtInRect", doPtInRect);
    cost("EqualRect", doEqualRect);
    cost("IsRectEmpty", doIsRectEmpty);
    cost("GetWindowRect", doGetWindowRect);
    cost("IsIconic", doIsIconic);
    cost("GetCursorPos", doGetCursorPos);
    cost("ScreenToClient", doScreenToClient);
    cost("GetActiveWindow", doGetActiveWindow);
    cost("SetWindowPos", doSetWindowPos);
    cost("LoadCursor+SetCursor", doSetCursor);
    cost("DefWindowProc", doDefWindowProc);
    cost("DispatchMessage", doDispatchMessage);
    cost("TranslateMessage", doTranslateMessage);
    cost("SelectPalette", doSelectPalette);
    cost("RealizePalette", doRealizePalette);
    cost("GetPaletteEntries", doGetPaletteEntries);
    cost("GetStockObject", doGetStockObject);
    cost("GetCurrentPosition", doGetCurrentPosition);
    cost("CreatePen+DeleteObject", doCreatePen);
    cost("CreateSolidBrush+DeleteObject", doCreateSolidBrush);
    cost("GlobalLock+GlobalUnlock", doGlobalLock);
    cost("FindResource", doFindResource);
    cost("LoadResource+FreeResource", doLoadResource);
    cost("LockResource+GlobalUnlock", doLockResource);
    rate();

    FreeResource(loaded);
    GlobalFree(block);
    ReleaseDC(window, dc);
    DeleteObject(palette);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
