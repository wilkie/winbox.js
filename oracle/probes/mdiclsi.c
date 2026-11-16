/*
 * The MDI client's class as a program finds it: GetClassInfo asked for
 * `MDIClient` with no instance, as Borland's ObjectWindows asks for a
 * class before registering one of its own by that name; and the client
 * made by the procedure it answers, and by DefWindowProc.
 *
 * * `info`: GetClassInfo's answer as `classinf` writes it -- `string atom`
 *   or the number, the style, whether the procedure is the client's own
 *   (`client`, `GetWindowLong(GWL_WNDPROC)` of a client made by
 *   `CreateWindow`) or another (`other`), the class and window extra
 *   bytes, the instance (`mine`, `none`, `other`), the icon, cursor and
 *   brush (`yes`, `none` or the number), the menu name, and whether the
 *   class name is the pointer passed in.
 * * `create`: what the procedure GetClassInfo answered (`proc`) and
 *   DefWindowProc (`default`) answer `WM_MDICREATE` sent through them to
 *   the client -- `window` for a window, else the number -- and how many
 *   children the client has after it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MDICLSI.OUT"

static HINSTANCE mine;
static HWND frame;
static HWND client;
static WNDPROC clientProc;

LRESULT CALLBACK __export FrameProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefFrameProc(window, client, message, wParam, lParam);
}

LRESULT CALLBACK __export ChildProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefMDIChildProc(window, message, wParam, lParam);
}

static void handle(LPSTR out, WORD value)
{
    if (!value) {
        lstrcpy(out, "none");
    } else if (value < 0x40) {
        wsprintf(out, "%u", value);
    } else {
        lstrcpy(out, "yes");
    }
}

static void ask(LPCSTR what, HINSTANCE instance, LPCSTR name)
{
    WNDCLASS kind;
    BOOL answer;
    char icon[8], cursor[8], brush[8], menu[40], owner[8];

    _fmemset(&kind, 0xcc, sizeof(kind));
    answer = GetClassInfo(instance, name, &kind);

    if (!answer) {
        probe("info", what, "0");
        return;
    }

    handle(icon, (WORD)kind.hIcon);
    handle(cursor, (WORD)kind.hCursor);
    handle(brush, (WORD)kind.hbrBackground);

    if (HIWORD((DWORD)kind.lpszMenuName)) {
        lstrcpy(menu, kind.lpszMenuName);
    } else {
        wsprintf(menu, "#%u", LOWORD((DWORD)kind.lpszMenuName));
    }

    if (kind.hInstance == mine) {
        lstrcpy(owner, "mine");
    } else if (!kind.hInstance) {
        lstrcpy(owner, "none");
    } else {
        lstrcpy(owner, "other");
    }

    if ((UINT)answer >= 0xc000) {
        lstrcpy(probeArgs, "string atom");
    } else {
        wsprintf(probeArgs, "%x", (UINT)answer);
    }

    wsprintf(probeResult, "%s style=%x %s cls=%d wnd=%d inst=%s icon=%s cursor=%s brush=%s menu=%s name=%s",
             (LPSTR)probeArgs, kind.style,
             (LPSTR)(kind.lpfnWndProc == clientProc ? "client" : "other"), kind.cbClsExtra,
             kind.cbWndExtra, (LPSTR)owner, (LPSTR)icon, (LPSTR)cursor, (LPSTR)brush,
             (LPSTR)menu, (LPSTR)(kind.lpszClassName == name ? "passed" : "other"));
    probe("info", what, probeResult);
}

static int children(void)
{
    HWND child;
    int count = 0;

    for (child = GetWindow(client, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        count++;
    }

    return count;
}

static void made(LPCSTR what, LRESULT answer)
{
    if (answer && IsWindow((HWND)LOWORD(answer))) {
        wsprintf(probeResult, "window, children=%d", children());
    } else {
        wsprintf(probeResult, "%lx, children=%d", answer, children());
    }

    probe("create", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    WNDCLASS found;
    CLIENTCREATESTRUCT ccs;
    MDICREATESTRUCT mdics;

    probeOpen(OUTPUT);
    mine = instance;

    _fmemset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = FrameProc;
    kind.hInstance = instance;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszClassName = "ClsiFrame";
    RegisterClass(&kind);

    kind.lpfnWndProc = ChildProc;
    kind.lpszClassName = "ClsiChild";
    RegisterClass(&kind);

    frame = CreateWindow("ClsiFrame", "Frame", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, 20, 20,
                         400, 300, NULL, NULL, instance, NULL);
    ccs.hWindowMenu = NULL;
    ccs.idFirstChild = 100;
    client = CreateWindow("MDICLIENT", NULL, WS_CHILD | WS_CLIPCHILDREN | WS_VISIBLE, 0, 0, 380,
                          260, frame, (HMENU)0xcac, instance, (LPSTR)&ccs);
    clientProc = (WNDPROC)GetWindowLong(client, GWL_WNDPROC);

    ask("MDIClient", NULL, "MDIClient");
    ask("MDICLIENT", NULL, "MDICLIENT");
    ask("MDIClient, by my instance", instance, "MDIClient");
    ask("ComboLBox", NULL, "ComboLBox");

    _fmemset(&found, 0, sizeof(found));
    GetClassInfo(NULL, "MDIClient", &found);

    mdics.szClass = "ClsiChild";
    mdics.szTitle = "Child";
    mdics.hOwner = instance;
    mdics.x = CW_USEDEFAULT;
    mdics.y = CW_USEDEFAULT;
    mdics.cx = CW_USEDEFAULT;
    mdics.cy = CW_USEDEFAULT;
    mdics.style = 0;
    mdics.lParam = 0;

    made("proc", found.lpfnWndProc
                     ? CallWindowProc((FARPROC)found.lpfnWndProc, client, WM_MDICREATE, 0,
                                      (LPARAM)(LPMDICREATESTRUCT)&mdics)
                     : 0);
    made("default", DefWindowProc(client, WM_MDICREATE, 0, (LPARAM)(LPMDICREATESTRUCT)&mdics));

    DestroyWindow(frame);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
