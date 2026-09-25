/*
 * The standard icons, and what a window with no icon shows minimized.
 *
 * The display driver keeps the standard icons -- `IDI_APPLICATION`, the hand,
 * the question mark, the exclamation mark, the asterisk -- but its
 * `IDI_APPLICATION` group holds one 64 by 64 monochrome picture, which fits
 * no display of 32 by 32 icons; and the `sizing` probe's window, whose class
 * named `IDI_APPLICATION`, showed USER's own Windows flag when minimized.
 * This asks which happened:
 *
 * * `loaded`: whether `LoadIcon(NULL, ...)` gives a handle for each.
 * * `drawn`: each that did, drawn with `DrawIcon` in a row on the screen, and
 *   read back a pixel at a time.
 * * `bare`: a window whose class names no icon, minimized, and the screen
 *   around it read back.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ICONS.OUT"

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

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const LPCSTR NAMES[] = { IDI_APPLICATION, IDI_HAND, IDI_QUESTION, IDI_EXCLAMATION,
                                    IDI_ASTERISK };
    static const char *LABELS[] = { "IDI_APPLICATION", "IDI_HAND", "IDI_QUESTION",
                                    "IDI_EXCLAMATION", "IDI_ASTERISK" };
    WNDCLASS kind;
    HWND bare;
    HDC screen;
    RECT icon;
    int index;
    int width = GetSystemMetrics(SM_CXSCREEN);
    int height = GetSystemMetrics(SM_CYSCREEN);

    probeOpen(OUTPUT);

    ShowCursor(FALSE);
    SetCursorPos(width - 1, height - 1);

    probeNote("each standard icon, loaded and drawn in a row");
    screen = GetDC(NULL);
    PatBlt(screen, 0, 0, 240, 56, WHITENESS);

    for (index = 0; index < 5; index++) {
        HICON handle = LoadIcon(NULL, NAMES[index]);

        probe("loaded", LABELS[index], handle ? "1" : "0");

        if (handle) {
            DrawIcon(screen, 8 + index * 44, 8, handle);
        }
    }

    ReleaseDC(NULL, screen);
    capture("drawn", 0, 0, 240, 56);

    probeNote("a window whose class names no icon, minimized");
    kind.style = CS_HREDRAW | CS_VREDRAW;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeBare";

    if (!RegisterClass(&kind)) {
        probe("setup", "RegisterClass", "failed");
        probeFinish();
        return 0;
    }

    bare = CreateWindow("ProbeBare", "Bare", WS_OVERLAPPEDWINDOW, 40, 40, 200, 120, NULL, NULL,
                        instance, NULL);
    ShowWindow(bare, SW_SHOWMINIMIZED);
    UpdateWindow(bare);
    pump();
    GetWindowRect(bare, &icon);
    capture("bare", icon.left > 48 ? icon.left - 48 : 0, icon.top - 4,
            icon.right + 48 < width ? icon.right + 48 : width, height);
    DestroyWindow(bare);
    pump();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
