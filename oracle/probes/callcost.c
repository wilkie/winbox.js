/*
 * How long Windows' commonest calls take under the recorder's DOSBox
 * (`cycles=max`), set against how fast it runs a program's own
 * instructions, so that a call's time can be told as the instructions that
 * would have run in it. winbox.js's virtual clock counts a call as a fixed
 * few instructions (`CALL_INSTRUCTIONS`); Windows spends many more inside
 * one, and a program's sense of time per call follows that. Timings, not
 * answers: they vary with the host and from run to run, and are kept in
 * `fixtures/timings/`, not replayed.
 *
 * Each call is made a hundred times in a batch, batch after batch, until at
 * least two seconds by `GetTickCount` have passed, three times over:
 *
 * * `rate`: `cpurate`'s `alu` workload in the same run, as instructions a
 *   millisecond, the passes and the milliseconds -- for telling a call's
 *   time as instructions.
 * * `cost`: the call, as nanoseconds a call, the calls and the
 *   milliseconds. The batch's own loop is in it, a few instructions a call.
 *
 * The calls: `GetTickCount`; `PeekMessage` finding nothing, with
 * `PM_NOYIELD` and without; a message posted to the probe's own window and
 * taken with `GetMessage`, the pair; `SendMessage` of `WM_USER` to it,
 * answered by `DefWindowProc`; `GetDC` and `ReleaseDC`, the pair; `SetPixel`;
 * `BitBlt` of 16 by 16 within the window; `TextOut` of eight characters.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CALLCOST.OUT"

#define BATCH 100

static HWND window;
static HDC dc;

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

static void batchTickCount(void)
{
    int i;

    for (i = 0; i < BATCH; i++) {
        GetTickCount();
    }
}

static void batchPeekNoYield(void)
{
    MSG msg;
    int i;

    for (i = 0; i < BATCH; i++) {
        PeekMessage(&msg, NULL, 0, 0, PM_REMOVE | PM_NOYIELD);
    }
}

static void batchPeek(void)
{
    MSG msg;
    int i;

    for (i = 0; i < BATCH; i++) {
        PeekMessage(&msg, NULL, 0, 0, PM_REMOVE);
    }
}

static void batchPostGet(void)
{
    MSG msg;
    int i;

    for (i = 0; i < BATCH; i++) {
        PostMessage(window, WM_USER, 0, 0);
        GetMessage(&msg, NULL, 0, 0);
    }
}

static void batchSend(void)
{
    int i;

    for (i = 0; i < BATCH; i++) {
        SendMessage(window, WM_USER, 0, 0);
    }
}

static void batchGetDC(void)
{
    int i;

    for (i = 0; i < BATCH; i++) {
        ReleaseDC(window, GetDC(window));
    }
}

static void batchSetPixel(void)
{
    int i;

    for (i = 0; i < BATCH; i++) {
        SetPixel(dc, i, 10, RGB(0, 0, 0));
    }
}

static void batchBitBlt(void)
{
    int i;

    for (i = 0; i < BATCH; i++) {
        BitBlt(dc, 40, 40, 16, 16, dc, 0, 0, SRCCOPY);
    }
}

static void batchTextOut(void)
{
    int i;

    for (i = 0; i < BATCH; i++) {
        TextOut(dc, 10, 60, "abcdefgh", 8);
    }
}

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
    kind.lpszClassName = "CallCost";
    RegisterClass(&kind);

    window = CreateWindow("CallCost", "CallCost", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 300,
                          200, NULL, NULL, instance, NULL);
    UpdateWindow(window);
    dc = GetDC(window);

    rate();
    cost("GetTickCount", batchTickCount);
    cost("PeekMessage/noyield", batchPeekNoYield);
    cost("PeekMessage", batchPeek);
    cost("PostMessage+GetMessage", batchPostGet);
    cost("SendMessage", batchSend);
    cost("GetDC+ReleaseDC", batchGetDC);
    cost("SetPixel", batchSetPixel);
    cost("BitBlt", batchBitBlt);
    cost("TextOut", batchTextOut);
    rate();

    ReleaseDC(window, dc);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
