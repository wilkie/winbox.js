/*
 * `EnumObjects`: the pens and brushes a display offers, as Paintbrush asks.
 *
 * * `objects`: for pens and for brushes, what `EnumObjects` answered, how
 *   many the callback was given, and each: a pen as `style/width/rrggbb`, a
 *   brush as `style/rrggbb/hatch`.
 * * `stopped`: what `EnumObjects` answered when the callback answered
 *   nought at the third, and how many it was given.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ENUMOBJ.OUT"

static char list[3000];
static int count;
static int stopAt;

int FAR PASCAL _export PenProc(LPLOGPEN pen, LPARAM data)
{
    char one[32];

    count++;

    if (lstrlen(list) < 2900) {
        wsprintf(one, "%s%u/%d/%06lx", (LPSTR)(list[0] ? "," : ""), pen->lopnStyle,
                 pen->lopnWidth.x, pen->lopnColor & 0xffffffL);
        lstrcat(list, one);
    }

    return stopAt && count >= stopAt ? 0 : 1;
}

int FAR PASCAL _export BrushProc(LPLOGBRUSH brush, LPARAM data)
{
    char one[32];

    count++;

    if (lstrlen(list) < 2900) {
        wsprintf(one, "%s%u/%06lx/%d", (LPSTR)(list[0] ? "," : ""), brush->lbStyle,
                 brush->lbColor & 0xffffffL, brush->lbHatch);
        lstrcat(list, one);
    }

    return stopAt && count >= stopAt ? 0 : 1;
}

static void run(LPCSTR name, HDC dc, int kind, FARPROC proc, int stop)
{
    int answer;

    list[0] = '\0';
    count = 0;
    stopAt = stop;
    answer = EnumObjects(dc, kind, (GOBJENUMPROC)proc, 0L);

    if (stop) {
        wsprintf(probeResult, "%d,%d", answer, count);
        probe("stopped", name, probeResult);
    } else {
        wsprintf(probeResult, "%d,%d:", answer, count);
        lstrcat(probeResult, list);
        probe("objects", name, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    FARPROC pens;
    FARPROC brushes;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);
    pens = MakeProcInstance((FARPROC)PenProc, instance);
    brushes = MakeProcInstance((FARPROC)BrushProc, instance);

    run("pens", screen, OBJ_PEN, pens, 0);
    run("brushes", screen, OBJ_BRUSH, brushes, 0);
    run("pens", screen, OBJ_PEN, pens, 3);
    run("brushes", screen, OBJ_BRUSH, brushes, 3);

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
