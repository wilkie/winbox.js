/*
 * `LoadString` into buffers of different sizes.
 *
 * USER's string 4 is "CursorBlinkRate", fifteen characters. It is loaded from
 * USER itself into a buffer of each size, with a guard byte after the buffer:
 *
 * * `sized`: for each size, what `LoadString` answers, what the buffer holds,
 *   and whether the guard byte after it was touched.
 * * `missing`: a string USER does not have.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOADSTR.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int SIZES[] = { 0, 1, 2, 5, 15, 16, 17, 40 };
    HINSTANCE user = GetModuleHandle("USER");
    char buffer[64];
    int index;

    probeOpen(OUTPUT);

    for (index = 0; index < sizeof(SIZES) / sizeof(SIZES[0]); index++) {
        int size = SIZES[index];
        int answer;
        int at;

        for (at = 0; at < sizeof(buffer); at++) {
            buffer[at] = '#';
        }

        answer = LoadString(user, 4, buffer, size);

        /* What the buffer holds up to its first zero, or all of it if none. */
        buffer[sizeof(buffer) - 1] = '\0';

        wsprintf(probeArgs, "%d", size);
        wsprintf(probeResult, "answer=%d,text=%s,guard=%c", answer, (LPSTR)buffer,
                 buffer[size] == '#' ? '1' : '0');
        probe("sized", probeArgs, probeResult);
    }

    buffer[0] = '#';
    buffer[1] = '\0';
    wsprintf(probeResult, "answer=%d,first=%c", LoadString(user, 9999, buffer, 40), buffer[0]);
    probe("missing", "9999", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
