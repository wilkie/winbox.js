/*
 * Owners and parents: a window at the top, a pop-up it owns, a child of it,
 * and a pop-up owned by the child.
 *
 * * `owner`: GetWindow with GW_OWNER, as the window's title, or `-`.
 * * `parent`: GetParent, and GetWindowWord's GWW_HWNDPARENT, the same way.
 * * `order`: the windows at the top of the probe's own, front to back, after
 *   each step.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\OWNERS.OUT"

static HWND windows[5];
static char *names[5] = { "A", "P", "C", "Q", "B" };

static LPSTR nameOf(HWND window)
{
    int i;

    if (!window) {
        return "-";
    }

    for (i = 0; i < 5; i++) {
        if (windows[i] == window) {
            return names[i];
        }
    }

    return window == GetDesktopWindow() ? "desktop" : "?";
}

static void order(LPCSTR when)
{
    HWND window = GetWindow(GetDesktopWindow(), GW_CHILD);
    char text[40];

    text[0] = '\0';

    while (window) {
        LPSTR name = nameOf(window);

        if (name[0] != '?') {
            lstrcat(text, name);
        }

        window = GetWindow(window, GW_HWNDNEXT);
    }

    probe("order", when, text);
}

static void relations(void)
{
    char label[20];
    int i;

    for (i = 0; i < 4; i++) {
        wsprintf(label, "%s", (LPSTR)names[i]);
        probe("owner", label, nameOf(GetWindow(windows[i], GW_OWNER)));
        wsprintf(label, "%s GetParent", (LPSTR)names[i]);
        probe("parent", label, nameOf(GetParent(windows[i])));
        wsprintf(label, "%s GWW_HWNDPARENT", (LPSTR)names[i]);
        probe("parent", label, nameOf((HWND)GetWindowWord(windows[i], GWW_HWNDPARENT)));
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Owners";
    RegisterClass(&kind);

    windows[0] = CreateWindow("Owners", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
                              NULL, NULL, instance, NULL);
    windows[1] = CreateWindow("Owners", "P", WS_POPUP | WS_CAPTION | WS_VISIBLE, 200, 150, 150,
                              100, windows[0], NULL, instance, NULL);
    windows[2] = CreateWindow("Owners", "C", WS_CHILD | WS_BORDER | WS_VISIBLE, 10, 10, 100, 60,
                              windows[0], NULL, instance, NULL);
    windows[3] = CreateWindow("Owners", "Q", WS_POPUP | WS_CAPTION | WS_VISIBLE, 250, 250, 150,
                              100, windows[2], NULL, instance, NULL);
    relations();
    order("made");

    windows[4] = CreateWindow("Owners", "B", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 300, 60, 300,
                              200, NULL, NULL, instance, NULL);
    order("another window made");

    SetActiveWindow(windows[0]);
    order("owner activated");

    BringWindowToTop(windows[0]);
    order("owner brought to top");

    SetActiveWindow(windows[4]);
    order("other activated");

    ShowWindow(windows[0], SW_MINIMIZE);
    order("owner minimized");
    probe("visible", "P with owner minimized", (LPSTR)(IsWindowVisible(windows[1]) ? "yes" : "no"));

    ShowWindow(windows[0], SW_RESTORE);
    order("owner restored");
    probe("visible", "P with owner restored", (LPSTR)(IsWindowVisible(windows[1]) ? "yes" : "no"));

    DestroyWindow(windows[0]);
    probe("destroyed", "P with owner",
          (LPSTR)(IsWindow(windows[1]) ? "still there" : "gone"));
    probe("destroyed", "Q with owner's owner",
          (LPSTR)(IsWindow(windows[3]) ? "still there" : "gone"));
    DestroyWindow(windows[4]);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
