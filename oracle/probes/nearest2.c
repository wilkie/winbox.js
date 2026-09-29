/*
 * GetNearestColor over a cube of colours, eight levels a side -- 0, 36, 73,
 * 109, 146, 182, 219 and 255 -- and the colours of Championship Slots' blue
 * ball of the corpus: which of the display's colours each is drawn as, the
 * rule CreateDIBitmap follows too (`dibmap`).
 *
 * * `nearest`: the colour, as `rrggbb`; what GetNearestColor answered.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NEAREST2.OUT"

static HDC screen;

static void ask(int red, int green, int blue)
{
    COLORREF answer = GetNearestColor(screen, RGB(red, green, blue));

    wsprintf(probeArgs, "%02x%02x%02x", red, green, blue);
    wsprintf(probeResult, "%02x%02x%02x", GetRValue(answer), GetGValue(answer),
             GetBValue(answer));
    probe("nearest", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int LEVELS[8] = {0, 36, 73, 109, 146, 182, 219, 255};
    int r;
    int g;
    int b;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    for (r = 0; r < 8; r++) {
        for (g = 0; g < 8; g++) {
            for (b = 0; b < 8; b++) {
                ask(LEVELS[r], LEVELS[g], LEVELS[b]);
            }
        }
    }

    ask(44, 123, 177);
    ask(24, 86, 85);
    ask(38, 133, 125);
    ask(41, 148, 99);
    ask(14, 66, 156);
    ask(70, 88, 158);

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
