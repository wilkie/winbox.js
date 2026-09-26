/*
 * The list box: its items, its selection, its scrolling, the keys and the
 * mouse, what it tells its parent, and an owner-drawn one.
 *
 * Three list boxes in an ordinary window, in the System font:
 *
 * * A, sorted, notifying, a border and a vertical scroll bar, 100 by 84,
 *   given more items than show;
 * * B, the same with `LBS_MULTIPLESEL`;
 * * C, owner-drawn with fixed heights and strings kept (`LBS_OWNERDRAWFIXED
 *   | LBS_HASSTRINGS`), as `COMMDLG.DLL`'s file lists are.
 *
 * Everything is sent with `SendMessage`. Records:
 *
 * * `answer`: what a message answered.
 * * `state`: after a step, the count, the current selection, the top index,
 *   the caret, the vertical scroll position, and the selected count for B.
 * * `notes`: the notifications the parent was sent, each `WM_COMMAND`'s code.
 * * `measure`: each `WM_MEASUREITEM` the parent got: control, item, height
 *   and width it arrived with.
 * * `draw`: each `WM_DRAWITEM`: item, action, state, rectangle, item data.
 * * `rows`: the control's pixels, a row a record, by capture name.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LISTBOX.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

static char notes[256];
static int measured = 0;
static int drawn = 0;

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_COMMAND && LOWORD(lParam) != 0) {
        int length = lstrlen(notes);

        if (length < 240) {
            wsprintf(notes + length, "%s%d:%x", (LPSTR)(length ? "," : ""), wParam, HIWORD(lParam));
        }

        return 0;
    }

    if (message == WM_MEASUREITEM) {
        MEASUREITEMSTRUCT FAR *item = (MEASUREITEMSTRUCT FAR *)lParam;

        wsprintf(probeArgs, "%d", measured++);
        wsprintf(probeResult, "type=%d,id=%d,item=%d,width=%d,height=%d", item->CtlType, item->CtlID,
                 item->itemID, item->itemWidth, item->itemHeight);
        probe("measure", probeArgs, probeResult);
        item->itemHeight = 14;
        return TRUE;
    }

    if (message == WM_DRAWITEM) {
        DRAWITEMSTRUCT FAR *item = (DRAWITEMSTRUCT FAR *)lParam;
        char text[32];

        text[0] = '\0';

        if ((int)item->itemID >= 0) {
            SendMessage(item->hwndItem, LB_GETTEXT, item->itemID, (LPARAM)(LPSTR)text);
        }

        wsprintf(probeArgs, "%d", drawn++);
        wsprintf(probeResult,
                 "type=%d,id=%d,item=%d,action=%x,state=%x,rect=%d:%d:%d:%d,data=%lx,text=%s",
                 item->CtlType, item->CtlID, item->itemID, item->itemAction, item->itemState,
                 item->rcItem.left, item->rcItem.top, item->rcItem.right, item->rcItem.bottom,
                 item->itemData, (LPSTR)text);
        probe("draw", probeArgs, probeResult);

        /* Drawn so the pixels say it was: the text, inverted when selected. */
        if ((int)item->itemID >= 0 && item->itemAction & (ODA_DRAWENTIRE | ODA_SELECT)) {
            TextOut(item->hDC, item->rcItem.left + 2, item->rcItem.top, text, lstrlen(text));

            if (item->itemState & ODS_SELECTED) {
                InvertRect(item->hDC, &item->rcItem);
            }
        }

        return TRUE;
    }

    if (message == WM_DESTROY) {
        PostQuitMessage(0);
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

static void state(HWND box, LPCSTR step, BOOL multiple)
{
    wsprintf(probeResult, "count=%d,sel=%d,top=%d,caret=%d,v=%d,selcount=%d",
             (int)SendMessage(box, LB_GETCOUNT, 0, 0L), (int)SendMessage(box, LB_GETCURSEL, 0, 0L),
             (int)SendMessage(box, LB_GETTOPINDEX, 0, 0L),
             (int)SendMessage(box, LB_GETCARETINDEX, 0, 0L), GetScrollPos(box, SB_VERT),
             multiple ? (int)SendMessage(box, LB_GETSELCOUNT, 0, 0L) : -1);
    probe("state", step, probeResult);
    probe("notes", step, notes);
    notes[0] = '\0';
}

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("answer", what, probeResult);
}

static void capture(HWND box, LPCSTR name)
{
    RECT window;
    HDC screen = GetDC(NULL);
    int x;
    int y;

    GetWindowRect(box, &window);

    for (y = window.top; y < window.bottom; y++) {
        LPSTR out = probeResult;

        for (x = window.left; x < window.right; x++) {
            *out++ = digit(GetPixel(screen, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - window.top);
        probe("rows", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void key(HWND box, int vk)
{
    SendMessage(box, WM_KEYDOWN, vk, 1L);
    SendMessage(box, WM_KEYUP, vk, 0xC0000001L);
}

static void click(HWND box, int x, int y)
{
    SendMessage(box, WM_LBUTTONDOWN, MK_LBUTTON, MAKELONG(x, y));
    SendMessage(box, WM_LBUTTONUP, 0, MAKELONG(x, y));
}

static const char *WORDS[] = { "pear",  "apple", "fig",   "banana", "cherry", "grape", "kiwi",
                               "lemon", "mango", "olive", "peach",  "plum",   "date",  "lime" };

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    HWND a;
    HWND b;
    HWND c;
    int index;
    DWORD style = WS_CHILD | WS_VISIBLE | WS_BORDER | WS_VSCROLL | LBS_NOTIFY;
    char text[32];

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    windowClass.style = 0;
    windowClass.lpfnWndProc = HostProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "ListHost";
    RegisterClass(&windowClass);

    host = CreateWindow("ListHost", "Lists", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 400, 200,
                        NULL, NULL, instance, NULL);
    a = CreateWindow("LISTBOX", "", style | LBS_SORT, 8, 8, 100, 84, host, (HMENU)100, instance,
                     NULL);
    b = CreateWindow("LISTBOX", "", style | LBS_MULTIPLESEL, 120, 8, 100, 84, host, (HMENU)101,
                     instance, NULL);
    c = CreateWindow("LISTBOX", "",
                     style | LBS_SORT | LBS_OWNERDRAWFIXED | LBS_HASSTRINGS, 232, 8, 100, 84, host,
                     (HMENU)102, instance, NULL);

    UpdateWindow(host);
    pump();
    notes[0] = '\0';

    /* Filled: sorted in A and C, in order in B. */
    for (index = 0; index < 14; index++) {
        wsprintf(probeArgs, "add%d", index);
        answer(probeArgs, SendMessage(a, LB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[index]));
        SendMessage(b, LB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[index]);
        SendMessage(c, LB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[index]);
    }

    pump();
    state(a, "filled", FALSE);
    capture(a, "filled");
    capture(c, "cfilled");

    answer("insert", SendMessage(a, LB_INSERTSTRING, 2, (LPARAM)(LPSTR)"zzz"));
    answer("findstring", SendMessage(a, LB_FINDSTRING, (WPARAM)-1, (LPARAM)(LPSTR)"ch"));
    answer("findexact", SendMessage(a, LB_FINDSTRINGEXACT, (WPARAM)-1, (LPARAM)(LPSTR)"lime"));
    answer("textlen", SendMessage(a, LB_GETTEXTLEN, 3, 0L));
    SendMessage(a, LB_GETTEXT, 3, (LPARAM)(LPSTR)text);
    probe("text", "3", text);
    answer("delete", SendMessage(a, LB_DELETESTRING, 2, 0L));
    answer("itemheight", SendMessage(a, LB_GETITEMHEIGHT, 0, 0L));

    /* The selection, set and moved. */
    answer("setcursel", SendMessage(a, LB_SETCURSEL, 9, 0L));
    pump();
    state(a, "setcursel", FALSE);
    capture(a, "selected");

    SetFocus(a);
    pump();
    state(a, "focus", FALSE);
    capture(a, "focused");

    key(a, VK_DOWN);
    state(a, "down", FALSE);
    key(a, VK_NEXT);
    state(a, "pagedown", FALSE);
    key(a, VK_END);
    state(a, "end", FALSE);
    capture(a, "end");
    key(a, VK_HOME);
    state(a, "home", FALSE);
    SendMessage(a, WM_CHAR, 'm', 1L);
    state(a, "char", FALSE);

    /* The mouse. */
    click(a, 20, 20);
    state(a, "click", FALSE);
    SendMessage(a, WM_VSCROLL, SB_LINEDOWN, 0L);
    state(a, "linedown", FALSE);
    SendMessage(a, WM_VSCROLL, SB_PAGEDOWN, 0L);
    state(a, "vpagedown", FALSE);
    capture(a, "scrolled");
    answer("settopindex", SendMessage(a, LB_SETTOPINDEX, 3, 0L));
    state(a, "settopindex", FALSE);

    /* Many at once. */
    SendMessage(b, LB_SETSEL, TRUE, 1L);
    SendMessage(b, LB_SETSEL, TRUE, 3L);
    state(b, "multi", TRUE);
    click(b, 20, 40);
    state(b, "multiclick", TRUE);
    answer("getsel3", SendMessage(b, LB_GETSEL, 3, 0L));
    capture(b, "multi");

    /* Owner-drawn: selected, and focused. */
    SendMessage(c, LB_SETCURSEL, 2, 0L);
    pump();
    SetFocus(c);
    pump();
    key(c, VK_DOWN);
    pump();
    state(c, "owner", FALSE);
    capture(c, "owner");

    answer("resetcontent", SendMessage(a, LB_RESETCONTENT, 0, 0L));
    pump();
    state(a, "reset", FALSE);

    DestroyWindow(host);
    pump();
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
