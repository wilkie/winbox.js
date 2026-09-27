/*
 * A program's instance handle and its data segment.
 *
 * * `instance`: how WinMain's instance relates to DS: `same`, `ds|1`,
 *   `ds-1`, or `other`.
 * * `window`: the same for a window's GWW_HINSTANCE.
 * * `load`: whether a string loads with DS as the instance, and with the
 *   instance.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\INSTDS.OUT"

unsigned GetDS(void);
#pragma aux GetDS = "mov ax,ds" value[ax];

static LPCSTR relation(UINT value)
{
    UINT ds = GetDS();

    if (value == ds) return "same";
    if (value == (ds | 1)) return "ds|1";
    if (value == ds - 1) return "ds-1";
    if ((value | 7) == (ds | 7)) return "same selector";
    return "other";
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    char text[40];
    int length;

    probeOpen(OUTPUT);

    probe("instance", "WinMain", relation((UINT)instance));

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "InstDS";
    RegisterClass(&kind);
    window = CreateWindow("InstDS", "A", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL, instance,
                          NULL);
    probe("window", "GWW_HINSTANCE", relation(GetWindowWord(window, GWW_HINSTANCE)));
    DestroyWindow(window);

    text[0] = '\0';
    length = LoadString((HINSTANCE)GetDS(), 1, text, sizeof(text));
    wsprintf(probeResult, "%d:%s", length, (LPSTR)text);
    probe("load", "DS as the instance", probeResult);
    text[0] = '\0';
    length = LoadString(instance, 1, text, sizeof(text));
    wsprintf(probeResult, "%d:%s", length, (LPSTR)text);
    probe("load", "the instance", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
