/*
 * Cut, copy, paste and clear in edit controls: `WM_CUT`, `WM_COPY`,
 * `WM_PASTE` and `WM_CLEAR`, in a single-line and a multi-line control.
 *
 * After each step:
 *
 * * `state`: the control's text (a line break as `|`), its selection, what
 *   `CF_TEXT` on the clipboard holds (or `none`), who owns the clipboard (`E`
 *   the control, `P` its parent, `0` none, `?` another) and how many formats
 *   it has, and the notifications the parent was sent, in order.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EDITCLIP.OUT"

static HWND parent;
static HWND edit;
static char log[128];

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

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
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

static void emptied(void)
{
    OpenClipboard(parent);
    EmptyClipboard();
    CloseClipboard();
}

static void state(LPCSTR step)
{
    char text[64];
    char held[64];
    LPSTR out;
    int index;
    DWORD selection = SendMessage(edit, EM_GETSEL, 0, 0L);
    HWND owner;
    HANDLE data;

    GetWindowText(edit, text, sizeof(text));

    for (index = 0; text[index]; index++) {
        if (text[index] == '\r') {
            text[index] = '|';
        }

        if (text[index] == '\n') {
            text[index] = '/';
        }
    }

    lstrcpy(held, "none");
    OpenClipboard(parent);
    data = GetClipboardData(CF_TEXT);

    if (data) {
        lstrcpyn(held, GlobalLock(data), sizeof(held));
        GlobalUnlock(data);

        for (index = 0; held[index]; index++) {
            if (held[index] == '\r') {
                held[index] = '|';
            }

            if (held[index] == '\n') {
                held[index] = '/';
            }
        }
    }

    owner = GetClipboardOwner();
    wsprintf(probeResult, "text=%s,sel=%d:%d,clip=%s,owner=%s,formats=%d,sent=%s", (LPSTR)text,
             LOWORD(selection), HIWORD(selection), (LPSTR)held,
             (LPSTR)(owner == edit ? "E" : owner == parent ? "P" : owner ? "?" : "0"),
             CountClipboardFormats(), (LPSTR)log);
    CloseClipboard();
    probe("state", step, probeResult);
    log[0] = '\0';
}

static void message(LPCSTR step, UINT number)
{
    log[0] = '\0';
    SendMessage(edit, number, 0, 0L);
    pump();
    state(step);
}

static void make(DWORD style, LPCSTR text)
{
    if (edit) {
        DestroyWindow(edit);
    }

    edit = CreateWindow("EDIT", text, WS_CHILD | WS_VISIBLE | WS_BORDER | style, 10, 10, 200, 60,
                        parent, (HMENU)100, GetWindowWord(parent, GWW_HINSTANCE), NULL);
    pump();
    log[0] = '\0';
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
    windowClass.lpszClassName = "EditClip";
    RegisterClass(&windowClass);
    parent = CreateWindow("EditClip", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
                          NULL, NULL, instance, NULL);

    /* A single line. */
    make(ES_AUTOHSCROLL, "Hello world");
    emptied();
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(6, 11));
    message("copy", WM_COPY);
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(3, 3));
    message("copy-nothing", WM_COPY);
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(0, 6));
    message("cut", WM_CUT);
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(5, 5));
    message("paste", WM_PASTE);
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(0, 5));
    message("clear", WM_CLEAR);
    put("one\r\ntwo");
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(0, 0));
    message("paste-lines", WM_PASTE);
    emptied();
    message("paste-empty", WM_PASTE);
    SetWindowText(edit, "abc");
    SendMessage(edit, EM_LIMITTEXT, 6, 0L);
    put("0123456789");
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(1, 1));
    message("paste-limit", WM_PASTE);

    /* Several lines. */
    make(ES_MULTILINE | ES_AUTOVSCROLL, "first\r\nsecond");
    put("one\r\ntwo");
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(5, 5));
    message("ml-paste", WM_PASTE);
    SendMessage(edit, EM_SETSEL, 0, MAKELONG(3, 12));
    message("ml-copy", WM_COPY);
    message("ml-cut", WM_CUT);

    DestroyWindow(parent);
    probeFinish();

    return 0;
}
