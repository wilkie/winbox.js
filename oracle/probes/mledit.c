/*
 * The multi-line edit control: lines, wrapping, scrolling, the keys between
 * lines, and what it answers about its lines.
 *
 * Two multi-line edit controls in an ordinary window, both in the System
 * font. The first is Notepad's kind: no border, scroll bars both ways,
 * `ES_AUTOHSCROLL | ES_AUTOVSCROLL`, 200 by 80. The second wraps its words:
 * a border, `ES_AUTOVSCROLL`, nothing across, 120 by 60. Everything is sent
 * with `SendMessage`.
 *
 * * `caret`, `sel`, `notes`: as `editctl` writes them.
 * * `text`: the text, a line break written `\r\n`.
 * * `lines`: `EM_GETLINECOUNT`, `EM_GETFIRSTVISIBLELINE`, the caret's line
 *   (`EM_LINEFROMCHAR` of -1), that line's first character (`EM_LINEINDEX`
 *   of -1) and length (`EM_LINELENGTH` of -1), and the two scroll bars'
 *   positions.
 * * `line`: what `EM_GETLINE` copies of a line.
 * * `caretpix`, `rows`: the caret's pixels and the control's, as `editctl`.
 * * `focused`: after a click.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MLEDIT.OUT"

#define EM_GETFIRSTVISIBLELINE (WM_USER + 30)

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

static void state(HWND edit, LPCSTR step)
{
    static char text[600];
    POINT caret;
    DWORD selection = SendMessage(edit, EM_GETSEL, 0, 0L);
    LPSTR out;
    LPSTR in;

    GetCaretPos(&caret);
    wsprintf(probeResult, "%d:%d", caret.x, caret.y);
    probe("caret", step, probeResult);

    wsprintf(probeResult, "%d:%d", LOWORD(selection), HIWORD(selection));
    probe("sel", step, probeResult);

    GetWindowText(edit, text, sizeof(text));
    out = probeResult;

    for (in = text; *in && out < probeResult + 1900; in++) {
        if (*in == '\r') {
            *out++ = '\\';
            *out++ = 'r';
        } else if (*in == '\n') {
            *out++ = '\\';
            *out++ = 'n';
        } else {
            *out++ = *in;
        }
    }

    *out = '\0';
    probe("text", step, probeResult);

    wsprintf(probeResult, "count=%d,first=%d,line=%d,index=%d,length=%d,v=%d,h=%d",
             (int)SendMessage(edit, EM_GETLINECOUNT, 0, 0L),
             (int)SendMessage(edit, EM_GETFIRSTVISIBLELINE, 0, 0L),
             (int)SendMessage(edit, EM_LINEFROMCHAR, (WPARAM)-1, 0L),
             (int)SendMessage(edit, EM_LINEINDEX, (WPARAM)-1, 0L),
             (int)SendMessage(edit, EM_LINELENGTH, (WPARAM)-1, 0L), GetScrollPos(edit, SB_VERT),
             GetScrollPos(edit, SB_HORZ));
    probe("lines", step, probeResult);

    probe("notes", step, notes);
    notes[0] = '\0';
}

static char shown[80][201];
static char hidden[80][201];

static void read(HWND edit, char rows[80][201])
{
    RECT window;
    HDC screen = GetDC(NULL);
    int x;
    int y;

    GetWindowRect(edit, &window);

    for (y = 0; y < 80; y++) {
        rows[y][0] = '\0';
    }

    for (y = 0; y < 80 && window.top + y < window.bottom; y++) {
        for (x = 0; x < 200 && window.left + x < window.right; x++) {
            rows[y][x] = digit(GetPixel(screen, window.left + x, window.top + y));
        }

        rows[y][x] = '\0';
    }

    ReleaseDC(NULL, screen);
}

static void capture(HWND edit, LPCSTR name)
{
    LPSTR out = probeResult;
    int x;
    int y;

    HideCaret(edit);
    ShowCaret(edit);
    read(edit, shown);
    HideCaret(edit);
    read(edit, hidden);

    *out = '\0';

    for (y = 0; y < 80; y++) {
        for (x = 0; hidden[y][x]; x++) {
            if (shown[y][x] != hidden[y][x] && out < probeResult + 2000) {
                out += wsprintf(out, "%s%d:%d=%c", (LPSTR)(out == probeResult ? "" : ","), x, y,
                                shown[y][x]);
            }
        }
    }

    probe("caretpix", name, probeResult);

    for (y = 0; y < 80 && hidden[y][0]; y++) {
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

static void line(HWND edit, int index, LPCSTR step)
{
    static char buffer[80];
    int count;

    *(WORD FAR *)buffer = sizeof(buffer) - 1;
    count = (int)SendMessage(edit, EM_GETLINE, index, (LPARAM)(LPSTR)buffer);
    buffer[count] = '\0';
    wsprintf(probeArgs, "%s,%d", step, index);
    wsprintf(probeResult, "%d:%s", count, (LPSTR)buffer);
    probe("line", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    HWND pad;
    HWND wrap;
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
    windowClass.lpszClassName = "MlHost";
    RegisterClass(&windowClass);

    host = CreateWindow("MlHost", "Lines", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 360, 220, NULL,
                        NULL, instance, NULL);
    pad = CreateWindow("EDIT", "",
                       WS_CHILD | WS_VISIBLE | WS_VSCROLL | WS_HSCROLL | ES_MULTILINE |
                           ES_AUTOHSCROLL | ES_AUTOVSCROLL | ES_LEFT,
                       8, 8, 200, 80, host, (HMENU)100, instance, NULL);
    wrap = CreateWindow("EDIT", "",
                        WS_CHILD | WS_VISIBLE | WS_BORDER | ES_MULTILINE | ES_AUTOVSCROLL | ES_LEFT,
                        220, 8, 120, 60, host, (HMENU)101, instance, NULL);

    UpdateWindow(host);
    pump();
    notes[0] = '\0';

    SetFocus(pad);
    pump();
    state(pad, "focus");
    capture(pad, "empty");

    /* Two lines. */
    type(pad, "Hello");
    state(pad, "hello");
    type(pad, "\r");
    state(pad, "enter");
    type(pad, "World");
    state(pad, "world");
    capture(pad, "two");
    line(pad, 0, "two");
    line(pad, 1, "two");

    /* Between the lines. */
    key(pad, VK_UP);
    state(pad, "up");
    key(pad, VK_END);
    state(pad, "upend");
    key(pad, VK_DOWN);
    state(pad, "down");
    key(pad, VK_HOME);
    state(pad, "home");
    key(pad, VK_LEFT);
    state(pad, "leftwrap");
    key(pad, VK_RIGHT);
    state(pad, "rightwrap");

    /* Backspace at a line's start joins it to the one before. */
    type(pad, "\b");
    state(pad, "join");
    type(pad, "\r");
    state(pad, "split");

    /* More lines than show. */
    key(pad, VK_END);
    for (index = 3; index <= 9; index++) {
        wsprintf(step, "\rLine %d", index);
        type(pad, step);
    }

    state(pad, "nine");
    capture(pad, "nine");
    key(pad, VK_PRIOR);
    state(pad, "pageup");
    key(pad, VK_PRIOR);
    state(pad, "pageup2");
    capture(pad, "top");
    key(pad, VK_NEXT);
    state(pad, "pagedown");

    /* A line longer than shows. */
    key(pad, VK_END);
    type(pad, " and a line that is much longer than the control is wide");
    state(pad, "long");
    capture(pad, "long");
    key(pad, VK_HOME);
    state(pad, "longhome");

    /* A selection across lines. */
    SendMessage(pad, EM_SETSEL, 0, MAKELONG(2, 9));
    state(pad, "setsel");
    capture(pad, "selected");
    type(pad, "X");
    state(pad, "replace");

    /* The mouse, on the second and third lines that show. */
    for (index = 0; index < 4; index++) {
        int x = 10 + index * 12;
        int y = 6 + index * 8;

        SendMessage(pad, WM_LBUTTONDOWN, MK_LBUTTON, MAKELONG(x, y));
        SendMessage(pad, WM_LBUTTONUP, 0, MAKELONG(x, y));
        wsprintf(step, "click%d", index);
        state(pad, step);
    }

    /* The control that wraps. */
    SetFocus(wrap);
    pump();
    state(wrap, "wrapfocus");
    type(wrap, "The quick brown fox jumps over the lazy dog again and again");
    state(wrap, "wrapped");
    capture(wrap, "wrapped");
    line(wrap, 0, "wrapped");
    line(wrap, 1, "wrapped");
    line(wrap, 2, "wrapped");
    key(wrap, VK_UP);
    state(wrap, "wrapup");
    key(wrap, VK_HOME);
    state(wrap, "wraphome");
    type(wrap, "\r");
    state(wrap, "wrapenter");
    type(wrap, "Averyveryverylongwordthatcannotfitonanyline");
    state(wrap, "wrapword");
    capture(wrap, "wrapword");

    DestroyWindow(host);
    pump();
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
