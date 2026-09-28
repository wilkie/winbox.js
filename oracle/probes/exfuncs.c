/*
 * The Ex forms of the mapping functions, GetCurrentPositionEx and
 * GetBrushOrgEx: each what it answers, and the POINT or SIZE it fills, as
 * `answer x,y` -- the structure starts as -1,-1, so one left alone shows.
 * As Championship Slots of the corpus sets its viewport's origin and asks
 * where its pen is.
 *
 * In order, on one memory device context in MM_ANISOTROPIC, then in
 * MM_TEXT; then with no structure, and with no device context. Each record
 * is closed into the file, so a call that ends the probe leaves the records
 * before it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EXFUNCS.OUT"

static POINT point;

static void record(LPCSTR function, LPCSTR args, BOOL answer)
{
    wsprintf(probeResult, "%d %d,%d", answer, point.x, point.y);
    probe(function, args, probeResult);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
    point.x = point.y = -1;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC dc;

    probeOpen(OUTPUT);
    point.x = point.y = -1;

    screen = GetDC(NULL);
    dc = CreateCompatibleDC(screen);
    SetMapMode(dc, MM_ANISOTROPIC);

    record("SetWindowOrgEx", "10,20", SetWindowOrgEx(dc, 10, 20, &point));
    record("GetWindowOrgEx", "", GetWindowOrgEx(dc, &point));
    record("OffsetWindowOrgEx", "1,2", OffsetWindowOrgEx(dc, 1, 2, &point));
    record("GetWindowOrgEx", "offset", GetWindowOrgEx(dc, &point));
    record("SetWindowExtEx", "100,200", SetWindowExtEx(dc, 100, 200, (SIZE FAR *)&point));
    record("GetWindowExtEx", "", GetWindowExtEx(dc, (SIZE FAR *)&point));
    record("SetViewportOrgEx", "5,6", SetViewportOrgEx(dc, 5, 6, &point));
    record("GetViewportOrgEx", "", GetViewportOrgEx(dc, &point));
    record("OffsetViewportOrgEx", "-1,-2", OffsetViewportOrgEx(dc, -1, -2, &point));
    record("GetViewportOrgEx", "offset", GetViewportOrgEx(dc, &point));
    record("SetViewportExtEx", "300,400", SetViewportExtEx(dc, 300, 400, (SIZE FAR *)&point));
    record("GetViewportExtEx", "", GetViewportExtEx(dc, (SIZE FAR *)&point));
    record("ScaleViewportExtEx", "1/2,3/4",
           ScaleViewportExtEx(dc, 1, 2, 3, 4, (SIZE FAR *)&point));
    record("GetViewportExtEx", "scaled", GetViewportExtEx(dc, (SIZE FAR *)&point));
    record("ScaleWindowExtEx", "2/1,4/3", ScaleWindowExtEx(dc, 2, 1, 4, 3, (SIZE FAR *)&point));
    record("GetWindowExtEx", "scaled", GetWindowExtEx(dc, (SIZE FAR *)&point));

    MoveTo(dc, 7, 8);
    record("GetCurrentPositionEx", "7,8", GetCurrentPositionEx(dc, &point));
    SetBrushOrg(dc, 3, 4);
    record("GetBrushOrgEx", "3,4", GetBrushOrgEx(dc, &point));

    SetMapMode(dc, MM_TEXT);
    record("SetWindowExtEx", "text", SetWindowExtEx(dc, 50, 60, (SIZE FAR *)&point));
    record("GetWindowExtEx", "text", GetWindowExtEx(dc, (SIZE FAR *)&point));
    record("SetViewportExtEx", "text", SetViewportExtEx(dc, 50, 60, (SIZE FAR *)&point));
    record("ScaleViewportExtEx", "text", ScaleViewportExtEx(dc, 1, 2, 1, 2, (SIZE FAR *)&point));
    record("SetViewportOrgEx", "text", SetViewportOrgEx(dc, 9, 9, &point));

    record("SetViewportOrgEx", "no-point", SetViewportOrgEx(dc, 0, 0, NULL));
    record("GetViewportOrgEx", "after-no-point", GetViewportOrgEx(dc, &point));
    record("SetWindowOrgEx", "no-dc", SetWindowOrgEx(NULL, 1, 1, &point));
    record("GetCurrentPositionEx", "no-dc", GetCurrentPositionEx(NULL, &point));
    record("GetWindowOrgEx", "no-dc", GetWindowOrgEx(NULL, &point));
    record("GetViewportExtEx", "no-dc", GetViewportExtEx(NULL, (SIZE FAR *)&point));
    record("GetBrushOrgEx", "no-dc", GetBrushOrgEx(NULL, &point));
    record("OffsetViewportOrgEx", "no-dc", OffsetViewportOrgEx(NULL, 1, 1, &point));
    record("ScaleWindowExtEx", "no-dc", ScaleWindowExtEx(NULL, 1, 1, 1, 1, (SIZE FAR *)&point));
    record("GetViewportOrgEx", "no-point", GetViewportOrgEx(dc, NULL));
    record("GetCurrentPositionEx", "no-point", GetCurrentPositionEx(dc, NULL));

    DeleteDC(dc);
    ReleaseDC(NULL, screen);
    record("survived", "all", 1);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
