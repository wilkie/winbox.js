/*
 * A multi-line edit control that scrolls neither down nor has a scroll bar
 * down, as Control Panel's Date & Time's fields are: what it does with text
 * that would make more lines than it shows.
 *
 * The controls are made in the System font with a border. One 44 high shows
 * two lines; one 20 high shows none; one 44 high with a scroll bar down is
 * the same with somewhere for its lines to go.
 *
 * Everything goes in with `SendMessage`: characters with `WM_CHAR`, the
 * clipboard's `WM_PASTE`, `EM_REPLACESEL`, `WM_SETTEXT`, `EM_SETSEL` and
 * `EM_UNDO`.
 *
 * After each step, `state`: the control's text (a CR as `|`, a LF as `/`),
 * its selection, its lines and the first that shows, what `EM_CANUNDO`
 * answers, what the step's last message answered, and the notifications
 * the parent was sent, in order.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MLFULL.OUT"

#ifndef EM_CANUNDO
#define EM_CANUNDO (WM_USER + 22)
#endif

#ifndef EM_GETFIRSTVISIBLELINE
#define EM_GETFIRSTVISIBLELINE (WM_USER + 30)
#endif

static HWND parent;
static HWND edit;
static char log[256];
static LONG answer;
static char prefix[8];

LONG FAR PASCAL _export ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_COMMAND && (HWND)LOWORD(lParam) == edit) {
        char one[8];

        if (lstrlen(log) < 240) {
            wsprintf(one, "%s%x", (LPSTR)(log[0] ? "," : ""), HIWORD(lParam));
            lstrcat(log, one);
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void state(LPCSTR step)
{
    char text[160];
    char name[32];
    int index;
    DWORD selection = SendMessage(edit, EM_GETSEL, 0, 0L);

    GetWindowText(edit, text, sizeof(text));

    for (index = 0; text[index]; index++) {
        if (text[index] == '\r') {
            text[index] = '|';
        }

        if (text[index] == '\n') {
            text[index] = '/';
        }
    }

    wsprintf(name, "%s-%s", (LPSTR)prefix, step);
    wsprintf(probeResult, "text=%s,sel=%d:%d,lines=%ld,first=%ld,can=%ld,ret=%ld,sent=%s",
             (LPSTR)text, LOWORD(selection), HIWORD(selection),
             SendMessage(edit, EM_GETLINECOUNT, 0, 0L),
             SendMessage(edit, EM_GETFIRSTVISIBLELINE, 0, 0L),
             SendMessage(edit, EM_CANUNDO, 0, 0L), answer, (LPSTR)log);
    probe("state", name, probeResult);
    log[0] = '\0';
    answer = 0;
}

static void send(UINT message, WPARAM wParam, LPARAM lParam)
{
    answer = SendMessage(edit, message, wParam, lParam);
}

static void type(LPCSTR text)
{
    while (*text) {
        send(WM_CHAR, (BYTE)*text, 1L);
        text++;
    }
}

static void select(int from, int to)
{
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(from, to));
}

static void put(LPCSTR text)
{
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, lstrlen(text) + 1);

    lstrcpy(GlobalLock(memory), text);
    GlobalUnlock(memory);
    OpenClipboard(parent);
    EmptyClipboard();
    SetClipboardData(CF_TEXT, memory);
    CloseClipboard();
}

static void make(DWORD style, int height, LPCSTR name)
{
    if (edit) {
        DestroyWindow(edit);
    }

    lstrcpy(prefix, name);
    edit = CreateWindow("EDIT", "", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_MULTILINE | style, 10,
                        10, 200, height, parent, (HMENU)100,
                        GetWindowWord(parent, GWW_HINSTANCE), NULL);
    log[0] = '\0';
    answer = 0;
    state("made");
}

/* The same steps in each control. */
static void steps(void)
{
    /* Two lines typed, then Enter on the last. */
    type("one\rtwo");
    state("type");
    type("\r");
    state("enter");
    send(EM_UNDO, 0, 0L);
    state("undo-enter");

    /* Typing on along the last line until it wraps. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "one\r\ntwo");
    select(8, 8);
    type(" three four five six seven eight nine");
    state("wrap");
    send(EM_UNDO, 0, 0L);
    state("undo-wrap");

    /* A selection typed over with Enter. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "one\r\ntwo");
    select(0, 1);
    type("\r");
    state("enter-over");
    send(EM_UNDO, 0, 0L);
    state("undo-enter-over");

    /* A paste of several lines, at the end and over a selection. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "one");
    type("X");
    put("a\r\nb\r\nc");
    select(4, 4);
    send(WM_PASTE, 0, 0L);
    state("paste");
    send(EM_UNDO, 0, 0L);
    state("undo-paste");
    select(0, 2);
    send(WM_PASTE, 0, 0L);
    state("paste-over");

    /* A paste that fits. */
    put("ab\r\ncd");
    select(0, 4);
    send(WM_PASTE, 0, 0L);
    state("paste-fits");

    /* EM_REPLACESEL of several lines, and of one that fits. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "one");
    select(3, 3);
    send(EM_REPLACESEL, 0, (LPARAM)(LPSTR) "\r\nb\r\nc");
    state("replacesel");
    send(EM_REPLACESEL, 0, (LPARAM)(LPSTR) "\r\nb");
    state("replacesel-fits");

    /* More lines than show, set with WM_SETTEXT, then typed in. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "1\r\n2\r\n3\r\n4");
    state("settext");
    select(0, 0);
    type("Z");
    state("type-overfull");
    select(0, 1);
    type("\b");
    state("backspace-overfull");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;

    probeOpen(OUTPUT);

    windowClass.style = 0;
    windowClass.lpfnWndProc = ParentProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "MlFull";
    RegisterClass(&windowClass);
    parent = CreateWindow("MlFull", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200, NULL,
                          NULL, instance, NULL);

    make(0, 44, "two");
    steps();
    make(WS_VSCROLL, 44, "vs");
    steps();

    /* One that shows no whole line. */
    make(0, 20, "none");
    type("a");
    state("type");
    send(EM_REPLACESEL, 0, (LPARAM)(LPSTR) "b");
    state("replacesel");
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "c");
    state("settext");

    DestroyWindow(parent);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
