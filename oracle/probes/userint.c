/*
 * USER's exports that Windows' own components call, and DragDetect, called
 * by ordinal:
 *
 * * `objtype`: GetUserLocalObjType.
 * * `bear`: ordinal 285's answer less the desktop's instance; ordinal 86's
 *   in hexadecimal; ordinal 51 for every byte, how many answer non-nought.
 * * `mouseproc`: GetMouseEventProc, as `mouse_event` where it is that
 *   export's address.
 * * `eventhook`: SetEventHook's answers: the far pointer before; `mine`
 *   where it answers the procedure set, putting the first back; and for a
 *   pointer that is no code's.
 * * `winoldap`: WinOldAppHackOMatic's answer.
 * * `dragdetect`: DragDetect from a point some pixels across from the
 *   cursor, a mouse move and a button's release posted first: 1 where the
 *   move, made where the cursor is, is out of the rectangle about the
 *   point, nought where the release comes first.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\USERINT.OUT"

typedef WORD(FAR PASCAL *W1)(WORD);
typedef DWORD(FAR PASCAL *D0)(void);
typedef DWORD(FAR PASCAL *D2)(WORD, WORD);
typedef DWORD(FAR PASCAL *DL)(FARPROC);
typedef BOOL(FAR PASCAL *DRAGPROC)(HWND, POINT);

static HMODULE user;

static FARPROC entry(int ordinal)
{
    return GetProcAddress(user, MAKEINTRESOURCE(ordinal));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND window;
    POINT at;
    POINT cursor;
    DWORD old;
    DWORD again;
    int count;
    int c;
    int d;
    MSG msg;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");

    wsprintf(probeResult, "%u", ((W1)entry(480))(0x1234));
    probe("objtype", "1234h", probeResult);

    wsprintf(probeResult, "%d",
             (int)(LOWORD(((D2)entry(285))(0, 0)) -
                   GetWindowWord(GetDesktopWindow(), GWW_HINSTANCE)));
    probe("bear", "285 less desktop instance", probeResult);
    wsprintf(probeResult, "%08lx", ((D0)entry(86))());
    probe("bear", "86", probeResult);
    count = 0;

    for (c = 0; c < 256; c++) {
        if (((W1)entry(51))(c)) {
            count++;
        }
    }

    wsprintf(probeResult, "%d", count);
    probe("bear", "51 non-nought", probeResult);

    probe("mouseproc", "GetMouseEventProc",
          ((D0)entry(337))() == (DWORD)entry(299) ? "mouse_event" : "other");

    old = ((DL)entry(321))(entry(480));
    wsprintf(probeResult, "%08lx", old);
    probe("eventhook", "first", probeResult);
    again = ((DL)entry(321))((FARPROC)old);
    probe("eventhook", "put back", again == (DWORD)entry(480) ? "mine" : "other");
    again = ((DL)entry(321))((FARPROC)MAKELONG(0x1234, 0x5678));
    wsprintf(probeResult, "%08lx", again);
    probe("eventhook", "not code", probeResult);
    again = ((DL)entry(321))((FARPROC)old);
    wsprintf(probeResult, "%08lx", again);
    probe("eventhook", "after not code", probeResult);

    wsprintf(probeResult, "%08lx", ((D2)entry(322))(0, 1));
    probe("winoldap", "0,1", probeResult);
    wsprintf(probeResult, "%08lx", ((D2)entry(322))(5, 5));
    probe("winoldap", "5,5", probeResult);

    window = CreateWindow("STATIC", "", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                          instance, NULL);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    GetCursorPos(&cursor);

    for (d = 0; d <= 10; d++) {
        at.x = cursor.x + d;
        at.y = cursor.y;
        PostMessage(window, WM_MOUSEMOVE, 0, 0);
        PostMessage(window, WM_LBUTTONUP, 0, 0);
        wsprintf(probeArgs, "x+%d", d);
        wsprintf(probeResult, "%d", ((DRAGPROC)entry(465))(window, at));
        probe("dragdetect", probeArgs, probeResult);

        while (PeekMessage(&msg, NULL, WM_MOUSEFIRST, WM_MOUSELAST, PM_REMOVE)) {
        }
    }

    for (d = 0; d <= 10; d++) {
        at.x = cursor.x;
        at.y = cursor.y - d;
        PostMessage(window, WM_MOUSEMOVE, 0, 0);
        PostMessage(window, WM_LBUTTONUP, 0, 0);
        wsprintf(probeArgs, "y-%d", d);
        wsprintf(probeResult, "%d", ((DRAGPROC)entry(465))(window, at));
        probe("dragdetect", probeArgs, probeResult);

        while (PeekMessage(&msg, NULL, WM_MOUSEFIRST, WM_MOUSELAST, PM_REMOVE)) {
        }
    }

    probe("dragdetect", "capture after", GetCapture() ? "set" : "none");
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
