/*
 * The single-line edit control: typing, the caret, the keys, the selection.
 *
 * Two edit controls, 120 by 20 with a border and `ES_AUTOHSCROLL`, in an
 * ordinary window: the first in the System font, the second given bold MS
 * Sans Serif 8 with `WM_SETFONT` and made with the text "Sans". Everything is
 * sent to them with `SendMessage`, so no keyboard is involved:
 *
 * * `caret`: `GetCaretPos` after each step, in the control's client area.
 * * `sel`: what `EM_GETSEL` answers, start and end.
 * * `text`: the control's text.
 * * `notes`: the notifications the parent was sent since the last record,
 *   each `WM_COMMAND`'s code in hexadecimal.
 * * `caretpix`: the caret's pixels -- each one that differs between the
 *   control read with the caret shown and read after `HideCaret` -- relative
 *   to the control's window rectangle, with the colour shown.
 * * `rows`: the control's pixels with the caret hidden, a row a record.
 * * `blink`: `GetCaretBlinkTime`.
 * * `focused`: which control has the focus after a click, 1 or 2.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EDITCTL.OUT"

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

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_COMMAND && LOWORD(lParam) != 0) {
        int length = lstrlen(notes);

        if (length < 240) {
            wsprintf(notes + length, "%s%x", (LPSTR)(length ? ":" : ""), HIWORD(lParam));
        }

        return 0;
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

/* The caret, the selection, the text and the notifications, after a step. */
static void state(HWND edit, LPCSTR step)
{
    POINT caret;
    DWORD selection = SendMessage(edit, EM_GETSEL, 0, 0L);
    char text[80];

    GetCaretPos(&caret);
    wsprintf(probeResult, "%d:%d", caret.x, caret.y);
    probe("caret", step, probeResult);

    wsprintf(probeResult, "%d:%d", LOWORD(selection), HIWORD(selection));
    probe("sel", step, probeResult);

    GetWindowText(edit, text, sizeof(text));
    probe("text", step, text);

    probe("notes", step, notes);
    notes[0] = '\0';
}

/* The control's pixels, into a buffer a row of 120 at a time. */
static char shown[24][121];

static void read(HWND edit, char rows[24][121])
{
    RECT window;
    HDC screen = GetDC(NULL);
    int x;
    int y;

    GetWindowRect(edit, &window);

    for (y = 0; y < 24 && window.top + y < window.bottom; y++) {
        for (x = 0; x < 120 && window.left + x < window.right; x++) {
            rows[y][x] = digit(GetPixel(screen, window.left + x, window.top + y));
        }

        rows[y][x] = '\0';
    }

    ReleaseDC(NULL, screen);
}

/* The caret's pixels and the control's, the caret shown afresh first. */
static void capture(HWND edit, LPCSTR name)
{
    static char hidden[24][121];
    LPSTR out = probeResult;
    int x;
    int y;

    HideCaret(edit);
    ShowCaret(edit);
    read(edit, shown);
    HideCaret(edit);
    read(edit, hidden);

    *out = '\0';

    for (y = 0; y < 24; y++) {
        for (x = 0; hidden[y][x]; x++) {
            if (shown[y][x] != hidden[y][x] && out < probeResult + 2000) {
                out += wsprintf(out, "%s%d:%d=%c", (LPSTR)(out == probeResult ? "" : ","), x, y,
                                shown[y][x]);
            }
        }
    }

    probe("caretpix", name, probeResult);

    for (y = 0; y < 24 && hidden[y][0]; y++) {
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, hidden[y]);
    }

    ShowCaret(edit);
}

static void type(HWND edit, LPCSTR text)
{
    while (*text) {
        SendMessage(edit, WM_CHAR, (WPARAM)(BYTE)*text++, 1L);
    }
}

static void key(HWND edit, int vk)
{
    SendMessage(edit, WM_KEYDOWN, vk, 1L);
    SendMessage(edit, WM_KEYUP, vk, 0xC0000001L);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    HWND first;
    HWND second;
    HFONT font;
    HDC screen;
    char step[32];
    int index;

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
    windowClass.lpszClassName = "EditHost";
    RegisterClass(&windowClass);

    host = CreateWindow("EditHost", "Edit", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 300, 160,
                        NULL, NULL, instance, NULL);
    first = CreateWindow("EDIT", "", WS_CHILD | WS_VISIBLE | WS_BORDER | ES_AUTOHSCROLL | ES_LEFT,
                         8, 8, 120, 20, host, (HMENU)100, instance, NULL);
    second = CreateWindow("EDIT", "Sans",
                          WS_CHILD | WS_VISIBLE | WS_BORDER | ES_AUTOHSCROLL | ES_LEFT, 8, 40, 120,
                          20, host, (HMENU)101, instance, NULL);

    screen = GetDC(NULL);
    font = CreateFont(-MulDiv(8, GetDeviceCaps(screen, LOGPIXELSY), 72), 0, 0, 0, FW_BOLD, 0, 0, 0,
                      ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                      VARIABLE_PITCH | FF_SWISS, "MS Sans Serif");
    ReleaseDC(NULL, screen);
    SendMessage(second, WM_SETFONT, (WPARAM)font, 0L);

    UpdateWindow(host);
    pump();
    notes[0] = '\0';

    wsprintf(probeResult, "%d", GetCaretBlinkTime());
    probe("blink", "", probeResult);

    /* Focus, and the empty control. */
    SetFocus(first);
    pump();
    state(first, "focus");
    capture(first, "empty");

    /* Typed a character at a time. */
    for (index = 0; index < 5; index++) {
        char one[2];

        one[0] = "Hello"[index];
        one[1] = '\0';
        type(first, one);
        wsprintf(step, "type%d", index + 1);
        state(first, step);
    }

    capture(first, "hello");

    /* The keys that move. */
    key(first, VK_HOME);
    state(first, "home");
    key(first, VK_RIGHT);
    key(first, VK_RIGHT);
    state(first, "right2");
    key(first, VK_END);
    state(first, "end");
    key(first, VK_LEFT);
    state(first, "left");
    key(first, VK_END);

    /* Deleting. */
    type(first, "\b");
    state(first, "backspace");
    key(first, VK_HOME);
    key(first, VK_DELETE);
    state(first, "delete");

    /* A selection, and typing over it. */
    SendMessage(first, EM_SETSEL, 0, MAKELONG(1, 3));
    state(first, "setsel");
    capture(first, "selected");
    type(first, "X");
    state(first, "replace");

    /* More than fits. */
    key(first, VK_END);
    type(first, "abcdefghijklmnopqrstuvwxyz");
    state(first, "long");
    capture(first, "long");
    key(first, VK_HOME);
    state(first, "longhome");
    capture(first, "longhome");

    /* A limit. */
    SetWindowText(first, "");
    state(first, "cleared");
    SendMessage(first, EM_LIMITTEXT, 3, 0L);
    type(first, "abcd");
    state(first, "limited");

    /* The other control, in its own font. */
    SetFocus(second);
    pump();
    state(second, "focus2");
    capture(second, "sans");
    key(second, VK_END);
    type(second, "Hi");
    state(second, "sanstype");
    capture(second, "sanshi");

    /* The mouse: a press and a release on the first control, which holds
     * "abc", at each place across its first characters. */
    for (index = 0; index < 8; index++) {
        int x = 6 + index * 2;

        SendMessage(first, WM_LBUTTONDOWN, MK_LBUTTON, MAKELONG(x, 10));
        SendMessage(first, WM_LBUTTONUP, 0, MAKELONG(x, 10));
        wsprintf(step, "click%d", x);
        state(first, step);
        wsprintf(probeResult, "%d", GetFocus() == first ? 1 : GetFocus() == second ? 2 : 0);
        probe("focused", step, probeResult);
    }

    DestroyWindow(host);
    pump();
    DeleteObject(font);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
