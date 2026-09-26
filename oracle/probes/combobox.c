/*
 * The combo box: its parts, its list dropped down and put away, its
 * selection, the keys and the mouse, what it tells its parent, and an
 * owner-drawn one.
 *
 * Four combo boxes in an ordinary window, in the System font, each given
 * 100 by 90 and the same fruit:
 *
 * * A, `CBS_DROPDOWNLIST | CBS_SORT`, as `COMMDLG.DLL`'s file types are;
 * * B, `CBS_DROPDOWN | CBS_SORT`, with an edit control;
 * * C, `CBS_SIMPLE | CBS_SORT`, its list always shown;
 * * D, `CBS_DROPDOWNLIST | CBS_OWNERDRAWFIXED | CBS_SORT | CBS_HASSTRINGS`,
 *   as `COMMDLG.DLL`'s drives are.
 *
 * Records:
 *
 * * `rect`: each combo box's window, and each of its children, in the
 *   host's client area, found with `GetWindow`.
 * * `answer`: what a message answered.
 * * `state`: after a step, the count, the current selection, the text, and
 *   whether the list is dropped down.
 * * `notes`: the notifications the parent was sent, each id and code.
 * * `measure`, `draw`: each `WM_MEASUREITEM` and `WM_DRAWITEM` the parent got.
 * * `area`, `rows`: a stretch of the screen from each combo box down, a row a
 *   record, by capture name.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\COMBOBOX.OUT"

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
static HWND host;

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
            SendMessage(item->hwndItem, item->CtlType == ODT_COMBOBOX ? CB_GETLBTEXT : LB_GETTEXT,
                        item->itemID, (LPARAM)(LPSTR)text);
        }

        wsprintf(probeArgs, "%d", drawn++);
        wsprintf(probeResult,
                 "type=%d,id=%d,item=%d,action=%x,state=%x,rect=%d:%d:%d:%d,data=%lx,text=%s",
                 item->CtlType, item->CtlID, item->itemID, item->itemAction, item->itemState,
                 item->rcItem.left, item->rcItem.top, item->rcItem.right, item->rcItem.bottom,
                 item->itemData, (LPSTR)text);
        probe("draw", probeArgs, probeResult);

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

static void state(HWND box, LPCSTR step)
{
    char text[40];

    GetWindowText(box, text, sizeof(text));
    wsprintf(probeResult, "count=%d,sel=%d,text=%s,dropped=%d",
             (int)SendMessage(box, CB_GETCOUNT, 0, 0L), (int)SendMessage(box, CB_GETCURSEL, 0, 0L),
             (LPSTR)text, (int)SendMessage(box, CB_GETDROPPEDSTATE, 0, 0L));
    probe("state", step, probeResult);
    probe("notes", step, notes);
    notes[0] = '\0';
}

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("answer", what, probeResult);
}

/* A window's rectangle in the host's client area. */
static void rect(LPCSTR name, HWND window)
{
    RECT r;
    POINT corner;

    corner.x = 0;
    corner.y = 0;
    ClientToScreen(host, &corner);
    GetWindowRect(window, &r);
    wsprintf(probeResult, "%d:%d:%d:%d", r.left - corner.x, r.top - corner.y, r.right - corner.x,
             r.bottom - corner.y);
    probe("rect", name, probeResult);
}

static void parts(LPCSTR name, HWND box)
{
    HWND child;
    int index = 0;
    char label[32];
    char kind[16];

    rect(name, box);

    for (child = GetWindow(box, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        GetClassName(child, kind, sizeof(kind));
        wsprintf(label, "%s,child%d,%s", name, index++, (LPSTR)kind);
        rect(label, child);
    }
}

/* The screen from a combo box's corner, 104 across and 110 down. */
static void capture(HWND box, LPCSTR name)
{
    RECT r;
    HDC screen = GetDC(NULL);
    int x;
    int y;

    GetWindowRect(box, &r);
    wsprintf(probeResult, "%d:%d", r.left, r.top);
    probe("area", name, probeResult);

    for (y = r.top; y < r.top + 110; y++) {
        LPSTR out = probeResult;

        for (x = r.left; x < r.left + 104; x++) {
            *out++ = digit(GetPixel(screen, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - r.top);
        probe("rows", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void key(HWND box, int vk)
{
    SendMessage(box, WM_KEYDOWN, vk, 1L);
    SendMessage(box, WM_KEYUP, vk, 0xC0000001L);
}

static const char *WORDS[] = { "pear", "apple", "fig", "banana", "cherry", "grape", "kiwi", "lemon" };

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND a;
    HWND b;
    HWND c;
    HWND d;
    int index;
    DWORD style = WS_CHILD | WS_VISIBLE | WS_VSCROLL | CBS_SORT;

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
    windowClass.lpszClassName = "ComboHost";
    RegisterClass(&windowClass);

    host = CreateWindow("ComboHost", "Combos", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 520, 280,
                        NULL, NULL, instance, NULL);
    a = CreateWindow("COMBOBOX", "", style | CBS_DROPDOWNLIST, 8, 8, 100, 90, host, (HMENU)100,
                     instance, NULL);
    b = CreateWindow("COMBOBOX", "", style | CBS_DROPDOWN, 130, 8, 100, 90, host, (HMENU)101,
                     instance, NULL);
    c = CreateWindow("COMBOBOX", "", style | CBS_SIMPLE, 250, 8, 100, 90, host, (HMENU)102,
                     instance, NULL);
    d = CreateWindow("COMBOBOX", "",
                     style | CBS_DROPDOWNLIST | CBS_OWNERDRAWFIXED | CBS_HASSTRINGS, 370, 8, 100,
                     90, host, (HMENU)103, instance, NULL);

    UpdateWindow(host);
    pump();
    notes[0] = '\0';

    parts("a", a);
    parts("b", b);
    parts("c", c);
    parts("d", d);

    for (index = 0; index < 8; index++) {
        wsprintf(probeArgs, "add%d", index);
        answer(probeArgs, SendMessage(a, CB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[index]));
        SendMessage(b, CB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[index]);
        SendMessage(c, CB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[index]);
        SendMessage(d, CB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[index]);
    }

    pump();
    state(a, "filled");

    answer("setcursel", SendMessage(a, CB_SETCURSEL, 2, 0L));
    SendMessage(b, CB_SETCURSEL, 3, 0L);
    SendMessage(c, CB_SETCURSEL, 4, 0L);
    SendMessage(d, CB_SETCURSEL, 1, 0L);
    pump();
    state(a, "setcursel");
    state(b, "bsetcursel");
    state(c, "csetcursel");
    state(d, "dsetcursel");
    answer("findstring", SendMessage(a, CB_FINDSTRING, (WPARAM)-1, (LPARAM)(LPSTR)"ki"));
    answer("lbtextlen", SendMessage(a, CB_GETLBTEXTLEN, 5, 0L));
    answer("itemheight", SendMessage(a, CB_GETITEMHEIGHT, 0, 0L));
    answer("editheight", SendMessage(a, CB_GETITEMHEIGHT, (WPARAM)-1, 0L));

    capture(a, "a");
    capture(b, "b");
    capture(c, "c");
    capture(d, "d");

    /* Focus, and the keys on a list that is not dropped. */
    SetFocus(a);
    pump();
    state(a, "focus");
    capture(a, "afocus");
    key(a, VK_DOWN);
    pump();
    state(a, "down");
    SendMessage(a, WM_CHAR, 'k', 1L);
    pump();
    state(a, "char");

    /* Dropped down, and put away. */
    answer("showdropdown", SendMessage(a, CB_SHOWDROPDOWN, TRUE, 0L));
    pump();
    state(a, "dropped");
    capture(a, "adropped");
    key(a, VK_DOWN);
    pump();
    state(a, "droppeddown");
    key(a, VK_RETURN);
    pump();
    state(a, "enter");
    capture(a, "aclosed");

    /* The edit control's own text. */
    SetFocus(b);
    pump();
    SetWindowText(b, "melon");
    pump();
    state(b, "settext");
    answer("seleditsel", SendMessage(b, CB_SETEDITSEL, 0, MAKELONG(1, 3)));
    answer("geteditsel", SendMessage(b, CB_GETEDITSEL, 0, 0L));
    capture(b, "bedit");

    /* Owner-drawn, dropped. */
    SetFocus(d);
    pump();
    SendMessage(d, CB_SHOWDROPDOWN, TRUE, 0L);
    pump();
    state(d, "ddropped");
    capture(d, "ddropped");
    SendMessage(d, CB_SHOWDROPDOWN, FALSE, 0L);
    pump();
    state(d, "dclosed");

    answer("resetcontent", SendMessage(a, CB_RESETCONTENT, 0, 0L));
    pump();
    state(a, "reset");

    DestroyWindow(host);
    pump();
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
