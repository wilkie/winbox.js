/*
 * What USER does with a task's hooks and windows as the task ends.
 *
 * The probe loads `TASKENDD.DLL`, makes its window `p`, puts in hooks of
 * its own for every task with `SetWindowsHook` -- the computer-based
 * training hook, the window procedure hook and the shell hook, each noting
 * what it is called with for the child's windows while the child ends --
 * and runs `TASKENDC.EXE` (see `taskend.child.c` for its hooks and
 * windows). Then:
 *
 * * `hooks`: which of the child's message hooks are called, and in what
 *   order, for a message the probe looks at itself (`probe`), for one the
 *   child takes (`child`), and, after the child has ended, for one the probe
 *   looks at (`after`). The child's are 0 to 4, as `taskend.child.c` numbers
 *   them; 6 is a message hook the probe put in for the child's task. Each
 *   record is the counts, then the order of the first round of calls.
 * * `filter`: `CallMsgFilter` called by the probe -- does the child's
 *   `WH_MSGFILTER` hook, its task's own, hear it?
 * * `w5`: the probe makes a popup of its own that the child's `w1` owns.
 * * The end: the probe posts the child's `w1` a message on which it ends,
 *   and waits until its module is gone. `cbt` is what the probe's
 *   computer-based training hook was called with in that time, `sent` what
 *   its window procedure hook saw sent to the named windows, `shell` the
 *   shell hook's calls, `log` what the child's own window procedure and the
 *   library's (`d`) were given, and `p` what the probe's window was sent.
 * * `after`: which of the windows are left, `IsWindow`; `class`, whether
 *   the class `TEGLOBAL`, which the child registered for every task with
 *   its instance and the library's procedure, is still there; `unhook`,
 *   what `UnhookWindowsHook` and `UnhookWindowsHookEx` answer for the two
 *   hooks of the child's that are left.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TASKEND.OUT"
#define LIBRARY "TASKENDD.DLL"
#define WM_TE_END (WM_USER + 1)

typedef void(FAR PASCAL *SETWINDOW)(int, HWND);
typedef HWND(FAR PASCAL *GETWINDOW)(int);
typedef void(FAR PASCAL *NAMEOF)(HWND, LPSTR);
typedef BOOL(FAR PASCAL *NAMED)(HWND);
typedef void(FAR PASCAL *SETBOOL)(BOOL);
typedef BOOL(FAR PASCAL *GETBOOL)(void);
typedef void(FAR PASCAL *NOTE)(LPCSTR, HWND, UINT);
typedef void(FAR PASCAL *TEXT)(LPCSTR);
typedef void(FAR PASCAL *TAKE)(LPSTR);
typedef long(FAR PASCAL *COUNT)(int, BOOL);
typedef void(FAR PASCAL *BEGIN)(HTASK);
typedef void(FAR PASCAL *MARK)(int);

static SETWINDOW teSetWindow;
static GETWINDOW teWindow;
static NAMEOF teNameOf;
static NAMED teNamed;
static SETBOOL teLogging;
static GETBOOL teReady;
static NOTE teNote;
static TEXT teText;
static TAKE teTake;
static COUNT teCount;
static BEGIN teOrderBegin;
static TAKE teOrder;
static MARK teCounted;
static TAKE teUnhookLeft;

static BOOL ending;
static HHOOK forChild;
static HOOKPROC nextCbt;
static HOOKPROC nextSent;
static HOOKPROC nextShell;
static char cbtText[800];
static char sentText[1600];
static char shellText[200];

static void add(LPSTR into, int size, LPCSTR what)
{
    if (lstrlen(into) + lstrlen(what) + 1 < size) {
        lstrcat(into, what);
    }
}

DWORD FAR PASCAL _export CbtHook(int code, WPARAM wParam, LPARAM lParam)
{
    char name[8];
    char line[24];

    if (ending && teNamed((HWND)wParam)) {
        teNameOf((HWND)wParam, name);
        wsprintf(line, "%d:%s ", code, (LPSTR)name);
        add(cbtText, sizeof(cbtText), line);
    }

    return DefHookProc(code, wParam, lParam, (HOOKPROC FAR *)&nextCbt);
}

DWORD FAR PASCAL _export SentHook(int code, WPARAM wParam, LPARAM lParam)
{
    WORD FAR *words = (WORD FAR *)lParam;
    char name[8];
    char line[24];

    if (ending && teNamed((HWND)words[4])) {
        teNameOf((HWND)words[4], name);
        wsprintf(line, "%s:%x ", (LPSTR)name, words[3]);
        add(sentText, sizeof(sentText), line);
    }

    return DefHookProc(code, wParam, lParam, (HOOKPROC FAR *)&nextSent);
}

DWORD FAR PASCAL _export ShellHook(int code, WPARAM wParam, LPARAM lParam)
{
    char name[8];
    char line[24];

    if (ending) {
        teNameOf((HWND)wParam, name);
        wsprintf(line, "%d:%s ", code, (LPSTR)name);
        add(shellText, sizeof(shellText), line);
    }

    return DefHookProc(code, wParam, lParam, (HOOKPROC FAR *)&nextShell);
}

/* The probe's message hook for the child's task: counted as hook 6. */
DWORD FAR PASCAL _export ForChildHook(int code, WPARAM wParam, LPARAM lParam)
{
    teCounted(6);
    return CallNextHookEx(forChild, code, wParam, lParam);
}

LRESULT FAR PASCAL _export ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (ending) {
        teNote("p", hwnd, message);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(int times)
{
    MSG msg;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        Yield();
    }
}

/* The message hooks' counts and order, reset. */
static void hooks(LPCSTR when)
{
    char order[32];

    teOrder(order);
    wsprintf(probeResult, "%ld,%ld,%ld,%ld,%ld,%ld %s", teCount(0, TRUE), teCount(1, TRUE),
             teCount(2, TRUE), teCount(3, TRUE), teCount(4, TRUE), teCount(6, TRUE), (LPSTR)order);
    probe("hooks", when, probeResult);
}

static FARPROC need(HINSTANCE library, LPCSTR name)
{
    FARPROC proc = GetProcAddress(library, name);

    if (!proc) {
        probe("GetProcAddress", name, "0");
    }

    return proc;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    WNDCLASS wc;
    HWND p;
    HWND w5;
    HTASK child;
    UINT started;
    DWORD start;
    MSG msg;
    FARPROC cbt;
    FARPROC sent;
    FARPROC shell;
    char text[1600];
    int i;

    probeOpen(OUTPUT);

    library = LoadLibrary(LIBRARY);

    if ((UINT)library < 32) {
        wsprintf(probeResult, "%u", (UINT)library);
        probe("LoadLibrary", LIBRARY, probeResult);
        probeFinish();
        return 0;
    }

    teSetWindow = (SETWINDOW)need(library, "TESETWINDOW");
    teWindow = (GETWINDOW)need(library, "TEWINDOW");
    teNameOf = (NAMEOF)need(library, "TENAMEOF");
    teNamed = (NAMED)need(library, "TENAMED");
    teLogging = (SETBOOL)need(library, "TELOGGING");
    teReady = (GETBOOL)need(library, "TEREADY");
    teNote = (NOTE)need(library, "TENOTE");
    teText = (TEXT)need(library, "TETEXT");
    teTake = (TAKE)need(library, "TETAKE");
    teCount = (COUNT)need(library, "TECOUNT");
    teOrderBegin = (BEGIN)need(library, "TEORDERBEGIN");
    teOrder = (TAKE)need(library, "TEORDER");
    teCounted = (MARK)need(library, "TECOUNTED");
    teUnhookLeft = (TAKE)need(library, "TEUNHOOKLEFT");

    wc.style = 0;
    wc.lpfnWndProc = ParentProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = GetStockObject(WHITE_BRUSH);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "TEPARENT";
    RegisterClass(&wc);

    p = CreateWindow("TEPARENT", "p", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 260, 200, NULL, NULL,
                     instance, NULL);
    teSetWindow(7, p);
    SetFocus(p);
    pump(2);

    cbt = MakeProcInstance((FARPROC)CbtHook, instance);
    sent = MakeProcInstance((FARPROC)SentHook, instance);
    shell = MakeProcInstance((FARPROC)ShellHook, instance);
    nextCbt = SetWindowsHook(WH_CBT, (HOOKPROC)cbt);
    nextSent = SetWindowsHook(WH_CALLWNDPROC, (HOOKPROC)sent);
    nextShell = SetWindowsHook(WH_SHELL, (HOOKPROC)shell);

    started = WinExec("C:\\WINDOWS\\TASKENDC.EXE", SW_SHOWNOACTIVATE);
    start = GetTickCount();

    while (!teReady() && GetTickCount() - start < 5000) {
        pump(1);
    }

    wsprintf(probeResult, "started=%d ready=%d", started >= 32, teReady());
    probe("child", "", probeResult);

    if (!teReady()) {
        probeFinish();
        return 0;
    }

    child = GetWindowTask(teWindow(0));
    forChild = SetWindowsHookEx(WH_GETMESSAGE,
                                (HOOKPROC)MakeProcInstance((FARPROC)ForChildHook, instance),
                                instance, child);
    wsprintf(probeResult, "%d", forChild != NULL);
    probe("SetWindowsHookEx", "for the child's task", probeResult);

    for (i = 0; i < 7; i++) {
        teCount(i, TRUE);
    }

    /* A message the probe looks at itself, without yielding. */
    PostMessage(p, WM_NULL, 0, 0);
    teOrderBegin(GetCurrentTask());
    PeekMessage(&msg, p, 0, 0, PM_REMOVE | PM_NOYIELD);
    hooks("probe");

    /* The message filters the probe calls. */
    msg.hwnd = p;
    msg.message = WM_NULL;
    msg.wParam = 0;
    msg.lParam = 0;
    CallMsgFilter(&msg, 0x77);
    wsprintf(probeResult, "%ld", teCount(4, TRUE));
    probe("filter", "probe", probeResult);

    /* A message the child takes. */
    teOrderBegin(child);
    PostMessage(teWindow(0), WM_NULL, 0, 0);
    pump(4);
    hooks("child");

    w5 = CreateWindow("TEPARENT", "w5", WS_POPUP | WS_CAPTION, 340, 260, 120, 60, teWindow(0), NULL,
                      instance, NULL);
    teSetWindow(6, w5);
    ShowWindow(w5, SW_SHOWNOACTIVATE);
    pump(2);

    for (i = 0; i < 7; i++) {
        teCount(i, TRUE);
    }

    /* The end. */
    ending = TRUE;
    teLogging(TRUE);
    PostMessage(teWindow(0), WM_TE_END, 0, 0);
    start = GetTickCount();

    while (GetModuleHandle("TASKENDC") && GetTickCount() - start < 5000) {
        pump(1);
    }

    ending = FALSE;
    teLogging(FALSE);
    pump(2);

    wsprintf(probeResult, "%d", GetModuleHandle("TASKENDC") == NULL);
    probe("ended", "", probeResult);
    probe("cbt", "", cbtText[0] ? cbtText : "none");
    probe("sent", "", sentText[0] ? sentText : "none");
    probe("shell", "", shellText[0] ? shellText : "none");
    teTake(text);
    probe("log", "", text);

    for (i = 0; i < 7; i++) {
        static const char *const NAMES[7] = {"w1", "w1a", "w1b", "w2", "w3", "w4", "w5"};

        wsprintf(probeResult, "%d", IsWindow(teWindow(i)));
        probe("after", NAMES[i], probeResult);
    }

    wsprintf(probeResult, "%d", GetClassInfo(NULL, "TEGLOBAL", &wc));
    probe("class", "TEGLOBAL", probeResult);

    /* A message the probe looks at, after the child has ended. */
    for (i = 0; i < 7; i++) {
        teCount(i, TRUE);
    }

    PostMessage(p, WM_NULL, 0, 0);
    teOrderBegin(GetCurrentTask());
    PeekMessage(&msg, p, 0, 0, PM_REMOVE | PM_NOYIELD);
    hooks("after");

    teUnhookLeft(text);
    probe("unhook", "left", text);

    UnhookWindowsHook(WH_CBT, (HOOKPROC)cbt);
    UnhookWindowsHook(WH_CALLWNDPROC, (HOOKPROC)sent);
    UnhookWindowsHook(WH_SHELL, (HOOKPROC)shell);

    if (IsWindow(w5)) {
        DestroyWindow(w5);
    }

    DestroyWindow(p);
    FreeLibrary(library);

    probeFinish();

    (void)teText;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
