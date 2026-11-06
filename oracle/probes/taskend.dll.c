/*
 * The library `taskend.c` and its child share: the probe loads it before
 * the child starts and keeps it after the child ends, so what the child
 * leaves in it -- hooks whose procedures are here, a class whose window
 * procedure is here -- can be watched without calling the child's freed
 * code.
 *
 * * Windows by number, 0 to 7: `w1` the child's main window, `w1a` a
 *   button in it, `w1b` a window of the child's class in it, `w2` a popup
 *   `w1` owns, `w3` a window of the class `TEGLOBAL`, `w4` a child window
 *   of the probe's `p` the child made, `w5` a popup of the probe's that
 *   `w1` owns, `p` the probe's window.
 * * A log: while `TeLogging` is on, what `TeNote` is told, as
 *   `<who>:<window>:<message>`, each followed by a space.
 * * Five message hooks, `TeHook0` to `TeHook4`: each counts its calls,
 *   adds its digit to the order while that is kept, and passes the call on,
 *   with `CallNextHookEx` or, for a hook put in with `SetWindowsHook`,
 *   `DefHookProc`. From `TeOrderBegin`, only calls in the task it names
 *   are counted.
 * * `TeWndProc`, `TEGLOBAL`'s window procedure, which notes each message
 *   as `d`.
 */

#include <windows.h>

#define WINDOWS 8
#define HOOKS 8

static HWND windows[WINDOWS];
static char text[1600];
static int length;
static BOOL logging;
static long counts[HOOKS];
static DWORD hooks[HOOKS];
static BOOL old[HOOKS];
static char order[32];
static int ordered;
static BOOL ordering;
static BOOL ready;
static HTASK only;

static const char *const NAMES[WINDOWS] = {"w1", "w1a", "w1b", "w2", "w3", "w4", "w5", "p"};

static void append(LPCSTR what)
{
    int size = lstrlen(what);

    if (length + size + 1 < (int)sizeof(text)) {
        lstrcpy(text + length, what);
        length += size;
    }
}

/* A window's name, or its handle where it has none. */
void FAR PASCAL _export TeNameOf(HWND hwnd, LPSTR out)
{
    int i;

    for (i = 0; i < WINDOWS; i++) {
        if (windows[i] && windows[i] == hwnd) {
            lstrcpy(out, NAMES[i]);
            return;
        }
    }

    wsprintf(out, "%04X", (UINT)hwnd);
}

/* Whether a window is one of those named. */
BOOL FAR PASCAL _export TeNamed(HWND hwnd)
{
    int i;

    for (i = 0; i < WINDOWS; i++) {
        if (windows[i] && windows[i] == hwnd) {
            return TRUE;
        }
    }

    return FALSE;
}

void FAR PASCAL _export TeSetWindow(int which, HWND hwnd)
{
    windows[which] = hwnd;
}

HWND FAR PASCAL _export TeWindow(int which)
{
    return windows[which];
}

void FAR PASCAL _export TeLogging(BOOL on)
{
    logging = on;
}

/* Notes a message a window was given, while the log is on. */
void FAR PASCAL _export TeNote(LPCSTR who, HWND hwnd, UINT message)
{
    char name[8];
    char line[32];

    if (!logging) {
        return;
    }

    TeNameOf(hwnd, name);
    wsprintf(line, "%s:%s:%x ", who, (LPSTR)name, message);
    append(line);
}

/* Notes a line of the caller's own, while the log is on. */
void FAR PASCAL _export TeText(LPCSTR line)
{
    if (logging) {
        append(line);
    }
}

/* The log, taken and emptied. */
void FAR PASCAL _export TeTake(LPSTR out)
{
    lstrcpy(out, length ? text : "none");
    length = 0;
    text[0] = '\0';
}

void FAR PASCAL _export TeSetHook(int which, DWORD hook, BOOL isOld)
{
    hooks[which] = hook;
    old[which] = isOld;
}

DWORD FAR PASCAL _export TeHookOf(int which)
{
    return hooks[which];
}

long FAR PASCAL _export TeCount(int which, BOOL reset)
{
    long count = counts[which];

    if (reset) {
        counts[which] = 0;
    }

    return count;
}

/* The order hooks were called in, from when it is begun to the first hook
 * called twice; and from then the calls counted only in this task. */
void FAR PASCAL _export TeOrderBegin(HTASK task)
{
    only = task;
    ordered = 0;
    order[0] = '\0';
    ordering = TRUE;
}

void FAR PASCAL _export TeMark(int which)
{
    int i;

    if (!ordering) {
        return;
    }

    for (i = 0; i < ordered; i++) {
        if (order[i] == (char)('0' + which)) {
            ordering = FALSE;
            return;
        }
    }

    if (ordered + 1 < (int)sizeof(order)) {
        order[ordered++] = (char)('0' + which);
        order[ordered] = '\0';
    }
}

void FAR PASCAL _export TeOrder(LPSTR out)
{
    ordering = FALSE;
    lstrcpy(out, ordered ? order : "none");
}

void FAR PASCAL _export TeSetReady(BOOL on)
{
    ready = on;
}

BOOL FAR PASCAL _export TeReady(void)
{
    return ready;
}

/* Whether a call is in the task being watched. */
static BOOL watched(void)
{
    return !only || GetCurrentTask() == only;
}

static DWORD pass(int which, int code, WPARAM wParam, LPARAM lParam)
{
    if (watched()) {
        counts[which]++;
        TeMark(which);
    }

    if (old[which]) {
        return DefHookProc(code, wParam, lParam, (HOOKPROC FAR *)&hooks[which]);
    }

    return CallNextHookEx((HHOOK)hooks[which], code, wParam, lParam);
}

DWORD FAR PASCAL _export TeHook0(int code, WPARAM wParam, LPARAM lParam)
{
    return pass(0, code, wParam, lParam);
}

DWORD FAR PASCAL _export TeHook1(int code, WPARAM wParam, LPARAM lParam)
{
    return pass(1, code, wParam, lParam);
}

DWORD FAR PASCAL _export TeHook2(int code, WPARAM wParam, LPARAM lParam)
{
    return pass(2, code, wParam, lParam);
}

DWORD FAR PASCAL _export TeHook3(int code, WPARAM wParam, LPARAM lParam)
{
    return pass(3, code, wParam, lParam);
}

DWORD FAR PASCAL _export TeHook4(int code, WPARAM wParam, LPARAM lParam)
{
    return pass(4, code, wParam, lParam);
}

/* Counts a call of a hook outside this library, as the probe's own: its
 * count and its mark. */
void FAR PASCAL _export TeCounted(int which)
{
    if (watched()) {
        counts[which]++;
        TeMark(which);
    }
}

/* The hooks the child put in that are left after it ends, taken out: the
 * one `SetWindowsHook` put in, and the one put in for this library. */
void FAR PASCAL _export TeUnhookLeft(LPSTR out)
{
    BOOL first = UnhookWindowsHook(WH_GETMESSAGE, (HOOKPROC)TeHook2);
    BOOL second = UnhookWindowsHookEx((HHOOK)hooks[3]);

    wsprintf(out, "%d,%d", first, second);
}

LRESULT FAR PASCAL _export TeWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    TeNote("d", hwnd, message);
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}
