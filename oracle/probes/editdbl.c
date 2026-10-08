/*
 * The edit control double clicked: which word it selects, and where the
 * caret goes.
 *
 * A single-line edit control, bordered, 300 wide, and a multi-line one that
 * wraps its words, bordered, 120 by 140, both in the System font, in an
 * ordinary window. The presses are put into the system queue through USER's
 * MOUSE_EVENT, as the mouse driver puts them, from a timer's step a second
 * apart, so no two steps make a double click.
 *
 * Each step names a character boundary of a line, or a place past its end
 * (`end`), as the text's rectangle (`EM_GETRECT`) and the System font's
 * extents put it, and clicks there once and then again. For each:
 *
 * * `press`: the selection (`EM_GETSEL`, start and end) after the first
 *   click, which is where the caret was put;
 * * `dbl`: the selection and the caret's place (`GetCaretPos`) after the
 *   second, the double click.
 *
 * The single-line control holds "one two,three  four. five" and then
 * "  lead word"; the multi-line one "The quick brown fox jumps over the lazy
 * dog", a blank line, "  indented" and a line break at the end, which wraps
 * as "The quick brown ", "fox jumps over ", "the lazy dog", "", "  indented"
 * and "" (`mledit` recorded the first two lines' wrap at 120 across).
 *
 * `drag`: a double click on "jumps", the mouse then moved with the button
 * held to the next line, and let go: whether the selection grows.
 *
 * `proc`: the single-line control given a word-break procedure of the
 * probe's own (`EM_SETWORDBREAKPROC`), which takes commas as well as spaces
 * to end a word, double clicked; `calls`, the codes it was called with, each
 * `code:index:length`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EDITDBL.OUT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

#define SF_ABSOLUTE 0x8000
#define MOVE 0x0001
#define LEFTDOWN 0x0002
#define LEFTUP 0x0004

#define STEP_TIMER 77
#define END -1

static const char ONE[] = "one two,three  four. five";
static const char LEAD[] = "  lead word";
static const char WRAP[] = "The quick brown fox jumps over the lazy dog\r\n\r\n  indented\r\n";

/* What each step presses: the control (0 single-line, 1 multi-line), a
 * line and a character boundary on it, or END, past it. */
struct Step {
    const char *name;
    int control;
    int line;
    int column;
};

static const struct Step STEPS[] = {
    {"sl-zero", 0, 0, 0},       {"sl-inner", 0, 0, 5},      {"sl-comma", 0, 0, 7},
    {"sl-blank", 0, 0, 14},     {"sl-period", 0, 0, 20},    {"sl-end", 0, 0, END},
    {"lead-zero", 0, 0, 0},     {"lead-blank", 0, 0, 1},    {"lead-word", 0, 0, 4},
    {"ml-quick", 1, 0, 6},      {"ml-wrapend", 1, 0, END},  {"ml-wrapstart", 1, 1, 0},
    {"ml-jumps", 1, 1, 6},      {"ml-dogend", 1, 2, END},   {"ml-empty", 1, 3, 0},
    {"ml-indent", 1, 4, 0},     {"ml-indent1", 1, 4, 1},    {"ml-indentend", 1, 4, END},
    {"ml-last", 1, 5, 0},       {"drag", 1, 1, 6},          {"proc-inner", 0, 0, 5},
    {"proc-zero", 0, 0, 0},     {"proc-blank", 0, 0, 14},
};

#define STEP_COUNT (sizeof(STEPS) / sizeof(STEPS[0]))

static FARPROC mouseEvent;
static HWND edits[2];
static int step;
static char calls[512];
static LPSTR callsAt;

static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static void mouse(WORD flags, WORD x, WORD y)
{
    mouseFlags = flags;
    mouseX = x;
    mouseY = y;

    _asm {
        push si
        push di
        mov ax, mouseFlags
        mov bx, mouseX
        mov cx, mouseY
        mov dx, 2
        xor si, si
        xor di, di
        call dword ptr mouseEvent
        pop di
        pop si
    }
}

/* A point of the screen as MOUSE_EVENT's absolute coordinates, 0 to 65535. */
static WORD across(int x)
{
    return (WORD)(((DWORD)x * 65536L + GetSystemMetrics(SM_CXSCREEN) - 1) /
                  GetSystemMetrics(SM_CXSCREEN));
}

static WORD down(int y)
{
    return (WORD)(((DWORD)y * 65536L + GetSystemMetrics(SM_CYSCREEN) - 1) /
                  GetSystemMetrics(SM_CYSCREEN));
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

/* Where a step presses, on the screen. */
static POINT place(const struct Step *s)
{
    static char text[200];
    HWND edit = edits[s->control];
    RECT rect;
    POINT at;
    HDC dc;
    int start = 0;
    int length;
    int height;
    TEXTMETRIC metrics;

    SendMessage(edit, EM_GETRECT, 0, (LPARAM)(LPRECT)&rect);
    GetWindowText(edit, text, sizeof(text));
    dc = GetDC(edit);
    SelectObject(dc, GetStockObject(SYSTEM_FONT));
    GetTextMetrics(dc, &metrics);
    height = metrics.tmHeight;

    if (s->control) {
        start = (int)SendMessage(edit, EM_LINEINDEX, s->line, 0L);
        length = (int)SendMessage(edit, EM_LINELENGTH, start, 0L);
    } else {
        length = lstrlen(text);
    }

    if (s->column == END) {
        at.x = rect.right - 2;
    } else {
        at.x = rect.left + LOWORD(GetTextExtent(dc, text + start, s->column));
    }

    at.y = rect.top + s->line * height + height / 2;
    ReleaseDC(edit, dc);
    ClientToScreen(edit, &at);

    (void)length;
    return at;
}

static void selection(LPCSTR function, LPCSTR name, HWND edit, BOOL caret)
{
    DWORD sel = SendMessage(edit, EM_GETSEL, 0, 0L);
    POINT at;

    if (caret) {
        GetCaretPos(&at);
        wsprintf(probeResult, "%u:%u caret=%d:%d", LOWORD(sel), HIWORD(sel), at.x, at.y);
    } else {
        wsprintf(probeResult, "%u:%u", LOWORD(sel), HIWORD(sel));
    }

    probe(function, name, probeResult);
}

/* The probe's word-break procedure: spaces and commas end a word. */
int FAR PASCAL _export Breaks(LPSTR text, int index, int length, int code)
{
    int at = index;

    if (callsAt - calls < (int)sizeof(calls) - 24) {
        callsAt += wsprintf(callsAt, "%s%d:%d:%d", (LPSTR)(callsAt == calls ? "" : " "), code,
                            index, length);
    }

#define DELIMITER(i) (text[i] == ' ' || text[i] == ',')

    switch (code) {
    case WB_LEFT:
        while (at > 0 && DELIMITER(at - 1)) {
            at--;
        }

        while (at > 0 && !DELIMITER(at - 1)) {
            at--;
        }

        return at;
    case WB_RIGHT:
        while (at < length && !DELIMITER(at)) {
            at++;
        }

        while (at < length && DELIMITER(at)) {
            at++;
        }

        return at;
    case WB_ISDELIMITER:
        return at < length && DELIMITER(at);
    }

    return 0;
}

/* The text a step's control holds before it is pressed. */
static void prepare(const struct Step *s, HINSTANCE instance)
{
    static FARPROC breaks;
    const char *name = s->name;

    if (!lstrcmp(name, "sl-zero") || !lstrcmp(name, "proc-inner")) {
        SetWindowText(edits[0], ONE);
    } else if (!lstrcmp(name, "lead-zero")) {
        SetWindowText(edits[0], LEAD);
    } else if (!lstrcmp(name, "ml-quick")) {
        SetFocus(edits[1]);
        pump();
    }

    if (!lstrcmp(name, "proc-inner")) {
        SetFocus(edits[0]);
        pump();
        breaks = MakeProcInstance((FARPROC)Breaks, instance);
        SendMessage(edits[0], EM_SETWORDBREAKPROC, 0, (LPARAM)breaks);
    }

    callsAt = calls;
    *callsAt = '\0';
}

static void next(HWND window)
{
    const struct Step *s;
    HWND edit;
    POINT at;
    POINT to;

    if (step >= (int)STEP_COUNT) {
        KillTimer(window, STEP_TIMER);
        PostMessage(window, WM_CLOSE, 0, 0L);
        return;
    }

    s = &STEPS[step++];
    edit = edits[s->control];
    prepare(s, (HINSTANCE)GetWindowWord(window, GWW_HINSTANCE));
    at = place(s);

    mouse(SF_ABSOLUTE | MOVE, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(at.x), down(at.y));
    pump();
    selection("press", s->name, edit, FALSE);

    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(at.x), down(at.y));

    if (!lstrcmp(s->name, "drag")) {
        struct Step below = *s;

        below.line++;
        below.column = 4;
        pump();
        to = place(&below);
        mouse(SF_ABSOLUTE | MOVE, across(to.x), down(to.y));
        pump();
        mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(to.x), down(to.y));
    } else {
        mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(at.x), down(at.y));
    }

    pump();
    selection("dbl", s->name, edit, TRUE);

    if (*calls) {
        probe("calls", s->name, calls);
    }
}

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_TIMER:
        if (wParam == STEP_TIMER) {
            next(hwnd);
        }

        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    MSG message;

    probeOpen(OUTPUT);

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (!mouseEvent) {
        probeFinish();
        return 0;
    }

    windowClass.style = 0;
    windowClass.lpfnWndProc = HostProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = LoadCursor(NULL, IDC_ARROW);
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "DblHost";
    RegisterClass(&windowClass);

    host = CreateWindow("DblHost", "Words", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 360, 240,
                        NULL, NULL, instance, NULL);
    edits[0] = CreateWindow("EDIT", ONE, WS_CHILD | WS_VISIBLE | WS_BORDER | ES_AUTOHSCROLL, 8, 8,
                            300, 24, host, (HMENU)100, instance, NULL);
    edits[1] = CreateWindow("EDIT", WRAP,
                            WS_CHILD | WS_VISIBLE | WS_BORDER | ES_MULTILINE | ES_AUTOVSCROLL |
                                ES_LEFT,
                            8, 40, 120, 140, host, (HMENU)101, instance, NULL);

    UpdateWindow(host);
    SetFocus(edits[0]);
    pump();

    SetTimer(host, STEP_TIMER, 1000, NULL);

    while (GetMessage(&message, NULL, 0, 0)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
