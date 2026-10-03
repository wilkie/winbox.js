/*
 * How `GetTickCount` steps: polled as fast as a program can for a second,
 * the least and the most it moved between two answers that differ, and how
 * many different answers there were. SimTower polls it some fourteen times
 * a message, and paces itself by what it sees.
 *
 * * `step`: the least and the most step, in milliseconds, and the count of
 *   different answers in the second, as `least,most,answers`.
 * * `steps`: the first 40 steps, in turn, and each answer's remainder by 55
 *   with them, as `step:remainder`; where in a tick the answers fall.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TICKSTEP.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD start;
    DWORD last;
    DWORD now;
    DWORD least = 0xffffffffL;
    DWORD most = 0;
    long answers = 0;
    static char steps[512];
    int taken = 0;

    probeOpen(OUTPUT);

    start = GetTickCount();
    last = start;

    do {
        now = GetTickCount();

        if (now != last) {
            DWORD step = now - last;

            if (step < least) {
                least = step;
            }

            if (step > most) {
                most = step;
            }

            answers++;

            if (taken < 40) {
                wsprintf(steps + lstrlen(steps), taken ? ",%ld:%ld" : "%ld:%ld", step, now % 55);
                taken++;
            }

            last = now;
        }
    } while (now - start < 1000 || taken < 40);

    wsprintf(probeResult, "%ld,%ld,%ld", least, most, answers);
    probe("step", "1000", probeResult);
    probe("steps", "40", steps);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
