/*
 * Where a dialog goes among the windows at the top as it is made and shown,
 * with a system-modal dialog already up: SimTower's start. SimTower makes
 * its main window hidden, and a pop-up made topmost hidden; then its title
 * picture, a modeless dialog with `DS_SYSMODAL` and `WS_VISIBLE` and no
 * owner, the whole screen; then its start dialog with `DialogBox`, owned by
 * the hidden main window, `DS_SYSMODAL` too, which in `WM_INITDIALOG`
 * shows itself with `SetWindowPos(HWND_TOPMOST, SWP_NOSIZE |
 * SWP_SHOWWINDOW)` and then `ShowWindow(SW_SHOWNORMAL)`.
 *
 * The windows, all of class `Front`: M, overlapped, hidden; F, a pop-up
 * with a border, hidden and made topmost with `SWP_NOACTIVATE`. The
 * dialogs are built in memory, `WS_POPUP | WS_BORDER`, no controls: T, the
 * title, made with `CreateDialogIndirect`, no owner, `WS_VISIBLE`; D, run
 * with `DialogBoxIndirect`, owned by M. D's `WM_INITDIALOG` does as the
 * case says and sets a timer; at the timer, which comes once the dialog's
 * loop has shown it, D is ended.
 *
 * * `order`: the windows named among the desktop's children, the front
 *   first, `*` after one with WS_EX_TOPMOST and `-` after one hidden; then
 *   the active window and the system-modal window.
 * * `sent`: `WM_WINDOWPOSCHANGING` (46) and `WM_WINDOWPOSCHANGED` (47) M,
 *   F, T and D were sent, `X:46@a`, `a` the window to go after as the
 *   structure names it (`T` 0, `M` 1, `X` -1, `N` -2), since the last
 *   `order`.
 *
 * The cases, each with M, F and T made again:
 *
 * * `sim`: both `DS_SYSMODAL`; D's `WM_INITDIALOG` calls
 *   `SetWindowPos(D, HWND_TOPMOST, 190, 181, 0, 0, SWP_NOSIZE |
 *   SWP_SHOWWINDOW)` then `ShowWindow(D, SW_SHOWNORMAL)`, as SimTower.
 * * `simswp`: the same without the `ShowWindow`.
 * * `simtop`: `SetWindowPos(D, HWND_TOP, ...)` in place of HWND_TOPMOST.
 * * `loop`: both `DS_SYSMODAL`; D's `WM_INITDIALOG` shows nothing, the
 *   loop shows it.
 * * `plain`: neither `DS_SYSMODAL`; D as `sim`.
 * * `plainloop`: neither `DS_SYSMODAL`; the loop shows D.
 * * `tsys`: T `DS_SYSMODAL`, D not; the loop shows D.
 * * `shown`: as `sim`, with M shown before T is made.
 *
 * And windows made and shown while another is active, A a pop-up with a
 * border, shown, active: `visible` B made with `WS_VISIBLE`; `show` C made
 * hidden, shown with `ShowWindow(SW_SHOW)`; `normal` E with
 * `SW_SHOWNORMAL`; `owned` O made `WS_VISIBLE`, owned by M (hidden).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DLGFRONT.OUT"

#define HWND_TOPMOST_ ((HWND)-1)
#define HWND_NOTOPMOST_ ((HWND)-2)
#define WS_EX_TOPMOST_ 0x00000008L

enum { M, F, T, D, A, B, C, E, O, COUNT };

static const char *names[] = { "M", "F", "T", "D", "A", "B", "C", "E", "O" };
static HWND windows[COUNT];
static char seen[1200];
static HINSTANCE instance;
static FARPROC dialogProc;
static FARPROC titleProc;
static HGLOBAL memory;
static BYTE FAR *template;
static int at;
static BOOL topmostSwp, viaSwp, viaShow;

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static LPCSTR nameOf(HWND hwnd)
{
    int i;

    if (!hwnd) {
        return "0";
    }

    for (i = 0; i < COUNT; i++) {
        if (windows[i] == hwnd) {
            return names[i];
        }
    }

    return "?";
}

static LPCSTR afterOf(HWND hwnd)
{
    if (hwnd == HWND_TOP) {
        return "T";
    }

    if (hwnd == HWND_BOTTOM) {
        return "M";
    }

    if (hwnd == HWND_TOPMOST_) {
        return "X";
    }

    if (hwnd == HWND_NOTOPMOST_) {
        return "N";
    }

    return nameOf(hwnd);
}

/* Apart, so that the far pointer is loaded only where it is one. */
static void notePosition(HWND window, UINT message, WINDOWPOS FAR *pos)
{
    char one[40];

    wsprintf(one, "%s:%x@%s,", nameOf(window), message, afterOf(pos->hwndInsertAfter));
    lstrcat(seen, one);
}

static void order(LPCSTR name)
{
    char text[160];
    LPSTR to = text;
    HWND hwnd;
    int i;

    *to = '\0';

    for (hwnd = GetWindow(GetDesktopWindow(), GW_CHILD); hwnd;
         hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        for (i = 0; i < COUNT; i++) {
            if (windows[i] == hwnd) {
                to += wsprintf(to, "%s%s%s%s", (LPSTR)(to == text ? "" : ","), nameOf(hwnd),
                               (LPSTR)(GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST_ ? "*"
                                                                                        : ""),
                               (LPSTR)(IsWindowVisible(hwnd) ? "" : "-"));
            }
        }
    }

    wsprintf(probeResult, "%s;active=%s;sysmodal=%s", (LPSTR)text, nameOf(GetActiveWindow()),
             nameOf(GetSysModalWindow()));
    probe("order", name, probeResult);
    probe("sent", name, seen[0] ? seen : "none");
    seen[0] = '\0';
}

static char label[40];

static void orderAt(LPCSTR when)
{
    char name[60];

    wsprintf(name, "%s, %s", (LPSTR)label, when);
    order(name);
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_WINDOWPOSCHANGING || message == WM_WINDOWPOSCHANGED) {
        notePosition(window, message, (WINDOWPOS FAR *)lParam);
    }

    return DefWindowProc(window, message, wParam, lParam);
}

BOOL CALLBACK __export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_INITDIALOG:
        windows[D] = dialog;
        orderAt("init");

        if (viaSwp) {
            SetWindowPos(dialog, topmostSwp ? HWND_TOPMOST_ : HWND_TOP, 190, 181, 0, 0,
                         SWP_NOSIZE | SWP_SHOWWINDOW);
            orderAt("swp");
        }

        if (viaShow) {
            ShowWindow(dialog, SW_SHOWNORMAL);
            orderAt("show");
        }

        SetTimer(dialog, 1, 100, NULL);
        return TRUE;
    case WM_TIMER:
        KillTimer(dialog, 1);
        orderAt("loop");
        EndDialog(dialog, 1);
        return TRUE;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        notePosition(dialog, message, (WINDOWPOS FAR *)lParam);
        break;
    }

    return FALSE;
}

/* T's: nothing but the positions noted. */
BOOL CALLBACK __export TitleProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_INITDIALOG:
        return TRUE;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        notePosition(dialog, message, (WINDOWPOS FAR *)lParam);
        break;
    }

    return FALSE;
}

static void take(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

static void word(WORD value)
{
    template[at++] = LOBYTE(value);
    template[at++] = HIBYTE(value);
}

/* A dialog of no controls, at (x, y) in dialog units, 120 by 50. */
static HGLOBAL build(DWORD style, int x)
{
    HGLOBAL made = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 64);

    template = (BYTE FAR *)GlobalLock(made);
    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    template[at++] = 0;
    word(x);
    word(40);
    word(120);
    word(50);
    template[at++] = 0;
    template[at++] = 0;
    template[at++] = 0;
    GlobalUnlock(made);
    return made;
}

static HWND make(int which, DWORD style, int x, int y, HWND owner)
{
    windows[which] =
        CreateWindow("Front", names[which], style, x, y, 160, 120, owner, NULL, instance, NULL);
    return windows[which];
}

static void destroyAll(void)
{
    int i;

    for (i = COUNT - 1; i >= 0; i--) {
        if (windows[i] && IsWindow(windows[i])) {
            DestroyWindow(windows[i]);
        }

        windows[i] = NULL;
    }

    take();
    seen[0] = '\0';
}

/*
 * One case: M (shown or not) and F, T made, then D run. `tSys`, `dSys`:
 * whether T and D are `DS_SYSMODAL`; `swp`, `top`, `show`: what D's
 * `WM_INITDIALOG` does.
 */
static void dialogCase(LPCSTR name, BOOL tSys, BOOL dSys, BOOL swp, BOOL topmost, BOOL show,
                       BOOL mShown)
{
    HGLOBAL t;
    HGLOBAL d;
    char answer[8];

    lstrcpy(label, name);
    make(M, WS_OVERLAPPEDWINDOW | WS_CLIPSIBLINGS | (mShown ? WS_VISIBLE : 0), 100, 60, NULL);
    make(F, WS_POPUP | WS_BORDER | WS_CLIPSIBLINGS, 20, 200, NULL);
    SetWindowPos(windows[F], HWND_TOPMOST_, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    take();
    orderAt("start");

    t = build(WS_POPUP | WS_BORDER | WS_CLIPSIBLINGS | WS_VISIBLE | (tSys ? DS_SYSMODAL : 0), 4);
    windows[T] = CreateDialogIndirect(instance, (LPCSTR)GlobalLock(t), NULL, (DLGPROC)titleProc);
    GlobalUnlock(t);
    take();
    orderAt("title");

    viaSwp = swp;
    topmostSwp = topmost;
    viaShow = show;
    d = build(WS_POPUP | WS_BORDER | WS_CLIPSIBLINGS | (dSys ? DS_SYSMODAL : 0), 100);
    wsprintf(answer, "%d", DialogBoxIndirect(instance, d, windows[M], (DLGPROC)dialogProc));
    probe("answer", name, answer);
    orderAt("ended");

    GlobalFree(t);
    GlobalFree(d);
    destroyAll();
}

int PASCAL WinMain(HINSTANCE hinst, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    instance = hinst;
    probeOpen(OUTPUT);
    dialogProc = MakeProcInstance((FARPROC)DialogProc, hinst);
    titleProc = MakeProcInstance((FARPROC)TitleProc, hinst);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Front";
    RegisterClass(&kind);

    dialogCase("sim", TRUE, TRUE, TRUE, TRUE, TRUE, FALSE);
    dialogCase("simswp", TRUE, TRUE, TRUE, TRUE, FALSE, FALSE);
    dialogCase("simtop", TRUE, TRUE, TRUE, FALSE, TRUE, FALSE);
    dialogCase("loop", TRUE, TRUE, FALSE, FALSE, FALSE, FALSE);
    dialogCase("plain", FALSE, FALSE, TRUE, TRUE, TRUE, FALSE);
    dialogCase("plainloop", FALSE, FALSE, FALSE, FALSE, FALSE, FALSE);
    dialogCase("tsys", TRUE, FALSE, FALSE, FALSE, FALSE, FALSE);
    dialogCase("shown", TRUE, TRUE, TRUE, TRUE, TRUE, TRUE);

    lstrcpy(label, "make");
    make(M, WS_OVERLAPPEDWINDOW, 100, 60, NULL);
    make(A, WS_POPUP | WS_BORDER | WS_VISIBLE, 40, 40, NULL);
    take();
    orderAt("start");
    make(B, WS_POPUP | WS_BORDER | WS_VISIBLE, 80, 70, NULL);
    take();
    orderAt("visible");
    make(C, WS_POPUP | WS_BORDER, 120, 100, NULL);
    orderAt("made");
    ShowWindow(windows[C], SW_SHOW);
    take();
    orderAt("show");
    make(E, WS_POPUP | WS_BORDER, 160, 130, NULL);
    ShowWindow(windows[E], SW_SHOWNORMAL);
    take();
    orderAt("normal");
    make(O, WS_POPUP | WS_BORDER | WS_VISIBLE, 200, 160, windows[M]);
    take();
    orderAt("owned");
    destroyAll();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
