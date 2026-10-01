/*
 * Which window is made active when the active window is destroyed, as Bago
 * destroys the pop-up it shows while it reads its dictionary.
 *
 * `A` is an overlapped window, shown and active. `E` is a visible pop-up A
 * owns, as Bago's egg timer is, made with `WS_VISIBLE`.
 *
 * * `owned`: `P`, a visible pop-up A owns, made after E -- it is made
 *   active -- then destroyed.
 * * `unowned`: the same, with P owned by nothing.
 * * `before`: P made, and made active, before E.
 * * `child`: P owning a pop-up of its own, `Q`, made after it, then P
 *   destroyed (Q with it).
 *
 * For each, the active window by name after P is made, and after it is
 * destroyed.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ACTNEXT.OUT"

static HWND a;
static HWND e;
static HWND p;
static HWND q;

static LPCSTR nameOf(HWND hwnd)
{
    if (hwnd == a) return "A";
    if (hwnd == e) return "E";
    if (hwnd == p) return "P";
    if (hwnd == q) return "Q";
    if (hwnd == NULL) return "0";
    return "other";
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static HWND popup(HINSTANCE instance, LPCSTR title, int x, HWND owner)
{
    HWND made = CreateWindow("ActNext", title, WS_POPUP | WS_CAPTION | WS_VISIBLE, x, 200, 120, 80,
                             owner, NULL, instance, NULL);

    pump();
    return made;
}

static void run(HINSTANCE instance, LPCSTR name, int kind)
{
    a = CreateWindow("ActNext", "A", WS_OVERLAPPEDWINDOW, 20, 20, 300, 150, NULL, NULL, instance,
                     NULL);
    ShowWindow(a, SW_SHOWNORMAL);
    UpdateWindow(a);
    pump();
    q = NULL;

    if (kind == 2) {
        p = popup(instance, "P", 300, a);
        e = popup(instance, "E", 160, a);
        SetActiveWindow(p);
    } else {
        e = popup(instance, "E", 160, a);
        p = popup(instance, "P", 300, kind == 1 ? NULL : a);
    }

    if (kind == 3) {
        q = popup(instance, "Q", 440, p);
    }

    pump();
    wsprintf(probeArgs, "%s,made", name);
    probe("active", probeArgs, nameOf(GetActiveWindow()));

    DestroyWindow(p);
    pump();
    wsprintf(probeArgs, "%s,destroyed", name);
    probe("active", probeArgs, nameOf(GetActiveWindow()));

    DestroyWindow(e);
    DestroyWindow(a);
    pump();
    a = e = p = q = NULL;
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
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ActNext";
    RegisterClass(&kind);

    run(instance, "owned", 0);
    run(instance, "unowned", 1);
    run(instance, "before", 2);
    run(instance, "child", 3);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
