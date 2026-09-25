/*
 * Which system colours a modal dialog frame is drawn in.
 *
 * A dialog with `DS_MODALFRAME` and a caption has a line inside its frame,
 * along the top and sides of the caption, that is white in every display's
 * default colours -- as six system colours are. This turns each of those
 * colours red in turn, and the active caption and window frame colours too,
 * redraws the dialog and reads back:
 *
 * * `line`: the pixel on the line at the caption's top left, and on its left
 *   side, and one in the ring, and one in the client area, as palette digits.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DLGCOLOR.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static BYTE FAR *template;
static int at;

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

BOOL FAR PASCAL _export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    return message == WM_INITDIALOG;
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int COLOURS[] = { COLOR_INACTIVECAPTION, COLOR_MENU, COLOR_WINDOW,
                                   COLOR_CAPTIONTEXT, COLOR_HIGHLIGHTTEXT, COLOR_BTNHIGHLIGHT,
                                   COLOR_ACTIVECAPTION, COLOR_WINDOWFRAME, COLOR_BTNFACE };
    static const char *NAMES[] = { "inactivecaption", "menu", "window", "captiontext",
                                   "highlighttext", "btnhighlight", "activecaption",
                                   "windowframe", "btnface" };
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    FARPROC proc = MakeProcInstance((FARPROC)DialogProc, instance);
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | WS_VISIBLE;
    HWND dialog;
    int index;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    template = (BYTE FAR *)GlobalLock(memory);
    word(LOWORD(style));
    word(HIWORD(style));
    byte(0);
    word(20);
    word(20);
    word(100);
    word(50);
    byte(0);
    byte(0);
    byte('D');
    byte(0);

    dialog = CreateDialogIndirect(instance, template, NULL, (DLGPROC)proc);
    pump();

    for (index = 0; index < sizeof(COLOURS) / sizeof(COLOURS[0]); index++) {
        int which = COLOURS[index];
        COLORREF was = GetSysColor(which);
        COLORREF red = RGB(255, 0, 0);
        RECT window;
        HDC screen;

        SetSysColors(1, &which, &red);
        InvalidateRect(dialog, NULL, TRUE);
        RedrawWindow(dialog, NULL, NULL, RDW_FRAME | RDW_INVALIDATE | RDW_ERASE | RDW_UPDATENOW);
        pump();

        GetWindowRect(dialog, &window);
        screen = GetDC(NULL);
        wsprintf(probeResult, "top=%c,side=%c,ring=%c,outline=%c,client=%c",
                 digit(GetPixel(screen, window.left + 30, window.top + 4)),
                 digit(GetPixel(screen, window.left + 5, window.top + 30)),
                 digit(GetPixel(screen, window.left + 2, window.top + 30)),
                 digit(GetPixel(screen, window.left, window.top + 30)),
                 digit(GetPixel(screen, window.left + 30, window.top + 40)));
        ReleaseDC(NULL, screen);
        probe("line", NAMES[index], probeResult);

        SetSysColors(1, &which, &was);
        pump();
    }

    DestroyWindow(dialog);
    GlobalUnlock(memory);
    GlobalFree(memory);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
