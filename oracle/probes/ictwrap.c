/*
 * An icon's title broken into lines: where USER puts the title window of a
 * minimized window and what it draws there, for titles wider than the icon
 * spacing, with `IconTitleWrap` on -- WIN.INI's default -- and off.
 *
 * Read out of `USER.EXE`: the title is measured (seg1 `6b43`) with
 * `DrawText`'s `DT_CALCRECT | DT_NOPREFIX | DT_WORDBREAK | DT_CENTER` --
 * and `DT_SINGLELINE` where wrapping is off -- in a rectangle the icon
 * spacing less two borders wide, its trailing spaces dropped; placed (seg1
 * `6c14`) half the icon less half the text less two borders across from the
 * icon, under it, the text and four borders wide; and drawn (seg1 `6984`)
 * with the same flags in its client area less a border on the left and two
 * on the right.
 *
 * Each case is a window `W`, `WS_OVERLAPPEDWINDOW`, of the case's title,
 * minimized with `SW_SHOWMINNOACTIVE` while `A` is active; then:
 *
 * * `title`: the title window's rectangle -- the window of class `#32772`
 *   `WindowFromPoint` finds four pixels under the middle of the icon -- and
 *   the icon's.
 * * `area` and `screen`: every pixel of the title window and a pixel
 *   around it, a row a record, a palette digit a pixel as `sizing` writes
 *   them.
 *
 * and the window is destroyed. The cases with wrapping on are `progman`
 * ("Program Manager"), `short` ("Probe"), `three` ("Widget Workshop for
 * Windows Setup"), `long` (one word wider than the spacing), `trail`
 * ("Trailing" and three spaces) and `many` ("Ab Cd Ef Gh Ij Kl Mn Op").
 * `wrap` records `SPI_GETICONTITLEWRAP` and `SM_CXICONSPACING`,
 * `SM_CYICONSPACING` before; `SPI_SETICONTITLEWRAP` is then set off, not
 * written to WIN.INI, `wrap-off` records them again, and `progman-off` and
 * `three-off` are minimized; wrapping is set on again at the end.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ICTWRAP.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HINSTANCE module;
static HWND anchor;

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

static void capture(LPCSTR name, int left, int top, int right, int bottom)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    wsprintf(probeResult, "%d:%d:%d:%d", left, top, right, bottom);
    probe("area", name, probeResult);

    for (y = top; y < bottom; y++) {
        LPSTR at = probeResult;

        for (x = left; x < right; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';

        wsprintf(probeArgs, "%s,y=%d", name, y - top);
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 200 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

/* The window under the icon, a few pixels below it, if it is of the icon
 * title's class, `#32772`. */
static HWND titleWindow(HWND icon)
{
    RECT box;
    POINT under;
    HWND at;
    char name[40];

    GetWindowRect(icon, &box);
    under.x = (box.left + box.right) / 2;
    under.y = box.bottom + 4;
    at = WindowFromPoint(under);

    if (at == NULL) {
        return NULL;
    }

    GetClassName(at, name, sizeof(name));

    return lstrcmp(name, "#32772") == 0 ? at : NULL;
}

static void minimized(LPCSTR name, LPCSTR text)
{
    HWND w = CreateWindow("IctWrap", text, WS_OVERLAPPEDWINDOW, 40, 40, 200, 120, NULL, NULL,
                          module, NULL);
    HWND title;
    RECT icon;
    RECT box;

    ShowWindow(w, SW_SHOWMINNOACTIVE);
    UpdateWindow(w);
    pump();

    title = titleWindow(w);
    GetWindowRect(w, &icon);

    if (title) {
        GetWindowRect(title, &box);
    } else {
        SetRectEmpty(&box);
    }

    wsprintf(probeResult, "found=%d,title=%d:%d:%d:%d,icon=%d:%d:%d:%d", title != NULL, box.left,
             box.top, box.right, box.bottom, icon.left, icon.top, icon.right, icon.bottom);
    probe("title", name, probeResult);

    if (title) {
        capture(name, box.left - 1, box.top - 1, box.right + 1, box.bottom + 1);
    }

    DestroyWindow(w);
    pump();
}

static void wrapState(LPCSTR name)
{
    BOOL wrap = FALSE;

    SystemParametersInfo(SPI_GETICONTITLEWRAP, 0, &wrap, 0);
    wsprintf(probeResult, "wrap=%d,cx=%d,cy=%d", wrap ? 1 : 0,
             GetSystemMetrics(SM_CXICONSPACING), GetSystemMetrics(SM_CYICONSPACING));
    probe("wrap", name, probeResult);
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "IctWrap";
    RegisterClass(&kind);

    /* The pointer out of the way. */
    ShowCursor(FALSE);
    SetCursorPos(639, 0);

    anchor = CreateWindow("IctWrap", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 400, 200, 120, 80,
                          NULL, NULL, module, NULL);
    UpdateWindow(anchor);
    pump();

    wrapState("wrap");
    minimized("progman", "Program Manager");
    minimized("short", "Probe");
    minimized("three", "Widget Workshop for Windows Setup");
    minimized("long", "Supercalifragilisticexpialidocious");
    minimized("trail", "Trailing   ");
    minimized("many", "Ab Cd Ef Gh Ij Kl Mn Op");

    SystemParametersInfo(SPI_SETICONTITLEWRAP, FALSE, NULL, 0);
    wrapState("wrap-off");
    minimized("progman-off", "Program Manager");
    minimized("three-off", "Widget Workshop for Windows Setup");
    SystemParametersInfo(SPI_SETICONTITLEWRAP, TRUE, NULL, 0);

    DestroyWindow(anchor);
    pump();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
