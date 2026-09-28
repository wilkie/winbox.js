/*
 * MMSYSTEM's timer services: what the device can do, periods, the time,
 * and events that call a procedure back.
 *
 * * `caps`: `timeGetDevCaps`'s answer and the least and most period, for
 *   the structure's size and for too small a size.
 * * `period`: what `timeBeginPeriod` and `timeEndPeriod` answer for a
 *   period.
 * * `time`: whether `timeGetTime` is within a second of `GetTickCount`
 *   (`near` or `far`), and whether it steps a millisecond at a time or by a
 *   tick (`fine` for a least step of eight under 10, `coarse`).
 * * `system`: `timeGetSystemTime`'s answer and the `MMTIME`'s type.
 * * `event`: what `timeSetEvent` answered (`id` and the number, or 0).
 * * `called`: for each event, how many times its procedure was called in
 *   the time waited -- as `none`, `once` or `several` -- and the arguments
 *   of the first call, the id named as `id` when it is the event's.
 * * `kill`: what `timeKillEvent` answered.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MMTIME.OUT"

/* Each record is closed into the file, so a call that hangs Windows leaves
 * the records before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static volatile int calls[4];
static UINT ids[4];
static UINT firstId[4];
static UINT firstMsg[4];
static DWORD firstUser[4];
static DWORD firstOne[4];
static DWORD firstTwo[4];

/* Called at interrupt time, on another stack: its own data segment loaded
 * for itself, and no check of the stack, which assumes the program's. */
#pragma off (check_stack)
void CALLBACK __loadds TimeProc(UINT id, UINT msg, DWORD user, DWORD one, DWORD two)
{
    int which = (int)user;

    if (which < 0 || which > 3) {
        return;
    }

    if (!calls[which]) {
        firstId[which] = id;
        firstMsg[which] = msg;
        firstUser[which] = user;
        firstOne[which] = one;
        firstTwo[which] = two;
    }

    calls[which]++;
}
#pragma on (check_stack)

static void wait(DWORD ms)
{
    DWORD until = GetTickCount() + ms;
    MSG msg;

    while (GetTickCount() < until) {
        PeekMessage(&msg, NULL, 0, 0, PM_REMOVE);
    }
}

static void event(LPCSTR name, int which, UINT delay, UINT flags)
{
    ids[which] = timeSetEvent(delay, 10, (LPTIMECALLBACK)TimeProc, (DWORD)which, flags);

    if (ids[which]) {
        wsprintf(probeResult, "id");
    } else {
        wsprintf(probeResult, "0");
    }

    probe("event", name, probeResult);
}

static void called(LPCSTR name, int which)
{
    int count = calls[which];

    if (!count) {
        probe("called", name, "none");
        return;
    }

    wsprintf(probeResult, "%s %s %u %lu %lu %lu", (LPSTR)(count == 1 ? "once" : "several"),
             (LPSTR)(firstId[which] == ids[which] ? "id" : "other"), firstMsg[which],
             firstUser[which], firstOne[which], firstTwo[which]);
    probe("called", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    TIMECAPS caps;
    MMTIME time;
    DWORD mm;
    DWORD tick;
    DWORD then;
    DWORD step;
    DWORD least;
    int count;
    UINT answer;

    probeOpen(OUTPUT);

    caps.wPeriodMin = caps.wPeriodMax = 0xabcd;
    answer = timeGetDevCaps(&caps, sizeof(caps));
    wsprintf(probeResult, "%u %u %u", answer, caps.wPeriodMin, caps.wPeriodMax);
    probe("caps", "size", probeResult);

    caps.wPeriodMin = caps.wPeriodMax = 0xabcd;
    answer = timeGetDevCaps(&caps, 2);
    wsprintf(probeResult, "%u %x %x", answer, caps.wPeriodMin, caps.wPeriodMax);
    probe("caps", "small", probeResult);

    wsprintf(probeResult, "%u", timeBeginPeriod(1));
    probe("period", "begin-1", probeResult);
    wsprintf(probeResult, "%u", timeBeginPeriod(0));
    probe("period", "begin-0", probeResult);
    wsprintf(probeResult, "%u", timeBeginPeriod(65535));
    probe("period", "begin-65535", probeResult);
    wsprintf(probeResult, "%u", timeEndPeriod(1));
    probe("period", "end-1", probeResult);
    wsprintf(probeResult, "%u", timeEndPeriod(0));
    probe("period", "end-0", probeResult);

    mm = timeGetTime();
    tick = GetTickCount();
    probe("time", "tick", (mm > tick ? mm - tick : tick - mm) < 1000 ? "near" : "far");

    /* The least of eight steps, so that a moment the probe was not running
     * does not count as the clock's step. */
    least = 0xffffffffL;
    for (count = 0; count < 8; count++) {
        then = timeGetTime();
        tick = GetTickCount();
        while ((step = timeGetTime() - then) == 0 && GetTickCount() - tick < 1000) {
        }
        if (step < least) {
            least = step;
        }
    }
    probe("time", "step", least < 10 ? "fine" : "coarse");

    time.wType = TIME_MS;
    answer = timeGetSystemTime(&time, sizeof(time));
    wsprintf(probeResult, "%u %u", answer, time.wType);
    probe("system", "ms", probeResult);

    time.wType = TIME_SAMPLES;
    answer = timeGetSystemTime(&time, sizeof(time));
    wsprintf(probeResult, "%u %u", answer, time.wType);
    probe("system", "samples", probeResult);

    event("oneshot", 0, 50, TIME_ONESHOT);
    event("periodic", 1, 100, TIME_PERIODIC);
    event("zero", 2, 0, TIME_ONESHOT);
    wait(1500);

    called("oneshot", 0);
    called("periodic", 1);
    called("zero", 2);

    wsprintf(probeResult, "%u", timeKillEvent(ids[1]));
    probe("kill", "periodic", probeResult);
    calls[1] = 0;
    wait(500);
    called("after-kill", 1);

    wsprintf(probeResult, "%u", timeKillEvent(ids[0]));
    probe("kill", "oneshot-done", probeResult);
    wsprintf(probeResult, "%u", timeKillEvent(0x7777));
    probe("kill", "none", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
