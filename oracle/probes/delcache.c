/*
 * `DeleteDC` of a device context USER lent from its cache (`GetDC`). A
 * shareware setup (the compatibility catalog's `win3_SoliXl3x`) deletes
 * the context it was lent; File Manager is then lent the same context by
 * `GetDC` and measures text in it.
 *
 * * `delete`: what `DeleteDC` answers for the lent context.
 * * `extent`: `GetTextExtent` of "abc" in it after, nonzero or nought.
 * * `release`: what `ReleaseDC` answers for it after.
 * * `again`: whether the next `GetDC` of the window lends the same
 *   handle (`same`, else `other`), and `extent2` the text measured in it.
 * * `memory`: `DeleteDC` of a context the probe made (`CreateCompatibleDC`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DELCACHE.OUT"

static void answer(LPCSTR function, LPCSTR args, int value)
{
    wsprintf(probeResult, "%d", value);
    probe(function, args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND window;
    HDC hdc;
    HDC again;
    HDC memory;

    probeOpen(OUTPUT);
    window = CreateWindow("STATIC", "delcache", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 200,
                          100, NULL, NULL, instance, NULL);

    hdc = GetDC(window);
    answer("delete", "GetDC", DeleteDC(hdc));
    probe("extent", "after", (LPSTR)(GetTextExtent(hdc, "abc", 3) ? "nonzero" : "0"));
    answer("release", "after", ReleaseDC(window, hdc));

    again = GetDC(window);
    probe("again", "GetDC", (LPSTR)(again == hdc ? "same" : "other"));
    probe("extent2", "again", (LPSTR)(GetTextExtent(again, "abc", 3) ? "nonzero" : "0"));
    ReleaseDC(window, again);

    memory = CreateCompatibleDC(NULL);
    answer("memory", "CreateCompatibleDC", DeleteDC(memory));

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
