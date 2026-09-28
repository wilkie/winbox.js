/*
 * More small calls the accessories' menus reach:
 *
 * * `popup`: GetLastActivePopup for an owner and its owned windows, as the
 *   letters of the windows: A the owner, P and Q owned pop-ups, C a child.
 * * `children`: EnumChildWindows' visits, in order, and its answer; `stop`
 *   when the procedure answers 0 at the second.
 * * `props`: EnumProps' visits, in order, as name=data (a number for an
 *   atom), and its answer; `none` for a window with none.
 * * `tasks`: EnumTaskWindows' visits and its answer, and whose task the
 *   window is.
 * * `windows`: EnumWindows' visits and its answer.
 * * `swap`: SwapMouseButton's answers, and SM_SWAPBUTTON after each.
 * * `async`: the virtual keys GetAsyncKeyState answers anything for.
 * * `beep`: MessageBeep for each kind returns, as `done`.
 * * `shrink`: LocalShrink's answer beside LocalCompact's, `same` or not.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MINIS3.OUT"

static HWND a;
static HWND p;
static HWND q;
static HWND c;
static HWND d;
static HWND e;
static char seen[400];
static int stopAt;
static int visits;

static char letter(HWND window)
{
    if (window == a) return 'A';
    if (window == p) return 'P';
    if (window == q) return 'Q';
    if (window == c) return 'C';
    if (window == d) return 'D';
    if (window == e) return 'E';
    return window ? '?' : '0';
}

BOOL CALLBACK __export Visit(HWND window, LPARAM lParam)
{
    char one[40];

    one[0] = letter(window);
    one[1] = '\0';

    /* Another window: its class's name, and whether it is shown. */
    if (one[0] == '?') {
        one[1] = '(';
        GetClassName(window, one + 2, 30);
        lstrcat(one, IsWindowVisible(window) ? ",shown)" : ")");
    }

    lstrcat(seen, one);
    visits++;
    (void)lParam;
    return visits != stopAt;
}

BOOL CALLBACK __export Prop(HWND window, LPCSTR name, HANDLE data)
{
    char one[40];

    if (HIWORD((DWORD)name)) {
        wsprintf(one, "%s=%u,", name, (UINT)data);
    } else {
        wsprintf(one, "#%u=%u,", LOWORD((DWORD)name), (UINT)data);
    }

    lstrcat(seen, one);
    visits++;
    (void)window;
    return visits != stopAt;
}

static void children(LPCSTR what, HWND parent, int stop)
{
    BOOL answer;

    seen[0] = '\0';
    visits = 0;
    stopAt = stop;
    answer = EnumChildWindows(parent, (WNDENUMPROC)Visit, 0L);
    wsprintf(probeResult, "%s:%d", (LPSTR)seen, answer);
    probe("children", what, probeResult);
}

static void props(LPCSTR what, HWND window, int stop)
{
    int answer;

    seen[0] = '\0';
    visits = 0;
    stopAt = stop;
    answer = EnumProps(window, (PROPENUMPROC)Prop);
    wsprintf(probeResult, "%s:%d", (LPSTR)(seen[0] ? seen : "none"), answer);
    probe("props", what, probeResult);
}

static void popup(LPCSTR what, HWND window)
{
    char one[2];

    one[0] = letter(GetLastActivePopup(window));
    one[1] = '\0';
    probe("popup", what, one);
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const UINT beeps[] = { 0, 0xffff, MB_ICONHAND, MB_ICONQUESTION, MB_ICONEXCLAMATION,
                                  MB_ICONASTERISK };
    WNDCLASS kind;
    char keys[600];
    char one[8];
    BOOL answer;
    int i;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Minis3";
    RegisterClass(&kind);

    a = CreateWindow("Minis3", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 200, 150, NULL, NULL,
                     instance, NULL);
    c = CreateWindow("Minis3", "C", WS_CHILD | WS_VISIBLE, 0, 0, 50, 50, a, (HMENU)1, instance,
                     NULL);
    d = CreateWindow("Minis3", "D", WS_CHILD | WS_VISIBLE, 60, 0, 50, 50, a, (HMENU)2, instance,
                     NULL);
    e = CreateWindow("Minis3", "E", WS_CHILD | WS_VISIBLE, 0, 0, 20, 20, c, (HMENU)3, instance,
                     NULL);

    popup("owner alone", a);
    popup("child", c);

    p = CreateWindow("Minis3", "P", WS_POPUP | WS_CAPTION | WS_VISIBLE, 20, 20, 80, 60, a, NULL,
                     instance, NULL);
    popup("owner, popup shown", a);
    popup("popup itself", p);
    SetActiveWindow(a);
    popup("owner active again", a);
    q = CreateWindow("Minis3", "Q", WS_POPUP | WS_CAPTION, 40, 40, 80, 60, a, NULL, instance, NULL);
    popup("second popup hidden", a);
    ShowWindow(q, SW_SHOW);
    popup("second popup shown", a);
    SetActiveWindow(p);
    popup("first popup active", a);
    SetActiveWindow(a);
    popup("owner active, both shown", a);
    DestroyWindow(p);
    popup("first popup destroyed", a);
    DestroyWindow(q);
    q = NULL;
    popup("both destroyed", a);
    p = NULL;

    children("all", a, 0);
    children("stop at second", a, 2);
    children("of a child", c, 0);
    children("of a leaf", e, 0);

    props("none", a, 0);
    SetProp(a, "First", (HANDLE)11);
    SetProp(a, "Second", (HANDLE)22);
    SetProp(a, MAKEINTATOM(0x1234), (HANDLE)33);
    SetProp(a, "Third", (HANDLE)44);
    props("four", a, 0);
    props("stop at second", a, 2);
    RemoveProp(a, "Second");
    props("one removed", a, 0);
    RemoveProp(a, "First");
    RemoveProp(a, MAKEINTATOM(0x1234));
    RemoveProp(a, "Third");

    probe("tasks", "window's task is the current one",
          (LPSTR)(GetWindowTask(a) == GetCurrentTask() ? "yes" : "no"));
    probe("tasks", "window's task is the desktop's",
          (LPSTR)(GetWindowTask(a) == GetWindowTask(GetDesktopWindow()) ? "yes" : "no"));
    {
        FARPROC thunk = MakeProcInstance((FARPROC)Visit, instance);

        seen[0] = '\0';
        visits = 0;
        stopAt = 0;
        answer = EnumTaskWindows(GetCurrentTask(), (WNDENUMPROC)thunk, 0L);
        wsprintf(probeResult, "%s:%d", (LPSTR)seen, answer);
        probe("tasks", "through MakeProcInstance", probeResult);
        FreeProcInstance(thunk);
    }

    seen[0] = '\0';
    visits = 0;
    stopAt = 0;
    answer = EnumWindows((WNDENUMPROC)Visit, 0L);
    wsprintf(probeResult, "%s:%d", (LPSTR)seen, answer);
    probe("windows", "all", probeResult);

    wsprintf(probeResult, "%d:%d", SwapMouseButton(TRUE), GetSystemMetrics(SM_SWAPBUTTON));
    probe("swap", "true", probeResult);
    wsprintf(probeResult, "%d:%d", SwapMouseButton(TRUE), GetSystemMetrics(SM_SWAPBUTTON));
    probe("swap", "true again", probeResult);
    wsprintf(probeResult, "%d:%d", SwapMouseButton(FALSE), GetSystemMetrics(SM_SWAPBUTTON));
    probe("swap", "false", probeResult);
    wsprintf(probeResult, "%d:%d", SwapMouseButton(5), GetSystemMetrics(SM_SWAPBUTTON));
    probe("swap", "5", probeResult);
    SwapMouseButton(FALSE);

    keys[0] = '\0';

    for (i = 1; i < 256; i++) {
        int state = GetAsyncKeyState(i);

        if (state) {
            wsprintf(one, "%02x=%04x,", i, (UINT)state);
            lstrcat(keys, one);
        }
    }

    probe("async", "any", keys[0] ? keys : "none");

    for (i = 0; i < sizeof(beeps) / sizeof(beeps[0]); i++) {
        wsprintf(probeArgs, "%04x", beeps[i]);
        MessageBeep(beeps[i]);
        probe("beep", probeArgs, "done");
    }

    wsprintf(probeResult, "%s", (LPSTR)(LocalShrink(0, 0) == LocalCompact(0) ? "same" : "differ"));
    probe("shrink", "0,0", probeResult);

    /* Last: without MakeProcInstance the procedure runs with a data segment of
     * 1, which a real processor faults on and DOSBox lets through. */
    seen[0] = '\0';
    visits = 0;
    stopAt = 0;
    answer = EnumTaskWindows(GetCurrentTask(), (WNDENUMPROC)Visit, 0L);
    wsprintf(probeResult, "%s:%d", (LPSTR)seen, answer);
    probe("tasks", "all", probeResult);
    seen[0] = '\0';
    visits = 0;
    stopAt = 1;
    answer = EnumTaskWindows(GetCurrentTask(), (WNDENUMPROC)Visit, 0L);
    wsprintf(probeResult, "%s:%d", (LPSTR)seen, answer);
    probe("tasks", "stop at first", probeResult);

    seen[0] = '\0';
    visits = 0;
    stopAt = 0;
    answer = EnumTaskWindows(GetWindowTask(a), (WNDENUMPROC)Visit, 0L);
    wsprintf(probeResult, "%s:%d", (LPSTR)seen, answer);
    probe("tasks", "the window's task", probeResult);

    DestroyWindow(a);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
