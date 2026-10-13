/*
 * The computer-based training hooks, `WH_CBT`, and the codes USER calls them
 * with as it makes, destroys, activates, focuses, minimizes and moves a
 * window, and as `DefWindowProc` carries out a system command:
 *
 * * `HCBT_CREATEWND`, 3: `CreateWindow`, once the window is made and before
 *   it is sent anything (`USER.EXE` seg8 `0450`-`047d`), with a
 *   `CBT_CREATEWND`: the arguments as a `CREATESTRUCT`, and the window to
 *   put it after;
 * * `HCBT_DESTROYWND`, 4: `DestroyWindow` (seg8 `0a4d`-`0a5d`);
 * * `HCBT_ACTIVATE`, 5: a window about to be made active (seg1 `3558`-
 *   `3582`), with a `CBTACTIVATESTRUCT`;
 * * `HCBT_SETFOCUS`, 9: `SetFocus` (seg1 `382f`-`3897`), and USER's own
 *   moves of the focus through it;
 * * `HCBT_MINMAX`, 1: a window about to be minimized, maximized or restored
 *   (seg6 `1ae0`-`1af5`);
 * * `HCBT_SYSCOMMAND`, 8: `DefWindowProc` with `WM_SYSCOMMAND` (seg1 `03de`-
 *   `03fd`);
 * * `HCBT_MOVESIZE`, 0: the move or size loop ending with a rectangle that
 *   is not the one it began with (seg6 `11b1`-`1246`);
 * * `HCBT_QS`, 2: the move or size loop taking `WM_QUEUESYNC` (seg6 `16a3`).
 *
 * `T` is an overlapped window at (40, 40), 300 by 200, with a child `A`; `U`
 * an overlapped window at (360, 40), 200 by 150. `click` presses and lets
 * go the left button in `U`'s client area through `MOUSE_EVENT`. The hook, put in with
 * `SetWindowsHookEx` for the probe's task, notes each call, `c<code>:` then
 * what it is handed, the windows named; and answers 1 for the code a case
 * names, without passing it on. Each case is begun with a record of its
 * name. The probe's windows note `WM_NCCREATE`,
 * `WM_CREATE`, `WM_DESTROY`, `WM_NCDESTROY`, `WM_ACTIVATE`, `WM_SETFOCUS`
 * and `WM_KILLFOCUS`. Each case writes its notes, and then what came of it.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CBTHOOK.OUT"

static HINSTANCE module;
static HWND top;
static HWND a;
static HWND u;
static HWND p;
static HWND q;
static HHOOK cbtHook;
static int eat = -1;
static BOOL editCreate;
static BOOL logging;
static char events[1800];

static LPCSTR whose(HWND hwnd)
{
    static char handle[4][8];
    static int next;

    if (hwnd == NULL) {
        return "0";
    }

    if (hwnd == top) {
        return "T";
    }

    if (hwnd == a) {
        return "A";
    }

    if (hwnd == u) {
        return "U";
    }

    if (hwnd == p) {
        return "P";
    }

    if (hwnd == q) {
        return "Q";
    }

    if (hwnd == GetDesktopWindow()) {
        return "D";
    }

    next = (next + 1) & 3;

    if (IsWindow(hwnd)) {
        GetClassName(hwnd, handle[next], sizeof(handle[next]));
    } else {
        lstrcpy(handle[next], "?");
    }

    return handle[next];
}

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

LRESULT FAR PASCAL _export CbtHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[120];

    if (logging) {
        switch (code) {
        case HCBT_CREATEWND: {
            CBT_CREATEWND FAR *create = (CBT_CREATEWND FAR *)lParam;
            CREATESTRUCT FAR *cs = create->lpcs;

            wsprintf(one, "c3:%s/%d,%d,%d,%d/%lx/%s/%s/%s", whose((HWND)wParam), cs->x, cs->y,
                     cs->cx, cs->cy, cs->style,
                     HIWORD(cs->lpszName) ? cs->lpszName : (LPCSTR) "#",
                     whose(cs->hwndParent), whose(create->hwndInsertAfter));

            if (editCreate) {
                cs->x = 77;
                cs->cx = 123;
            }

            break;
        }

        case HCBT_ACTIVATE: {
            CBTACTIVATESTRUCT FAR *activate = (CBTACTIVATESTRUCT FAR *)lParam;

            wsprintf(one, "c5:%s/%d/%s", whose((HWND)wParam), activate->fMouse,
                     whose(activate->hWndActive));
            break;
        }

        case HCBT_MOVESIZE: {
            RECT FAR *rect = (RECT FAR *)lParam;

            wsprintf(one, "c0:%s/%d,%d,%d,%d", whose((HWND)wParam), rect->left, rect->top,
                     rect->right, rect->bottom);
            break;
        }

        case HCBT_SETFOCUS:
            wsprintf(one, "c9:%s/%s/%x", whose((HWND)wParam), whose((HWND)LOWORD(lParam)),
                     HIWORD(lParam));
            break;

        case HCBT_DESTROYWND:
        case HCBT_MINMAX:
            wsprintf(one, "c%d:%s/%lx", code, whose((HWND)wParam), lParam);
            break;

        default:
            wsprintf(one, "c%d:%x/%lx", code, wParam, lParam);
            break;
        }

        add(one);
    }

    if (code == eat) {
        return 1;
    }

    return CallNextHookEx(cbtHook, code, wParam, lParam);
}

LONG FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];

    if (logging) {
        switch (message) {
        case WM_NCCREATE:
        case WM_CREATE:
        case WM_DESTROY:
        case WM_NCDESTROY:
            wsprintf(one, "%s%x", whose(hwnd), message);
            add(one);
            break;

        case WM_ACTIVATE:
            wsprintf(one, "%s%x:%x/%s", whose(hwnd), message, wParam,
                     whose((HWND)LOWORD(lParam)));
            add(one);
            break;

        case WM_SETFOCUS:
        case WM_KILLFOCUS:
            wsprintf(one, "%s%x:%s", whose(hwnd), message, whose((HWND)wParam));
            add(one);
            break;
        }
    }

    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static FARPROC mouseEvent;
static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static void mouse(WORD flags, WORD x, WORD y)
{
    mouseFlags = flags;
    mouseX = x;
    mouseY = y;

    _asm {
        push si
        push di
        mov ax, mouseFlags
        mov bx, mouseX
        mov cx, mouseY
        mov dx, 2
        xor si, si
        xor di, di
        call dword ptr mouseEvent
        pop di
        pop si
    }
}

static WORD across(int x)
{
    return (WORD)(((DWORD)x * 65536L + GetSystemMetrics(SM_CXSCREEN) - 1) /
                  GetSystemMetrics(SM_CXSCREEN));
}

static WORD down(int y)
{
    return (WORD)(((DWORD)y * 65536L + GetSystemMetrics(SM_CYSCREEN) - 1) /
                  GetSystemMetrics(SM_CYSCREEN));
}

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 200 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

static void begin(int code)
{
    pump();
    events[0] = '\0';
    eat = code;
    logging = TRUE;
}

static void end(LPCSTR name, LPCSTR outcome)
{
    logging = FALSE;
    eat = -1;
    lstrcat(events, "=");
    lstrcat(events, outcome);
    probe("cbt", name, events);
}

static void where(LPSTR out, HWND hwnd)
{
    RECT rect;

    GetWindowRect(hwnd, &rect);
    wsprintf(out, "%d,%d,%d,%d", rect.left, rect.top, rect.right, rect.bottom);
}

static void state(LPSTR out)
{
    wsprintf(out, "active %s focus %s", whose(GetActiveWindow()), whose(GetFocus()));
}

/* A popup `P` made hidden, or `Q` owned by it. */
static HWND popup(HWND owner)
{
    return CreateWindow("CbtProbe", "Pop", WS_POPUP | WS_BORDER, 50, 60, 100, 80, owner, NULL,
                        module, NULL);
}

/* Moves `T` from the keyboard, the keys posted before the loop starts. */
static void moveTop(int right, BOOL sync)
{
    int step;

    if (sync) {
        PostMessage(top, WM_QUEUESYNC, 0, 0L);
    }

    for (step = 0; step < right; step++) {
        PostMessage(top, WM_KEYDOWN, VK_RIGHT, 0L);
    }

    PostMessage(top, WM_KEYDOWN, VK_RETURN, 0L);
    SendMessage(top, WM_SYSCOMMAND, SC_MOVE, 0L);
}

static void run(LPCSTR name)
{
    char outcome[80];
    char rect[40];
    HWND made;

    probe("case", name, "");
    SetActiveWindow(top);
    SetFocus(a);

    if (lstrcmp(name, "create") == 0 || lstrcmp(name, "createeat") == 0 ||
        lstrcmp(name, "createedit") == 0) {
        editCreate = lstrcmp(name, "createedit") == 0;
        begin(lstrcmp(name, "createeat") == 0 ? HCBT_CREATEWND : -1);
        made = popup(NULL);
        p = made;

        if (made) {
            where(rect, made);
        } else {
            lstrcpy(rect, "-");
        }

        wsprintf(outcome, "%s %s", made ? "made" : "none", (LPSTR)rect);
        end(name, outcome);
        editCreate = FALSE;

        if (p) {
            DestroyWindow(p);
            p = NULL;
        }
    } else if (lstrcmp(name, "child") == 0) {
        begin(-1);
        made = CreateWindow("CbtProbe", "Kid", WS_CHILD | WS_VISIBLE, 5, 6, 30, 20, top,
                            (HMENU)7, module, NULL);
        wsprintf(outcome, "%s", made ? "made" : "none");
        end(name, outcome);
        DestroyWindow(made);
    } else if (lstrcmp(name, "destroy") == 0 || lstrcmp(name, "destroyeat") == 0) {
        p = popup(top);
        q = popup(p);
        begin(lstrcmp(name, "destroy") == 0 ? -1 : HCBT_DESTROYWND);

        if (DestroyWindow(p)) {
            lstrcpy(outcome, "1");
        } else {
            /* Only where it was not destroyed: Windows answers `IsWindow`
             * from what is left of a window destroyed. */
            wsprintf(outcome, "0 %d %d", IsWindow(p) ? 1 : 0, IsWindow(q) ? 1 : 0);
        }

        end(name, outcome);
        eat = -1;

        if (IsWindow(p)) {
            DestroyWindow(p);
        }

        p = NULL;
        q = NULL;
    } else if (lstrcmp(name, "activate") == 0 || lstrcmp(name, "activateeat") == 0) {
        begin(lstrcmp(name, "activate") == 0 ? -1 : HCBT_ACTIVATE);
        made = SetActiveWindow(u);
        wsprintf(outcome, "%s ", whose(made));
        state(outcome + lstrlen(outcome));
        end(name, outcome);
    } else if (lstrcmp(name, "focus") == 0 || lstrcmp(name, "focuseat") == 0) {
        SetFocus(top);
        begin(lstrcmp(name, "focus") == 0 ? -1 : HCBT_SETFOCUS);
        made = SetFocus(a);
        wsprintf(outcome, "%s ", whose(made));
        state(outcome + lstrlen(outcome));
        end(name, outcome);
    } else if (lstrcmp(name, "focusnull") == 0 || lstrcmp(name, "focusnulleat") == 0) {
        begin(lstrcmp(name, "focusnull") == 0 ? -1 : HCBT_SETFOCUS);
        made = SetFocus(NULL);
        wsprintf(outcome, "%s ", whose(made));
        state(outcome + lstrlen(outcome));
        end(name, outcome);
    } else if (lstrcmp(name, "focusother") == 0) {
        /* The focus given to a window of `U`, which is not active. */
        HWND kid = CreateWindow("CbtProbe", "", WS_CHILD | WS_VISIBLE, 5, 6, 30, 20, u,
                                (HMENU)8, module, NULL);

        q = kid;
        begin(-1);
        made = SetFocus(kid);
        wsprintf(outcome, "%s ", whose(made));
        state(outcome + lstrlen(outcome));
        end(name, outcome);
        q = NULL;
        DestroyWindow(kid);
    } else if (lstrcmp(name, "click") == 0 || lstrcmp(name, "clickeat") == 0) {
        /* `U` pressed and let go in the middle of its client area. */
        RECT inside;
        POINT middle;
        WORD x;
        WORD y;

        GetClientRect(u, &inside);
        middle.x = inside.right / 2;
        middle.y = inside.bottom / 2;
        ClientToScreen(u, &middle);
        x = across(middle.x);
        y = down(middle.y);
        begin(lstrcmp(name, "click") == 0 ? -1 : HCBT_ACTIVATE);
        mouse(0x8001, x, y);
        mouse(0x8002, x, y);
        mouse(0x8004, x, y);
        pump();
        state(outcome);
        end(name, outcome);
    } else if (lstrcmp(name, "minimize") == 0 || lstrcmp(name, "minimizeeat") == 0) {
        begin(lstrcmp(name, "minimize") == 0 ? -1 : HCBT_MINMAX);
        ShowWindow(top, SW_MINIMIZE);
        wsprintf(outcome, "iconic %d ", IsIconic(top) ? 1 : 0);
        state(outcome + lstrlen(outcome));
        end(name, outcome);
        ShowWindow(top, SW_RESTORE);
    } else if (lstrcmp(name, "maximize") == 0) {
        begin(-1);
        ShowWindow(top, SW_SHOWMAXIMIZED);
        wsprintf(outcome, "zoomed %d", IsZoomed(top) ? 1 : 0);
        add("restore");
        ShowWindow(top, SW_RESTORE);
        end(name, outcome);
    } else if (lstrcmp(name, "syscmd") == 0 || lstrcmp(name, "syscmdeat") == 0) {
        begin(lstrcmp(name, "syscmd") == 0 ? -1 : HCBT_SYSCOMMAND);
        SendMessage(top, WM_SYSCOMMAND, SC_MINIMIZE, 0x00120034L);
        wsprintf(outcome, "iconic %d", IsIconic(top) ? 1 : 0);
        end(name, outcome);
        ShowWindow(top, SW_RESTORE);
    } else if (lstrcmp(name, "move") == 0 || lstrcmp(name, "moveeat") == 0) {
        begin(lstrcmp(name, "move") == 0 ? -1 : HCBT_MOVESIZE);
        moveTop(2, FALSE);
        where(outcome, top);
        end(name, outcome);
        MoveWindow(top, 40, 40, 300, 200, TRUE);
    } else if (lstrcmp(name, "movestill") == 0) {
        begin(-1);
        moveTop(0, FALSE);
        where(outcome, top);
        end(name, outcome);
    } else if (lstrcmp(name, "queuesync") == 0) {
        begin(-1);
        moveTop(0, TRUE);
        where(outcome, top);
        end(name, outcome);
    }

    pump();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    module = instance;
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    kind.style = 0;
    kind.lpfnWndProc = WindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "CbtProbe";
    RegisterClass(&kind);

    top = CreateWindow("CbtProbe", "T", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL,
                       module, NULL);
    a = CreateWindow("CbtProbe", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 150, 100, top,
                     (HMENU)1, module, NULL);
    u = CreateWindow("CbtProbe", "U", WS_OVERLAPPEDWINDOW, 360, 40, 200, 150, NULL, NULL,
                     module, NULL);
    ShowWindow(u, SW_SHOWNORMAL);
    UpdateWindow(u);
    ShowWindow(top, SW_SHOWNORMAL);
    UpdateWindow(top);
    SetFocus(a);
    pump();

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    cbtHook = SetWindowsHookEx(WH_CBT, (HOOKPROC)MakeProcInstance((FARPROC)CbtHook, instance),
                               instance, GetCurrentTask());

    run("create");
    run("createedit");
    run("child");
    run("destroy");
    run("destroyeat");
    run("activate");
    run("activateeat");
    run("focus");
    run("focuseat");
    run("focusnull");
    run("focusnulleat");
    run("focusother");
    run("click");
    run("clickeat");
    run("minimize");
    run("minimizeeat");
    run("maximize");
    run("syscmd");
    run("syscmdeat");
    run("move");
    run("moveeat");
    run("movestill");
    run("queuesync");

    UnhookWindowsHookEx(cbtHook);
    probe("unhooked", "", "1");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
