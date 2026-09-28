/*
 * Moving several windows at once: BeginDeferWindowPos, DeferWindowPos and
 * EndDeferWindowPos, as MFC's programs lay out their tool and status bars.
 *
 * Three child windows, `a`, `b` and `c`, of a hidden parent.
 *
 * * `answer`: what each call answered: a handle as `handle`, or as `same`
 *   when it is the one the step began with; a number otherwise.
 * * `order`: the messages the children were sent during `EndDeferWindowPos`,
 *   each as the child's letter and the message in hex; `none` for none.
 * * `rect`: each child's place in its parent afterwards, as
 *   `left,top,right,bottom`.
 * * `during`: what `DeferWindowPos` sent, before the end: `none` for none.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\DEFER.OUT"

static HWND parent;
static HWND kids[3];
static char order[1200];

static void add(LPCSTR one)
{
    if (lstrlen(order) + lstrlen(one) < sizeof(order) - 1) {
        lstrcat(order, one);
    }
}

LRESULT FAR PASCAL _export KidProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[20];
    int i;

    for (i = 0; i < 3; i++) {
        if (kids[i] == window) {
            wsprintf(one, "%s%c%x", (LPSTR)(order[0] ? " " : ""), 'a' + i, message);
            add(one);
        }
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void rects(LPCSTR step)
{
    RECT rect;
    char one[60];
    int i;

    probeResult[0] = '\0';

    for (i = 0; i < 3; i++) {
        GetWindowRect(kids[i], &rect);
        ScreenToClient(parent, (POINT FAR *)&rect.left);
        ScreenToClient(parent, (POINT FAR *)&rect.right);
        wsprintf(one, "%s%c:%d,%d,%d,%d", (LPSTR)(i ? " " : ""), 'a' + i, rect.left, rect.top,
                 rect.right, rect.bottom);
        lstrcat(probeResult, one);
    }

    probe("rect", step, probeResult);
}

static void answer(LPCSTR name, HDWP first, HDWP got)
{
    if (!got) {
        lstrcpy(probeResult, "0");
    } else if (got == first) {
        lstrcpy(probeResult, "same");
    } else {
        lstrcpy(probeResult, "handle");
    }

    probe("answer", name, probeResult);
}

static void seen(LPCSTR function, LPCSTR step)
{
    probe(function, step, order[0] ? order : "none");
    order[0] = '\0';
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HDWP first;
    HDWP now;
    int i;

    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.lpszClassName = "DeferTop";
    RegisterClass(&kind);

    kind.lpfnWndProc = KidProc;
    kind.lpszClassName = "DeferKid";
    RegisterClass(&kind);

    parent = CreateWindow("DeferTop", "Defer", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, 0, 0, 400,
                          300, NULL, NULL, instance, NULL);

    for (i = 0; i < 3; i++) {
        kids[i] = CreateWindow("DeferKid", "", WS_CHILD | WS_VISIBLE, 10 + i * 50, 10, 40, 30, parent,
                               (HMENU)(100 + i), instance, NULL);
    }

    order[0] = '\0';
    rects("before");

    /* Two asked for, three given, in the order c, a, b. */
    first = BeginDeferWindowPos(2);
    answer("begin", 0, first);

    now = DeferWindowPos(first, kids[2], NULL, 200, 100, 60, 40, SWP_NOZORDER | SWP_NOACTIVATE);
    answer("defer-c", first, now);
    now = DeferWindowPos(now, kids[0], NULL, 20, 120, 50, 20, SWP_NOZORDER | SWP_NOACTIVATE);
    answer("defer-a", first, now);
    now = DeferWindowPos(now, kids[1], NULL, 90, 150, 30, 30, SWP_NOZORDER | SWP_NOACTIVATE);
    answer("defer-b", first, now);
    seen("during", "three");

    wsprintf(probeResult, "%d", EndDeferWindowPos(now));
    probe("answer", "end", probeResult);
    seen("order", "three");
    rects("three");

    /* The same window twice: which place it ends in. Moves only, and one
     * that changes nothing. */
    first = BeginDeferWindowPos(1);
    now = DeferWindowPos(first, kids[0], NULL, 5, 5, 0, 0,
                         SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOSIZE);
    now = DeferWindowPos(now, kids[0], NULL, 7, 9, 0, 0,
                         SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOSIZE);
    now = DeferWindowPos(now, kids[1], NULL, 90, 150, 30, 30, SWP_NOZORDER | SWP_NOACTIVATE);
    answer("twice", first, now);
    wsprintf(probeResult, "%d", EndDeferWindowPos(now));
    probe("answer", "end-twice", probeResult);
    seen("order", "twice");
    rects("twice");

    /* A handle that is no window's. */
    first = BeginDeferWindowPos(1);
    now = DeferWindowPos(first, (HWND)0x1234, NULL, 1, 1, 1, 1, SWP_NOZORDER | SWP_NOACTIVATE);
    answer("bad", first, now);
    seen("order", "bad");

    /* Nothing deferred. */
    first = BeginDeferWindowPos(0);
    answer("begin-none", 0, first);
    wsprintf(probeResult, "%d", EndDeferWindowPos(first));
    probe("answer", "end-none", probeResult);

    DestroyWindow(parent);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
