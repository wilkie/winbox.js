/*
 * The settings USER reads from `WIN.INI` as it starts, with a `WIN.INI`
 * of other settings: `spiboot.win.ini` beside this file is put into the
 * installation's before Windows starts, by the recorder and by both
 * engines' runs alike.
 *
 * `get` records are `SystemParametersInfo`'s readings, each buffer filled
 * with 5A5Ah first; `metric` records `GetSystemMetrics`; `time` records
 * `GetDoubleClickTime` and `GetCaretBlinkTime`; `font` the icons' titles'
 * `LOGFONT` -- height, width, weight, italic and face.
 *
 * `W` is an overlapped window made at (40, 40), 300 by 200, with a menu
 * bar of one pop-up, File: Open, and More, a pop-up of one item, Sub;
 * `rects` gives its rectangle and its client area's on the screen. Each
 * `menu` record is the rectangle on the screen of the menu's window
 * `FindWindow("#32768", NULL)` names, from a `WM_ENTERIDLE`: `bar` with
 * File opened with `SC_KEYMENU` and `f`; `sub` with More opened from it
 * with Down and Right; `track` with File's pop-up given `TrackPopupMenu`
 * at (100, 100) with no flags; `track2` the same at (300, 100), and
 * `track2sub` with More opened from it with Down and Right, where there
 * is room for it to the left.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SPIBOOT.OUT"

static HWND w;
static HMENU file;
static int stage;

static void getWord(LPCSTR name, UINT action)
{
    WORD word = 0x5a5a;
    BOOL answer = SystemParametersInfo(action, 0, &word, 0);

    wsprintf(probeResult, "%d %d", answer, (int)word);
    probe("get", name, probeResult);
}

static void metric(LPCSTR name, int index)
{
    wsprintf(probeResult, "%d", GetSystemMetrics(index));
    probe("metric", name, probeResult);
}

static void menuRect(LPCSTR name)
{
    HWND found = FindWindow("#32768", NULL);
    RECT r;

    if (!found) {
        probe("menu", name, "none");
        return;
    }

    GetWindowRect(found, &r);
    wsprintf(probeResult, "%d:%d:%d:%d", r.left, r.top, r.right, r.bottom);
    probe("menu", name, probeResult);
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_ENTERIDLE && wParam == MSGF_MENU) {
        if (stage == 1) {
            stage = 2;
            menuRect("bar");
            PostMessage(hwnd, WM_KEYDOWN, VK_DOWN, 0L);
            PostMessage(hwnd, WM_KEYDOWN, VK_RIGHT, 0L);
        } else if (stage == 2) {
            stage = 3;
            menuRect("sub");
            SendMessage(hwnd, WM_CANCELMODE, 0, 0L);
        } else if (stage == 4) {
            stage = 5;
            menuRect("track");
            SendMessage(hwnd, WM_CANCELMODE, 0, 0L);
        } else if (stage == 6) {
            stage = 7;
            menuRect("track2");
            PostMessage(hwnd, WM_KEYDOWN, VK_DOWN, 0L);
            PostMessage(hwnd, WM_KEYDOWN, VK_RIGHT, 0L);
        } else if (stage == 7) {
            stage = 8;
            menuRect("track2sub");
            SendMessage(hwnd, WM_CANCELMODE, 0, 0L);
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HMENU bar;
    HMENU more;
    WORD mouse[3];
    LOGFONT font;
    int spacing;
    RECT outer;
    RECT client;
    POINT corner;

    probeOpen(OUTPUT);

    getWord("beep", SPI_GETBEEP);
    mouse[0] = mouse[1] = mouse[2] = 0x5a5a;
    SystemParametersInfo(SPI_GETMOUSE, 0, mouse, 0);
    wsprintf(probeResult, "%d %d %d", mouse[0], mouse[1], mouse[2]);
    probe("get", "mouse", probeResult);
    getWord("border", SPI_GETBORDER);
    getWord("keyboardspeed", SPI_GETKEYBOARDSPEED);
    getWord("keyboarddelay", SPI_GETKEYBOARDDELAY);
    getWord("screensavetimeout", SPI_GETSCREENSAVETIMEOUT);
    getWord("screensaveactive", SPI_GETSCREENSAVEACTIVE);
    getWord("gridgranularity", SPI_GETGRIDGRANULARITY);
    getWord("icontitlewrap", SPI_GETICONTITLEWRAP);
    getWord("menudropalignment", SPI_GETMENUDROPALIGNMENT);
    getWord("fasttaskswitch", SPI_GETFASTTASKSWITCH);

    spacing = 0x5a5a;
    SystemParametersInfo(SPI_ICONHORIZONTALSPACING, 0, &spacing, 0);
    wsprintf(probeResult, "%d", spacing);
    probe("get", "iconhorizontalspacing", probeResult);
    spacing = 0x5a5a;
    SystemParametersInfo(SPI_ICONVERTICALSPACING, 0, &spacing, 0);
    wsprintf(probeResult, "%d", spacing);
    probe("get", "iconverticalspacing", probeResult);

    SystemParametersInfo(SPI_GETICONTITLELOGFONT, sizeof(font), &font, 0);
    wsprintf(probeResult, "%d %d %d %d %s", font.lfHeight, font.lfWidth, font.lfWeight,
             (int)font.lfItalic, (LPSTR)font.lfFaceName);
    probe("font", "icontitle", probeResult);

    metric("cxframe", SM_CXFRAME);
    metric("cyframe", SM_CYFRAME);
    metric("cxmin", SM_CXMIN);
    metric("cymin", SM_CYMIN);
    metric("cxmintrack", SM_CXMINTRACK);
    metric("cymintrack", SM_CYMINTRACK);
    metric("cxdoubleclk", SM_CXDOUBLECLK);
    metric("cydoubleclk", SM_CYDOUBLECLK);
    metric("cxiconspacing", SM_CXICONSPACING);
    metric("cyiconspacing", SM_CYICONSPACING);
    metric("menudropalignment", SM_MENUDROPALIGNMENT);
    metric("swapbutton", SM_SWAPBUTTON);

    wsprintf(probeResult, "%u", GetDoubleClickTime());
    probe("time", "doubleclick", probeResult);
    wsprintf(probeResult, "%u", GetCaretBlinkTime());
    probe("time", "caretblink", probeResult);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SpiBoot";
    RegisterClass(&kind);

    /* The pointer out of the way. */
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    more = CreatePopupMenu();
    AppendMenu(more, MF_STRING, 201, "&Sub");
    file = CreatePopupMenu();
    AppendMenu(file, MF_STRING, 101, "&Open");
    AppendMenu(file, MF_POPUP, (UINT)more, "&More");
    bar = CreateMenu();
    AppendMenu(bar, MF_POPUP, (UINT)file, "&File");

    w = CreateWindow("SpiBoot", "W", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, bar, instance,
                     NULL);
    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);
    pump();

    GetWindowRect(w, &outer);
    GetClientRect(w, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(w, &corner);
    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d", outer.left, outer.top,
             outer.right, outer.bottom, corner.x, corner.y, corner.x + client.right,
             corner.y + client.bottom);
    probe("rects", "W", probeResult);

    stage = 1;
    SendMessage(w, WM_SYSCOMMAND, SC_KEYMENU, (LPARAM)'f');
    pump();

    stage = 4;
    TrackPopupMenu(file, 0, 100, 100, 0, w, NULL);
    pump();

    stage = 6;
    TrackPopupMenu(file, 0, 300, 100, 0, w, NULL);
    pump();

    DestroyWindow(w);
    pump();
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
