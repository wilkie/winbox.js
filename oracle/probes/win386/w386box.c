/*
 * What a Win386 program's supervisor asks of Windows before its 32-bit code,
 * and its box where there is no 32-bit DPMI host: a 16-bit program that asks
 * what the supervisor asks, then starts a Win386 program of its own,
 * `W386BOXC.EXE` (`w386box.child.c`), and reads and answers the box it
 * shows. Recorded in both modes (`record.mjs`, `PROBE_EITHER_MODE`): in
 * standard mode the box is shown, in 386 enhanced mode the program runs.
 *
 * * `asks`: DPMI 0400h, BX's bit 0, which the supervisor tests for a 32-bit
 *   host (bound supervisor seg1 `0077`-`009f`); INT 2Fh FA00h, WATCOM's
 *   debugger's interface, which it asks as its 32-bit task is made
 *   (`07b1`-`07b9`, AX 0666h for the debugger's device): AX after, and
 *   whether BX, CX and DX are as they were (5A5Ah).
 * * `start`: WinExec of the program, given or the error.
 * * `box`: the first top-level window captioned "Open Watcom Win386" seen
 *   as the probe yields: its class and style; then each of its children,
 *   by its order: class, identifier, style and text. "none" where the
 *   program ended with no box.
 * * `end`: the box answered as its OK button's click tells it (the
 *   button's identifier, which is IDCANCEL), and whether the program is
 *   running after.
 */

#define PROBE_WIN16
#define PROBE_EITHER_MODE
#define PROBE_FLUSH
#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\W386BOX.OUT"

/* How many times the probe yields before it gives up waiting. */
#define PATIENCE 2000

static unsigned rAX, rBX, rCX, rDX;

typedef BOOL(FAR PASCAL *WALK)(TASKENTRY FAR *);

static WALK taskFirst, taskNext;

static void multiplex(void)
{
    _asm {
        mov ax, rAX
        mov bx, rBX
        mov cx, rCX
        mov dx, rDX
        int 2fh
        mov rAX, ax
        mov rBX, bx
        mov rCX, cx
        mov rDX, dx
    }
}

static void dpmiVersion(void)
{
    _asm {
        mov ax, 0400h
        int 31h
        mov rAX, ax
        mov rBX, bx
    }
}

/* Whether a task of the program's module runs, by TOOLHELP's walk of the
 * tasks: `wbind` names its module in lower case, `w386boxc`. */
static BOOL running(void)
{
    TASKENTRY entry;
    BOOL more;

    entry.dwSize = sizeof(entry);
    for (more = taskFirst(&entry); more; more = taskNext(&entry)) {
        if (lstrcmpi(entry.szModule, "W386BOXC") == 0) {
            return TRUE;
        }
    }

    return FALSE;
}

/* Lets the other tasks run once. */
static void pause(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    Yield();
}

static void window(LPCSTR label, HWND hwnd)
{
    char name[64];
    char text[160];

    name[0] = '\0';
    text[0] = '\0';
    GetClassName(hwnd, name, sizeof(name));
    GetWindowText(hwnd, text, sizeof(text));
    wsprintf(probeResult, "class=%s id=%d style=%08lx text=%s", (LPSTR)name,
             GetDlgCtrlID(hwnd), GetWindowLong(hwnd, GWL_STYLE), (LPSTR)text);
    probe("box", label, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT started;
    HINSTANCE toolhelp;
    HWND box = NULL;
    HWND child;
    HWND button = NULL;
    int i;
    int order;

    probeOpen(OUTPUT);

    toolhelp = LoadLibrary("TOOLHELP.DLL");
    taskFirst = (WALK)GetProcAddress(toolhelp, "TaskFirst");
    taskNext = (WALK)GetProcAddress(toolhelp, "TaskNext");

    dpmiVersion();
    wsprintf(probeResult, "%u", rBX & 1);
    probe("asks", "DPMI 0400h BX bit 0", probeResult);

    rAX = 0xFA00;
    rBX = 0x5A5A;
    rCX = 0x5A5A;
    rDX = 0x5A5A;
    multiplex();
    wsprintf(probeResult, "ax=%04x others=%s", rAX,
             (LPSTR)(rBX == 0x5A5A && rCX == 0x5A5A && rDX == 0x5A5A ? "kept" : "changed"));
    probe("asks", "INT 2Fh FA00h", probeResult);

    started = WinExec("W386BOXC.EXE", SW_SHOWNORMAL);
    if (started < 32) {
        wsprintf(probeResult, "refused, %u", started);
        probe("start", "WinExec", probeResult);
        probeFinish();
        return 0;
    }
    probe("start", "WinExec", "given");

    for (i = 0; i < PATIENCE && box == NULL && running(); i++) {
        box = FindWindow(NULL, "Open Watcom Win386");
        if (box == NULL) {
            pause();
        }
    }

    if (box == NULL) {
        probe("box", "seen", "none");
    } else {
        window("window", box);
        order = 0;
        for (child = GetWindow(box, GW_CHILD); child != NULL;
             child = GetWindow(child, GW_HWNDNEXT)) {
            char name[16];

            wsprintf(probeArgs, "child %d", order++);
            window(probeArgs, child);

            /* Its one button, clicked as the box's procedure is told of
             * a click: by the button's own identifier. */
            GetClassName(child, name, sizeof(name));
            if (button == NULL && lstrcmpi(name, "Button") == 0) {
                button = child;
            }
        }

        if (button != NULL) {
            PostMessage(box, WM_COMMAND, GetDlgCtrlID(button), MAKELONG(button, BN_CLICKED));
        }
    }

    for (i = 0; i < PATIENCE && running(); i++) {
        pause();
    }

    probe("end", "program", running() ? "running" : "gone");

    FreeLibrary(toolhelp);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
