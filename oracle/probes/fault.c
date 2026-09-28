/*
 * A program that faults: the probe starts one, and posts it the message on
 * which it loads a selector that does not exist into ES; then looks for
 * what Windows shows, and closes it.
 *
 * * `exec`: WinExec's answer, `inst` for an instance.
 * * `box`: each window at the top that is neither the probe's nor the
 *   program's: its class, title, style, window rectangle and client
 *   rectangle; then `child` for each of its children in turn: class, text,
 *   style, identifier and rectangle in the box's client area.
 * * `after`: whether the program's window, and its task, are still there
 *   once the box's first button is pressed.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FAULT.OUT"

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static void settle(DWORD span)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < span) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

static void describe(HWND box)
{
    char name[40];
    char text[160];
    char label[20];
    RECT area;
    RECT client;
    POINT corner;
    HWND child;
    int i = 0;

    GetClassName(box, name, sizeof(name));
    GetWindowText(box, text, sizeof(text));
    GetWindowRect(box, &area);
    GetClientRect(box, &client);
    wsprintf(probeResult, "%s \"%s\" %lx {%d,%d,%d,%d} client %dx%d", (LPSTR)name, (LPSTR)text,
             GetWindowLong(box, GWL_STYLE), area.left, area.top, area.right, area.bottom,
             client.right, client.bottom);
    probe("box", "window", probeResult);

    for (child = GetWindow(box, GW_CHILD); child && i < 12; child = GetWindow(child, GW_HWNDNEXT)) {
        GetClassName(child, name, sizeof(name));
        GetWindowText(child, text, sizeof(text));
        GetWindowRect(child, &area);
        corner.x = area.left;
        corner.y = area.top;
        ScreenToClient(box, &corner);
        wsprintf(probeResult, "%s \"%s\" %lx id=%d {%d,%d,%d,%d}", (LPSTR)name, (LPSTR)text,
                 GetWindowLong(child, GWL_STYLE), GetDlgCtrlID(child), corner.x, corner.y,
                 corner.x + area.right - area.left, corner.y + area.bottom - area.top);
        wsprintf(label, "child %d", i);
        probe("box", label, probeResult);
        i++;
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND window;
    HWND program;
    HWND box = NULL;
    HWND first;
    UINT answer;
    HINSTANCE started;
    char name[40];

    probeOpen(OUTPUT);

    answer = WinExec("FAULTC.EXE", SW_SHOWNORMAL);
    started = (HINSTANCE)answer;
    probe("exec", "program", (LPSTR)(answer > 32 ? "inst" : "error"));
    program = FindWindow("FaultChild", NULL);
    PostMessage(program, WM_USER, 0, 0L);
    probe("posted", "WM_USER", "yes");
    settle(1000);

    probe("program", "window", (LPSTR)(program ? "there" : "gone"));

    for (window = GetWindow(GetDesktopWindow(), GW_CHILD); window;
         window = GetWindow(window, GW_HWNDNEXT)) {
        GetClassName(window, name, sizeof(name));

        if (window != program && IsWindowVisible(window) && lstrcmp(name, "FaultChild")) {
            box = window;
            break;
        }
    }

    if (!box) {
        probe("box", "window", "none");
    } else {
        describe(box);
        probe("box", "task is the program's",
              (LPSTR)(GetWindowTask(box) == GetWindowTask(program) ? "yes" : "no"));
        probe("box", "is system modal", (LPSTR)(GetSysModalWindow() == box ? "yes" : "no"));
        first = GetWindow(box, GW_CHILD);

        while (first) {
            GetClassName(first, name, sizeof(name));

            if (!lstrcmpi(name, "Button")) {
                break;
            }

            first = GetWindow(first, GW_HWNDNEXT);
        }

        if (first) {
            SendMessage(box, WM_COMMAND, GetDlgCtrlID(first), MAKELONG(first, BN_CLICKED));
        }

        settle(1000);
    }

    probe("after", "program's window",
          (LPSTR)(FindWindow("FaultChild", NULL) ? "there" : "gone"));
    probe("after", "box", (LPSTR)(box && IsWindow(box) ? "there" : "gone"));
    probe("after", "usage", (LPSTR)(GetModuleUsage(started) ? "running" : "ended"));
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
