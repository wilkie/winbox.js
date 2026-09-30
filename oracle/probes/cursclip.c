/*
 * What `ClipCursor` does to the cursor, and to the rectangle it is given:
 *
 * * `pos`: `GetCursorPos` after each `SetCursorPos`, as "x,y", with the
 *   clip named in the arguments: none, (10, 20)-(300, 200), and so on.
 * * `onset`: where the cursor is right after `ClipCursor` of (10, 20)-(300,
 *   200) when it was at (500, 400), outside it.
 * * `rect`: `GetClipCursor` after `ClipCursor` of a rectangle partly off the
 *   screen, and of one whose right and bottom come before its left and top.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CURSCLIP.OUT"

static void at(LPCSTR clip, int x, int y)
{
    POINT p;

    SetCursorPos(x, y);
    GetCursorPos(&p);
    wsprintf(probeArgs, "%s %d,%d", clip, x, y);
    wsprintf(probeResult, "%d,%d", p.x, p.y);
    probe("pos", probeArgs, probeResult);
}

static void clipTo(int left, int top, int right, int bottom)
{
    RECT r;

    SetRect(&r, left, top, right, bottom);
    ClipCursor(&r);
}

static void rect(LPCSTR args)
{
    RECT r;

    GetClipCursor(&r);
    wsprintf(probeResult, "%d,%d,%d,%d", r.left, r.top, r.right, r.bottom);
    probe("rect", args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    POINT p;

    probeOpen(OUTPUT);

    ClipCursor(NULL);
    at("none", 100, 100);
    at("none", -5, -5);
    at("none", 700, 500);
    at("none", 639, 479);
    at("none", 640, 480);

    SetCursorPos(500, 400);
    clipTo(10, 20, 300, 200);
    GetCursorPos(&p);
    wsprintf(probeResult, "%d,%d", p.x, p.y);
    probe("onset", "500,400", probeResult);

    at("10,20,300,200", 100, 100);
    at("10,20,300,200", 0, 0);
    at("10,20,300,200", 1000, 1000);
    at("10,20,300,200", 299, 199);
    at("10,20,300,200", 300, 200);
    at("10,20,300,200", 9, 150);

    clipTo(-50, -50, 700, 500);
    rect("-50,-50,700,500");
    at("-50,-50,700,500", -10, -10);
    at("-50,-50,700,500", 800, 600);

    clipTo(200, 200, 100, 100);
    rect("200,200,100,100");
    at("200,200,100,100", 50, 50);
    at("200,200,100,100", 150, 150);
    at("200,200,100,100", 250, 250);

    clipTo(100, 100, 100, 100);
    rect("100,100,100,100");
    at("100,100,100,100", 50, 50);

    ClipCursor(NULL);
    rect("released");
    at("released", 600, 450);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
