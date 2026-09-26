/*
 * Message boxes: where the box goes, what is in it, and what it looks like.
 *
 * `MessageBox` does not return while its box is up, so a timer set before it
 * does the looking: its procedure runs from inside the box's own message
 * loop. It records the box and every control in it, reads every pixel of the
 * box off the screen, and then presses Enter on whatever has the focus, so
 * the answer says which button the box took as its default.
 *
 * Each case is one call, with the owner window below unless it says not:
 *
 * * `box`: the box's window and client rectangles on the screen, its caption,
 *   whether its owner is enabled while it is up, and the control with the
 *   focus.
 * * `control`: each control in the box, in order: its class, its ID, its
 *   style in hexadecimal, its text, and its rectangle in the box's client
 *   area.
 * * `rows`: the box's pixels, a row a record, as the palette's digits.
 * * `answer`: what `MessageBox` answered.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MSGBOX.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HWND owner;
static LPCSTR phase = "";
static char row[700];

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

static void look(HWND box)
{
    RECT window;
    RECT client;
    POINT corner;
    HWND child;
    HWND focus;
    char text[256];
    char kind[32];
    HDC screen;
    int x;
    int y;
    int index = 0;

    GetWindowRect(box, &window);
    GetClientRect(box, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(box, &corner);
    GetWindowText(box, text, sizeof(text));
    focus = GetFocus();

    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d,caption=%s,owner-enabled=%d,focus=%d",
             window.left, window.top, window.right, window.bottom, corner.x, corner.y,
             corner.x + client.right, corner.y + client.bottom, (LPSTR)text,
             owner ? (IsWindowEnabled(owner) ? 1 : 0) : -1,
             focus && GetParent(focus) == box ? GetDlgCtrlID(focus) : -1);
    probe("box", phase, probeResult);

    for (child = GetWindow(box, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        RECT place;

        GetWindowRect(child, &place);
        ScreenToClient(box, (LPPOINT)&place.left);
        ScreenToClient(box, (LPPOINT)&place.right);
        GetClassName(child, kind, sizeof(kind));
        GetWindowText(child, text, sizeof(text));
        wsprintf(probeArgs, "%s,%d", phase, index++);
        wsprintf(probeResult, "class=%s,id=%d,style=%08lx,text=%s,rect=%d:%d:%d:%d", (LPSTR)kind,
                 GetDlgCtrlID(child), GetWindowLong(child, GWL_STYLE), (LPSTR)text, place.left,
                 place.top, place.right, place.bottom);
        probe("control", probeArgs, probeResult);
    }

    screen = GetDC(NULL);

    for (y = window.top; y < window.bottom; y++) {
        LPSTR out = row;

        for (x = window.left; x < window.right && x - window.left < (int)sizeof(row) - 1; x++) {
            *out++ = digit(GetPixel(screen, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", phase, y - window.top);
        probe("rows", probeArgs, row);
    }

    ReleaseDC(NULL, screen);
}

void CALLBACK __export Looker(HWND hwnd, UINT message, UINT id, DWORD time)
{
    HWND box = GetActiveWindow();
    HWND focus;

    KillTimer(NULL, id);

    if (box && box != owner) {
        look(box);
    }

    focus = GetFocus();
    PostMessage(focus ? focus : box, WM_KEYDOWN, VK_RETURN, 0x001c0001L);
    PostMessage(focus ? focus : box, WM_KEYUP, VK_RETURN, 0xc01c0001L);
}

static void box(LPCSTR name, HWND parent, LPCSTR text, LPCSTR title, UINT style)
{
    int answer;

    phase = name;
    SetTimer(NULL, 0, 200, (TIMERPROC)Looker);
    answer = MessageBox(parent, text, title, style);
    wsprintf(probeResult, "%d", answer);
    probe("answer", name, probeResult);
}

LONG FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG message;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = OwnerProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeOwner";
    RegisterClass(&kind);

    owner = CreateWindow("ProbeOwner", "Owner", WS_OVERLAPPEDWINDOW, 10, 10, 200, 120, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&message);
    }

    box("ok", owner, "Hello", "Title", MB_OK);
    box("null-title", owner, "No title given.", NULL, MB_OK);
    box("question", owner, "Save the changes?", "Question", MB_YESNOCANCEL | MB_ICONQUESTION | MB_DEFBUTTON2);
    box("long", owner,
        "This message is long enough that it has to be broken into several lines to fit "
        "inside the box, which is only so wide, however much there is to say in it.",
        "Long", MB_OKCANCEL | MB_ICONEXCLAMATION);
    box("hand", owner, "Something failed.", "Stop", MB_ABORTRETRYIGNORE | MB_ICONHAND | MB_DEFBUTTON3);
    box("asterisk", owner, "First line\nSecond line", "Lines", MB_RETRYCANCEL | MB_ICONASTERISK);
    box("no-owner", NULL, "Nobody owns this.", "Alone", MB_OK);
    box("yesno", owner, "Yes or no?", "Choose", MB_YESNO);

    DestroyWindow(owner);
    owner = NULL;
    probeFinish();

    return 0;
}
