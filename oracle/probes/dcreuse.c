/*
 * Which device context `GetDC` lends next, once one is given back: USER
 * lends from a cache of a few, and Program Manager, started minimized,
 * asks for the screen's after giving back its window's. Only whether two
 * handles are the same is recorded, never a handle.
 *
 * Two windows of the probe's own class, A and B, shown; and C, shown
 * minimized.
 *
 * * `screen`: A's given back, then `GetDC(NULL)`: `a` where it is A's
 *   handle, else `other`.
 * * `window`: the screen's given back, then `GetDC(B)`: `screen`, `a` or
 *   `other`.
 * * `order`: A's and B's held at once, given back A's first, then B's,
 *   then `GetDC(NULL)`: `a` (given back first), `b` (last) or `other`.
 * * `reverse`: the same, B's given back first.
 * * `minimized`: A's given back, then `GetDC(C)`, C minimized: `a` or
 *   `other`; then C's given back and `GetDC(NULL)`: `c` or `other`.
 * * `held`: six of the screen's held at once: how many differ.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DCREUSE.OUT"

static HWND make(HINSTANCE instance, int x, int show)
{
    HWND hwnd = CreateWindow("DcReuse", "DcReuse", WS_OVERLAPPEDWINDOW, x, 40, 120, 80,
                             NULL, NULL, instance, NULL);

    ShowWindow(hwnd, show);
    UpdateWindow(hwnd);
    return hwnd;
}

static LPCSTR which(HDC hdc, HDC first, LPCSTR firstName, HDC second, LPCSTR secondName)
{
    if (hdc == first) {
        return firstName;
    }

    if (second && hdc == second) {
        return secondName;
    }

    return "other";
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HWND a, b, c;
    HDC ha, hb, hs, hc, held[6];
    int i, j, distinct;

    probeOpen(OUTPUT);

    wc.style = 0;
    wc.lpfnWndProc = DefWindowProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = GetStockObject(WHITE_BRUSH);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "DcReuse";
    RegisterClass(&wc);

    a = make(instance, 20, SW_SHOWNORMAL);
    b = make(instance, 200, SW_SHOWNORMAL);
    c = make(instance, 380, SW_SHOWMINNOACTIVE);

    ha = GetDC(a);
    ReleaseDC(a, ha);
    hs = GetDC(NULL);
    probe("screen", "after a", which(hs, ha, "a", NULL, ""));
    ReleaseDC(NULL, hs);

    hb = GetDC(b);
    probe("window", "b after screen", which(hb, hs, "screen", ha, "a"));
    ReleaseDC(b, hb);

    ha = GetDC(a);
    hb = GetDC(b);
    ReleaseDC(a, ha);
    ReleaseDC(b, hb);
    hs = GetDC(NULL);
    probe("order", "a then b given back", which(hs, ha, "a", hb, "b"));
    ReleaseDC(NULL, hs);

    ha = GetDC(a);
    hb = GetDC(b);
    ReleaseDC(b, hb);
    ReleaseDC(a, ha);
    hs = GetDC(NULL);
    probe("reverse", "b then a given back", which(hs, ha, "a", hb, "b"));
    ReleaseDC(NULL, hs);

    ha = GetDC(a);
    ReleaseDC(a, ha);
    hc = GetDC(c);
    probe("minimized", "c after a", which(hc, ha, "a", NULL, ""));
    ReleaseDC(c, hc);
    hs = GetDC(NULL);
    probe("minimized", "screen after c", which(hs, hc, "c", NULL, ""));
    ReleaseDC(NULL, hs);

    for (i = 0; i < 6; i++) {
        held[i] = GetDC(NULL);
    }

    distinct = 0;

    for (i = 0; i < 6; i++) {
        for (j = 0; j < i && held[j] != held[i]; j++) {
        }

        if (j == i) {
            distinct++;
        }
    }

    wsprintf(probeResult, "%d", distinct);
    probe("held", "six of the screen's", probeResult);

    for (i = 0; i < 6; i++) {
        ReleaseDC(NULL, held[i]);
    }

    DestroyWindow(a);
    DestroyWindow(b);
    DestroyWindow(c);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
