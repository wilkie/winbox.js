/*
 * Undo in edit controls: what is kept to undo, when it is merged, replaced
 * or thrown away, and what undoing does to the text and the selection, in a
 * single-line control, a multi-line one that scrolls down and a multi-line
 * one that does not.
 *
 * Everything goes in with `SendMessage`: characters with `WM_CHAR`, Delete
 * with `WM_KEYDOWN`, Alt and Backspace with `WM_SYSKEYDOWN`, the clipboard's
 * messages, `EM_REPLACESEL`, `WM_SETTEXT`, `EM_SETSEL`, `EM_UNDO`, `WM_UNDO`
 * and `EM_EMPTYUNDOBUFFER`.
 *
 * After each step, `state`: the control's text (a CR as `|`, a LF as `/`),
 * its selection, what `EM_CANUNDO` answers, what the step's last message
 * answered, and the notifications the parent was sent, in order.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EDITUNDO.OUT"

#ifndef EM_CANUNDO
#define EM_CANUNDO (WM_USER + 22)
#endif

#ifndef EM_EMPTYUNDOBUFFER
#define EM_EMPTYUNDOBUFFER (WM_USER + 29)
#endif

static HWND parent;
static HWND edit;
static char log[128];
static LONG answer;
static char prefix[8];

LONG FAR PASCAL _export ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_COMMAND && (HWND)LOWORD(lParam) == edit) {
        char one[8];

        if (lstrlen(log) < 110) {
            wsprintf(one, "%s%x", (LPSTR)(log[0] ? "," : ""), HIWORD(lParam));
            lstrcat(log, one);
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void state(LPCSTR step)
{
    char text[96];
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

        if (text[index] == '\t') {
            text[index] = '^';
        }
    }

    wsprintf(name, "%s-%s", (LPSTR)prefix, step);
    wsprintf(probeResult, "text=%s,sel=%d:%d,can=%ld,ret=%ld,sent=%s", (LPSTR)text,
             LOWORD(selection), HIWORD(selection), SendMessage(edit, EM_CANUNDO, 0, 0L), answer,
             (LPSTR)log);
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

static void make(DWORD style, LPCSTR name)
{
    if (edit) {
        DestroyWindow(edit);
    }

    lstrcpy(prefix, name);
    edit = CreateWindow("EDIT", "", WS_CHILD | WS_VISIBLE | WS_BORDER | style, 10, 10, 240, 60,
                        parent, (HMENU)100, GetWindowWord(parent, GWW_HINSTANCE), NULL);
    log[0] = '\0';
    answer = 0;
    state("made");
}

/* The same steps in each kind of control. */
static void steps(void)
{
    /* Typing, undone, and undone again. */
    type("abc");
    state("type");
    send(EM_UNDO, 0, 0L);
    state("undo");
    send(EM_UNDO, 0, 0L);
    state("redo");
    send(EM_UNDO, 0, 0L);
    state("undo-again");

    /* Setting the text. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "Hello world");
    state("settext");

    /* A run typed, then one typed elsewhere. */
    select(5, 5);
    type(" there");
    state("type-run");
    select(0, 0);
    state("moved");
    send(EM_UNDO, 0, 0L);
    state("undo-run");
    type("X");
    select(0, 0);
    type("Y");
    state("type-elsewhere");
    send(EM_UNDO, 0, 0L);
    state("undo-elsewhere");
    send(EM_UNDO, 0, 0L);
    state("redo-elsewhere");
    send(EM_UNDO, 0, 0L);
    state("undo-elsewhere-again");

    /* Backspaces in a run, and Deletes. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "Hello there world");
    select(11, 11);
    type("\b\b\b");
    state("backspaces");
    send(EM_UNDO, 0, 0L);
    state("undo-backspaces");
    select(0, 0);
    send(WM_KEYDOWN, VK_DELETE, 0x01530001L);
    send(WM_KEYDOWN, VK_DELETE, 0x01530001L);
    state("deletes");
    send(EM_UNDO, 0, 0L);
    state("undo-deletes");
    send(EM_UNDO, 0, 0L);
    state("redo-deletes");

    /* A backspace and then a character where it was. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "Hello there world");
    select(3, 3);
    type("\bQ");
    state("backspace-type");
    send(EM_UNDO, 0, 0L);
    state("undo-backspace-type");

    /* The selection typed over, undone and done again. */
    select(0, 5);
    type("Jo");
    state("replace");
    send(EM_UNDO, 0, 0L);
    state("undo-replace");
    send(EM_UNDO, 0, 0L);
    state("redo-replace");
    send(EM_UNDO, 0, 0L);
    state("undo-replace-again");

    /* The clipboard's messages. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "Hello there world");
    select(6, 12);
    send(WM_CUT, 0, 0L);
    state("cut");
    send(WM_UNDO, 0, 0L);
    state("undo-cut");
    put("Big ");
    select(0, 0);
    send(WM_PASTE, 0, 0L);
    state("paste");
    send(WM_UNDO, 0, 0L);
    state("undo-paste");
    select(0, 5);
    send(WM_PASTE, 0, 0L);
    state("paste-over");
    send(WM_UNDO, 0, 0L);
    state("undo-paste-over");
    select(0, 6);
    send(WM_CLEAR, 0, 0L);
    state("clear");
    send(WM_UNDO, 0, 0L);
    state("undo-clear");

    /* EM_REPLACESEL, EM_SETSEL, EM_EMPTYUNDOBUFFER. */
    select(0, 5);
    send(EM_REPLACESEL, 0, (LPARAM)(LPSTR) "Bye");
    state("replacesel");
    send(EM_UNDO, 0, 0L);
    state("undo-replacesel");
    select(3, 3);
    type("Z");
    select(0, 2);
    state("setsel");
    send(EM_UNDO, 0, 0L);
    state("undo-setsel");
    type("W");
    send(EM_EMPTYUNDOBUFFER, 0, 0L);
    state("empty");
    send(EM_UNDO, 0, 0L);
    state("undo-empty");

    /* What a deletion leaves behind once the text is set again. */
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "abcdef");
    select(1, 3);
    type("\b");
    send(WM_SETTEXT, 0, (LPARAM)(LPSTR) "abcdef");
    select(6, 6);
    type("XY");
    state("stale");
    send(EM_UNDO, 0, 0L);
    state("undo-stale");

    /* Control and Z, and Alt and Backspace. */
    type("12");
    send(WM_CHAR, 0x1a, 1L);
    state("ctrl-z");
    type("34");
    send(WM_SYSKEYDOWN, VK_BACK, 0x200e0001L);
    state("alt-backspace");
    send(WM_SYSCHAR, VK_BACK, 0x200e0001L);
    state("alt-backspace-char");
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
    windowClass.lpszClassName = "EditUndo";
    RegisterClass(&windowClass);
    parent = CreateWindow("EditUndo", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
                          NULL, NULL, instance, NULL);

    make(ES_AUTOHSCROLL, "sl");
    steps();
    make(ES_MULTILINE | ES_AUTOVSCROLL, "ml");
    steps();

    /* A line break typed and undone. */
    type("one\rtwo");
    state("lines");
    send(EM_UNDO, 0, 0L);
    state("undo-lines");

    /* Neither scrolling down nor with a scroll bar down, as Control Panel's
     * Date & Time fields are. */
    make(ES_MULTILINE, "fixed");
    steps();

    DestroyWindow(parent);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
