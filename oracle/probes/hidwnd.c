/*
 * USER's own windows at the top, walked with GetWindow from the desktop's
 * first child: before the probe makes a window of its own, and after.
 *
 * * `top`: each window in turn, front to back, as its class, its title in
 *   quotes, its style and extended style in hex, its window rectangle,
 *   `v` or `h` for visible or hidden, `mine` or `other` for its task, and
 *   its owner's class, or `-` for none.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HIDWND.OUT"

static void walk(LPCSTR when)
{
    HWND window = GetWindow(GetDesktopWindow(), GW_CHILD);
    char name[40];
    char title[40];
    char owner[40];
    char label[60];
    RECT area;
    HWND by;
    int i = 0;

    while (window && i < 20) {
        GetClassName(window, name, sizeof(name));
        GetWindowText(window, title, sizeof(title));
        GetWindowRect(window, &area);
        by = GetWindow(window, GW_OWNER);
        owner[0] = '\0';

        if (by) {
            GetClassName(by, owner, sizeof(owner));
        } else {
            lstrcpy(owner, "-");
        }

        wsprintf(probeResult, "%s \"%s\" %lx %lx {%d,%d,%d,%d} %s %s %s", (LPSTR)name,
                 (LPSTR)title, GetWindowLong(window, GWL_STYLE),
                 GetWindowLong(window, GWL_EXSTYLE), area.left, area.top, area.right,
                 area.bottom, (LPSTR)(IsWindowVisible(window) ? "v" : "h"),
                 (LPSTR)(GetWindowTask(window) == GetCurrentTask() ? "mine" : "other"),
                 (LPSTR)owner);
        wsprintf(label, "%s %d", when, i);
        probe("top", label, probeResult);
        window = GetWindow(window, GW_HWNDNEXT);
        i++;
    }

    wsprintf(label, "%s", when);
    wsprintf(probeResult, "%d", i);
    probe("count", label, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;

    probeOpen(OUTPUT);
    walk("at start");

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Mine";
    RegisterClass(&kind);

    window = CreateWindow("Mine", "Mine", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 40, 300, 200,
                          NULL, NULL, instance, NULL);
    UpdateWindow(window);
    walk("with a window");

    DestroyWindow(window);
    walk("after it");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
