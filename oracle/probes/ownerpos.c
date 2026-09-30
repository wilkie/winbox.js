/*
 * A hidden owner as the Visual Basic runtime makes one, and a window it
 * owns: what `GetParent` answers for the owned window, and where the owner
 * is, as the runtime asks when it places a form.
 *
 * `M` is made as the runtime's main window is: a pop-up with a system menu,
 * at (320, 240), nought by nought, then `ShowWindow(SW_SHOWNOACTIVATE)`.
 * `F` is an overlapped window with a sizing frame, `M` its owner, at
 * (20, 55), 599 by 371.
 *
 * * `parent`: `GetParent(F)`, as `M`, `0` or `other`; the same of a pop-up
 *   `M` owns; `GetWindow(F, GW_OWNER)`.
 * * `rect`: `GetWindowRect` and `GetClientRect` of `M`, and `M`'s
 *   visibility.
 * * `screen`: `ScreenToClient(M)` of (20, 55), and `ClientToScreen(M)` of
 *   (0, 0).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\OWNERPOS.OUT"

static HWND m;

static LPCSTR nameOf(HWND hwnd)
{
    if (hwnd == m) return "M";
    if (hwnd == NULL) return "0";
    return "other";
}

static void rect(LPCSTR name, RECT *r)
{
    wsprintf(probeResult, "%d,%d,%d,%d", r->left, r->top, r->right, r->bottom);
    probe("rect", name, probeResult);
}

static void kind(HINSTANCE instance, LPCSTR name)
{
    WNDCLASS k;

    k.style = 0;
    k.lpfnWndProc = DefWindowProc;
    k.cbClsExtra = 0;
    k.cbWndExtra = 0;
    k.hInstance = instance;
    k.hIcon = NULL;
    k.hCursor = LoadCursor(NULL, IDC_ARROW);
    k.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    k.lpszMenuName = NULL;
    k.lpszClassName = name;
    RegisterClass(&k);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND f;
    RECT r;
    POINT p;

    probeOpen(OUTPUT);

    kind(instance, "OwnerPosM");
    kind(instance, "OwnerPosF");

    m = CreateWindow("OwnerPosM", "", WS_POPUP | WS_SYSMENU, 320, 240, 0, 0, NULL, NULL, instance,
                     NULL);
    ShowWindow(m, SW_SHOWNOACTIVATE);
    f = CreateWindow("OwnerPosF", "F", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, 20, 55, 599, 371, m,
                     NULL, instance, NULL);

    probe("parent", "GetParent", nameOf(GetParent(f)));
    {
        HWND popup = CreateWindow("OwnerPosF", "P", WS_POPUP | WS_CAPTION, 40, 40, 100, 80, m, NULL,
                                  instance, NULL);

        probe("parent", "GetParent(popup)", nameOf(GetParent(popup)));
        DestroyWindow(popup);
    }
    probe("parent", "GW_OWNER", nameOf(GetWindow(f, GW_OWNER)));

    GetWindowRect(m, &r);
    rect("window", &r);
    GetClientRect(m, &r);
    rect("client", &r);
    probe("rect", "visible", IsWindowVisible(m) ? "yes" : "no");

    p.x = 20;
    p.y = 55;
    ScreenToClient(m, &p);
    wsprintf(probeResult, "%d,%d", p.x, p.y);
    probe("screen", "ScreenToClient", probeResult);

    p.x = 0;
    p.y = 0;
    ClientToScreen(m, &p);
    wsprintf(probeResult, "%d,%d", p.x, p.y);
    probe("screen", "ClientToScreen", probeResult);

    DestroyWindow(f);
    DestroyWindow(m);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
