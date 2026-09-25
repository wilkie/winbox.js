/*
 * Dialog boxes: where their controls go, what they look like, and how the
 * keyboard moves through them.
 *
 * A dialog box is a window made from a template, which gives every size and
 * place in dialog units: a quarter of the dialog font's average character
 * width across, an eighth of its height down. The templates here are built in
 * memory, so nothing depends on a resource compiler:
 *
 * * `units`: `GetDialogBaseUnits`.
 * * `rects`, `control`: a modeless dialog made with `CreateDialogIndirect` for
 *   an owner window -- the dialog's window and client rectangles on the
 *   screen, then each control's rectangle in the dialog's client area. Once
 *   in the system font (`system`), once with `DS_SETFONT` as MS Sans Serif 8
 *   (`font`).
 * * `pixels`: every pixel of each dialog, a row a record, as `chrome` writes
 *   them.
 * * `focus`: which control has the focus once the dialog is made, and after
 *   each of six presses of Tab handed to `IsDialogMessage`.
 * * `command`: the `WM_COMMAND` the dialog procedure gets for Enter and for
 *   Escape.
 * * `placement`: where an empty dialog's window and client area go for each
 *   place across from 0 to 9 dialog units.
 * * `dialogfont`, `measure`: the font each dialog was made with, as
 *   `WM_GETFONT` gives it, and the width of the fifty-two letters, the
 *   average character width and the height in it.
 * * `modal`: a dialog run with `DialogBoxIndirect` -- whether its owner is
 *   enabled while it runs and after, and what `DialogBox` answers for the
 *   `EndDialog` it ended with.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DIALOGS.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HINSTANCE module;
static HWND owner;
static BYTE FAR *template;
static int at;
static LPCSTR phase = "";

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

static void byte(BYTE value)
{
    template[at++] = value;
}

static void word(WORD value)
{
    byte(LOBYTE(value));
    byte(HIBYTE(value));
}

static void string(LPCSTR text)
{
    while (*text) {
        byte(*text++);
    }

    byte(0);
}

/* The dialog's header: style, count, place and size, no menu, no class. */
static int headerX = 10;

static void header(DWORD style, int count, LPCSTR caption, BOOL font)
{
    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte((BYTE)count);
    word(headerX);
    word(10);
    word(160);
    word(90);
    byte(0);
    byte(0);
    string(caption);

    if (font) {
        word(8);
        string("MS Sans Serif");
    }
}

static void item(int x, int y, int cx, int cy, int id, DWORD style, BYTE kind, LPCSTR text)
{
    word(x);
    word(y);
    word(cx);
    word(cy);
    word(id);
    word(LOWORD(style | WS_CHILD | WS_VISIBLE));
    word(HIWORD(style | WS_CHILD | WS_VISIBLE));
    byte(kind);
    string(text);
    byte(0);
}

/* The one dialog, in the system font or in MS Sans Serif 8. */
static void build(BOOL font)
{
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | WS_VISIBLE;

    header(font ? style | DS_SETFONT : style, 7, "Probe Dialog", font);
    item(6, 8, 30, 8, 100, SS_LEFT, 0x82, "&Name:");
    item(40, 6, 110, 12, 101, ES_LEFT | WS_BORDER | WS_TABSTOP, 0x81, "");
    item(6, 26, 60, 10, 102, BS_AUTOCHECKBOX | WS_TABSTOP, 0x80, "&Check");
    item(6, 40, 60, 10, 103, BS_AUTORADIOBUTTON | WS_GROUP | WS_TABSTOP, 0x80, "Radio &1");
    item(6, 52, 60, 10, 104, BS_AUTORADIOBUTTON, 0x80, "Radio &2");
    item(30, 70, 40, 14, IDOK, BS_DEFPUSHBUTTON | WS_GROUP | WS_TABSTOP, 0x80, "OK");
    item(90, 70, 40, 14, IDCANCEL, BS_PUSHBUTTON | WS_TABSTOP, 0x80, "Cancel");
}

BOOL FAR PASCAL _export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        return TRUE;
    }

    if (message == WM_COMMAND && (wParam == IDOK || wParam == IDCANCEL)) {
        wsprintf(probeResult, "id=%d", wParam);
        probe("command", phase, probeResult);
        return TRUE;
    }

    return FALSE;
}

BOOL FAR PASCAL _export ModalProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        SetTimer(dialog, 1, 55, NULL);
        return TRUE;
    }

    if (message == WM_TIMER) {
        KillTimer(dialog, 1);
        wsprintf(probeResult, "%d", IsWindowEnabled(owner) ? 1 : 0);
        probe("modal", "owner-enabled-during", probeResult);
        EndDialog(dialog, 42);
        return TRUE;
    }

    return FALSE;
}

static void pump(HWND dialog)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        if (!IsDialogMessage(dialog, &message)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }
    }
}

static int focusId(void)
{
    HWND focus = GetFocus();

    return focus ? GetDlgCtrlID(focus) : -1;
}

/* The dialog's rectangles, each control's, and every pixel of it. */
static void describe(LPCSTR name, HWND dialog)
{
    static const int IDS[] = { 100, 101, 102, 103, 104, IDOK, IDCANCEL };
    RECT window;
    RECT client;
    POINT corner;
    HDC screen;
    int index;
    int x;
    int y;

    GetWindowRect(dialog, &window);
    GetClientRect(dialog, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(dialog, &corner);

    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d", window.left, window.top,
             window.right, window.bottom, corner.x, corner.y, corner.x + client.right,
             corner.y + client.bottom);
    probe("rects", name, probeResult);

    for (index = 0; index < 7; index++) {
        RECT rect;

        GetWindowRect(GetDlgItem(dialog, IDS[index]), &rect);
        wsprintf(probeArgs, "%s,id=%d", name, IDS[index]);
        wsprintf(probeResult, "%d:%d:%d:%d", rect.left - corner.x, rect.top - corner.y,
                 rect.right - corner.x, rect.bottom - corner.y);
        probe("control", probeArgs, probeResult);
    }

    /* The dialog's own font, as it says: what it was made from, and the
     * letters' width in it. */
    {
        static const char LETTERS[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        HFONT font = (HFONT)SendMessage(dialog, WM_GETFONT, 0, 0L);
        HDC dc = GetDC(dialog);
        HFONT old = font ? SelectObject(dc, font) : NULL;
        TEXTMETRIC metrics;
        LOGFONT logical;

        GetTextMetrics(dc, &metrics);

        if (font) {
            GetObject(font, sizeof(logical), &logical);
            wsprintf(probeResult, "height=%d,weight=%d,face=%s", logical.lfHeight,
                     logical.lfWeight, (LPSTR)logical.lfFaceName);
        } else {
            wsprintf(probeResult, "none");
        }

        probe("dialogfont", name, probeResult);

        wsprintf(probeResult, "letters=%d,average=%d,height=%d",
                 LOWORD(GetTextExtent(dc, LETTERS, 52)), metrics.tmAveCharWidth, metrics.tmHeight);
        probe("measure", name, probeResult);

        if (old) {
            SelectObject(dc, old);
        }

        ReleaseDC(dialog, dc);
    }

    screen = GetDC(NULL);

    for (y = window.top; y < window.bottom; y++) {
        LPSTR out = probeResult;

        for (x = window.left; x < window.right; x++) {
            *out++ = digit(GetPixel(screen, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - window.top);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

LONG FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HGLOBAL memory;
    FARPROC dialogProc;
    FARPROC modalProc;
    HWND dialog;
    DWORD units;
    int index;
    int answer;

    module = instance;
    probeOpen(OUTPUT);

    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    kind.style = 0;
    kind.lpfnWndProc = OwnerProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeOwner";
    RegisterClass(&kind);

    owner = CreateWindow("ProbeOwner", "Owner", WS_OVERLAPPEDWINDOW, 20, 20, 400, 300, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);

    units = GetDialogBaseUnits();
    wsprintf(probeResult, "x=%d,y=%d", LOWORD(units), HIWORD(units));
    probe("units", "", probeResult);

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 512);
    template = (BYTE FAR *)GlobalLock(memory);
    dialogProc = MakeProcInstance((FARPROC)DialogProc, instance);
    modalProc = MakeProcInstance((FARPROC)ModalProc, instance);

    for (index = 0; index < 2; index++) {
        LPCSTR name = index ? "font" : "system";
        int press;

        build(index == 1);
        dialog = CreateDialogIndirect(instance, template, owner, (DLGPROC)dialogProc);
        pump(dialog);

        describe(name, dialog);

        wsprintf(probeArgs, "%s,created", name);
        wsprintf(probeResult, "%d", focusId());
        probe("focus", probeArgs, probeResult);

        for (press = 1; press <= 6; press++) {
            PostMessage(GetFocus(), WM_KEYDOWN, VK_TAB, 0L);
            pump(dialog);
            wsprintf(probeArgs, "%s,tab=%d", name, press);
            wsprintf(probeResult, "%d", focusId());
            probe("focus", probeArgs, probeResult);
        }

        phase = index ? "font,enter" : "system,enter";
        PostMessage(GetFocus(), WM_KEYDOWN, VK_RETURN, 0L);
        pump(dialog);
        phase = index ? "font,escape" : "system,escape";
        PostMessage(GetFocus(), WM_KEYDOWN, VK_ESCAPE, 0L);
        pump(dialog);

        DestroyWindow(dialog);
        pump(owner);
    }

    /* Where a dialog's left edge goes, for each place across a template can
     * put it: an empty dialog at 0 to 9 dialog units from the owner. */
    for (index = 0; index < 10; index++) {
        RECT window;
        RECT client;
        POINT corner;

        headerX = index;
        header(WS_POPUP | WS_CAPTION | DS_MODALFRAME | WS_VISIBLE, 0, "Place", FALSE);
        dialog = CreateDialogIndirect(instance, template, owner, (DLGPROC)dialogProc);
        pump(dialog);
        GetWindowRect(dialog, &window);
        GetClientRect(dialog, &client);
        corner.x = 0;
        corner.y = 0;
        ClientToScreen(dialog, &corner);
        wsprintf(probeArgs, "x=%d", index);
        wsprintf(probeResult, "window=%d:%d,client=%d:%d", window.left, window.top, corner.x,
                 corner.y);
        probe("placement", probeArgs, probeResult);
        DestroyWindow(dialog);
        pump(owner);
    }

    headerX = 10;

    build(FALSE);
    GlobalUnlock(memory);
    answer = DialogBoxIndirect(instance, memory, owner, (DLGPROC)modalProc);
    wsprintf(probeResult, "%d", answer);
    probe("modal", "answer", probeResult);
    wsprintf(probeResult, "%d", IsWindowEnabled(owner) ? 1 : 0);
    probe("modal", "owner-enabled-after", probeResult);

    GlobalFree(memory);
    DestroyWindow(owner);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
