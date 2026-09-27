/*
 * The escapes a display driver answers, through GDI's Escape:
 *
 * * `support`: the escapes from 0 to 255, and some past, that
 *   QUERYESCSUPPORT says the screen's and a memory DC's driver has, as a
 *   list of numbers with each one's answer after an `=` when it is not 1.
 * * `trails`: MOUSETRAILS asked for the trail's length, and its answer.
 * * `unknown`: an escape the driver does not have, called.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ESCAPES.OUT"

static char list[1200];

static void support(LPCSTR what, HDC dc)
{
    static const int more[] = { 256, 512, 1024, 2048, 4096, 4097, 4098, 4099, 4100, 4101,
                                4102, 4103, 4104, 4105, 4106, 4107, 4108, 4109, 4110, 4111,
                                4112, 4113, 4114, 4115, 4116, 4117, 4118, 4119, 4120, 4121,
                                4122, 4123, 4124, 4125, 4126, 4127, 4128, 32767, -1 };
    char one[20];
    int escape;
    int i;
    int answer;

    list[0] = '\0';

    for (i = -1; i < 256 + (int)(sizeof(more) / sizeof(more[0])); i++) {
        escape = i < 256 ? i : more[i - 256];

        if (i == -1) {
            escape = -2;
        }

        answer = Escape(dc, QUERYESCSUPPORT, sizeof(int), (LPSTR)&escape, NULL);

        if (answer) {
            if (answer == 1) {
                wsprintf(one, "%d,", escape);
            } else {
                wsprintf(one, "%d=%d,", escape, answer);
            }

            lstrcat(list, one);
        }
    }

    probe("support", what, list[0] ? list : "none");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC memory;
    int length;
    int answer;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    support("screen", screen);
    support("memory", memory);

    length = -99;
    answer = Escape(screen, MOUSETRAILS, 0, NULL, (LPSTR)&length);
    wsprintf(probeResult, "%d:%d", answer, length);
    probe("trails", "screen, out", probeResult);

    answer = Escape(screen, 7777, 0, NULL, NULL);
    wsprintf(probeResult, "%d", answer);
    probe("unknown", "7777", probeResult);

    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
