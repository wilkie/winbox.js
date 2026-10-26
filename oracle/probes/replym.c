/*
 * ReplyMessage and QuerySendMessage, called by ordinal, in a message another
 * task sent, in one this task sent itself, and in one posted. `replym.child.c`
 * sends and posts the messages and notes what its sends answered in
 * C:\ORACLE\REPLYM.TXT, which the probe records once it is done.
 *
 * * `query`: QuerySendMessage's answer, and where it is 1 the message it
 *   wrote, as `P` for the probe's window, the message, wParam and lParam;
 *   with a first argument not nought.
 * * `insend`: whether InSendMessage answers non-nought, before and after
 *   ReplyMessage.
 * * `child`: what the child's sends answered.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\REPLYM.OUT"
#define LOG "C:\\ORACLE\\REPLYM.TXT"

typedef void(FAR PASCAL *REPLYPROC)(LRESULT);
typedef BOOL(FAR PASCAL *QUERYPROC)(HANDLE, HANDLE, HANDLE, LPMSG);

static HMODULE user;
static HWND self;
static BOOL done;

static FARPROC entry(int ordinal)
{
    return GetProcAddress(user, MAKEINTRESOURCE(ordinal));
}

static void query(LPCSTR what, HANDLE first)
{
    MSG msg;
    BOOL answer;

    msg.hwnd = (HWND)0x5555;
    msg.message = 0x5555;
    msg.wParam = 0x5555;
    msg.lParam = 0x55555555L;
    answer = ((QUERYPROC)entry(184))(first, NULL, NULL, &msg);

    if (answer) {
        wsprintf(probeResult, "1:%s:%04x:%04x:%08lx", (LPSTR)(msg.hwnd == self ? "P" : "other"),
                 msg.message, msg.wParam, msg.lParam);
    } else {
        wsprintf(probeResult, "%d", answer);
    }

    probe("query", what, probeResult);
}

static void insend(LPCSTR what)
{
    probe("insend", what, InSendMessage() ? "nonzero" : "0");
}

LRESULT CALLBACK _export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_USER + 1:
        insend("sent, before");
        query("sent", NULL);
        query("sent, first argument", (HANDLE)1);
        ((REPLYPROC)entry(115))(42);
        insend("sent, after reply");
        ((REPLYPROC)entry(115))(43);
        insend("sent, after second reply");
        return 99;

    case WM_USER + 2:
        insend("sent, no reply");
        query("sent, no reply", NULL);
        return 77;

    case WM_USER + 3:
        insend("posted");
        query("posted", NULL);
        ((REPLYPROC)entry(115))(5);
        insend("posted, after reply");
        return 0;

    case WM_USER + 4:
        insend("own send");
        query("own send", NULL);
        ((REPLYPROC)entry(115))(6);
        insend("own send, after reply");
        return 66;

    case WM_USER + 9:
        done = TRUE;
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    HFILE file;
    char line[200];
    int length;
    int at;
    int start;
    LRESULT answer;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");

    kind.style = 0;
    kind.lpfnWndProc = WindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ReplyProbe";
    RegisterClass(&kind);
    self = CreateWindow("ReplyProbe", "ReplyProbe", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 200,
                        100, NULL, NULL, instance, NULL);

    answer = SendMessage(self, WM_USER + 4, 0, 0);
    wsprintf(probeResult, "%ld", answer);
    probe("own", "SendMessage answered", probeResult);

    WinExec("REPLYMC.EXE", SW_SHOWNORMAL);

    while (!done && GetMessage(&msg, NULL, 0, 0)) {
        DispatchMessage(&msg);
    }

    file = _lopen(LOG, OF_READ);

    if (file != HFILE_ERROR) {
        length = _lread(file, line, sizeof(line) - 1);
        _lclose(file);
        line[length < 0 ? 0 : length] = '\0';
        start = 0;

        for (at = 0; at <= length; at++) {
            if (line[at] == '\r' || line[at] == '\0') {
                line[at] = '\0';

                if (at > start) {
                    probe("child", "line", line + start);
                }

                start = at + 2;
                at++;
            }
        }
    }

    DestroyWindow(self);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
