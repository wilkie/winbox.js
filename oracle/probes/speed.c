/*
 * How fast Windows runs under the recorder's DOSBox: instructions, and
 * calls to Windows, against `GetTickCount`, to set winbox.js's virtual
 * clock by (`clock.ts`). Timings, not answers: they vary from run to run,
 * and are not replayed; the recording is kept in `fixtures/timings/`.
 *
 * Each is run until at least two seconds have passed, and records how many
 * times it ran and the milliseconds taken:
 *
 * * `loop`: `LOOP` with CX 65535, each a pass of 65,535 instructions.
 * * `getpixel-screen`, `getpixel-memory`: `GetPixel` of the screen's device
 *   context, and of a memory one with a bitmap selected.
 * * `peek`: `PeekMessage` with `PM_NOREMOVE` and nothing waiting.
 * * `tick`: `GetTickCount`.
 * * `setpixel-memory`: `SetPixel` into the memory one.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SPEED.OUT"

extern void Spin(void);
#pragma aux Spin = "mov cx,0ffffh" "l1: loop l1" modify[cx];

static void report(LPCSTR name, DWORD count, DWORD ms)
{
    wsprintf(probeResult, "%lu,%lu", count, ms);
    probe("speed", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC memory;
    HBITMAP bitmap;
    MSG message;
    DWORD start;
    DWORD count;
    DWORD sink = 0;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 64, 64);
    SelectObject(memory, bitmap);

    start = GetTickCount();
    for (count = 0; GetTickCount() - start < 2000; count++) {
        Spin();
    }
    report("loop", count, GetTickCount() - start);

    start = GetTickCount();
    for (count = 0; GetTickCount() - start < 2000; count += 100) {
        int i;

        for (i = 0; i < 100; i++) {
            sink += GetPixel(screen, i, 10);
        }
    }
    report("getpixel-screen", count, GetTickCount() - start);

    start = GetTickCount();
    for (count = 0; GetTickCount() - start < 2000; count += 100) {
        int i;

        for (i = 0; i < 100; i++) {
            sink += GetPixel(memory, i & 63, 10);
        }
    }
    report("getpixel-memory", count, GetTickCount() - start);

    start = GetTickCount();
    for (count = 0; GetTickCount() - start < 2000; count += 100) {
        int i;

        for (i = 0; i < 100; i++) {
            SetPixel(memory, i & 63, 10, RGB(255, 0, 0));
        }
    }
    report("setpixel-memory", count, GetTickCount() - start);

    start = GetTickCount();
    for (count = 0; GetTickCount() - start < 2000; count += 100) {
        int i;

        for (i = 0; i < 100; i++) {
            sink += PeekMessage(&message, NULL, 0, 0, PM_NOREMOVE);
        }
    }
    report("peek", count, GetTickCount() - start);

    start = GetTickCount();
    for (count = 0; GetTickCount() - start < 2000; count += 100) {
        int i;

        for (i = 0; i < 100; i++) {
            sink += GetTickCount();
        }
    }
    report("tick", count, GetTickCount() - start);

    wsprintf(probeResult, "%lu", sink & 1);
    probe("sink", "parity", probeResult);

    DeleteDC(memory);
    DeleteObject(bitmap);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
