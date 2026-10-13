/*
 * The server `dderaw.c` starts: an overlapped window, "Raw Server", that
 * speaks the DDE protocol by hand, with no DDEML -- the messages, the atoms
 * and the shared memory as a program of 1990 would. It writes a line to
 * C:\ORACLE\DDERAW.TXT for each DDE message it is handed and for what it
 * does about it:
 *
 * * `WM_DDE_INITIATE`, sent: for the application "RawSrv" (or none) and the
 *   topic "RawTopic" (or none) it adds both names as atoms and sends the
 *   initiator `WM_DDE_ACK` with them, as the protocol asks.
 * * `WM_DDE_REQUEST`: posts `WM_DDE_DATA` back, `fResponse` and `fRelease`,
 *   CF_TEXT "Hello", in a block of `GMEM_DDESHARE`, the item's atom used
 *   again.
 * * `WM_DDE_POKE`: writes what the block holds and its flags, frees it
 *   (it is marked `fRelease`) and posts a positive `WM_DDE_ACK`.
 * * `WM_DDE_EXECUTE`: writes the commands and posts `WM_DDE_ACK` with the
 *   same handle in its high word.
 * * `WM_DDE_ADVISE`: writes the options, frees them, acknowledges, then
 *   posts one `WM_DDE_DATA` with `fAckReq` for the item.
 * * `WM_DDE_UNADVISE` is acknowledged, `WM_DDE_ACK` written and its atom
 *   deleted, `WM_DDE_TERMINATE` answered with `WM_DDE_TERMINATE`.
 * * `WM_USER + 7` is counted, and `WM_USER + 9` closes it.
 */

#include <windows.h>
#include <dde.h>

#define LOG "C:\\ORACLE\\DDERAW.TXT"

static HWND client;
static int counted;

static void note(LPCSTR text)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, text, lstrlen(text));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

/* An atom by its name, `-` for none, `?` for one that is not there. */
static LPSTR atomName(ATOM atom, LPSTR out)
{
    if (!atom) {
        lstrcpy(out, "-");
    } else if (!GlobalGetAtomName(atom, out, 40)) {
        lstrcpy(out, "?");
    }

    return out;
}

/* A block of DDE memory: its flags, the status word, the format and the
 * text after them. */
static LPSTR block(HGLOBAL handle, LPSTR out)
{
    LPWORD words;

    if (!handle) {
        lstrcpy(out, "null");
        return out;
    }

    words = (LPWORD)GlobalLock(handle);

    if (!words) {
        lstrcpy(out, "unlocked");
        return out;
    }

    wsprintf(out, "flags=%x,status=%x,cf=%u,%s", GlobalFlags(handle), words[0], words[1],
             (LPSTR)(words + 2));
    GlobalUnlock(handle);
    return out;
}

static HGLOBAL make(WORD status, LPCSTR text, WORD flags)
{
    HGLOBAL handle = GlobalAlloc(flags, 4 + lstrlen(text) + 1);
    LPWORD words = (LPWORD)GlobalLock(handle);

    words[0] = status;
    words[1] = CF_TEXT;
    lstrcpy((LPSTR)(words + 2), text);
    GlobalUnlock(handle);
    return handle;
}

static char who(HWND window)
{
    if (window && window == client) {
        return 'P';
    }

    return IsWindow(window) ? 'W' : '?';
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[200];
    char one[48];
    char two[48];
    char data[120];
    char how = InSendMessage() ? 's' : 'p';
    ATOM app;
    ATOM topic;
    HGLOBAL handle;
    LONG answer;
    LPSTR text;

    switch (message) {
    case WM_DDE_INITIATE:
        wsprintf(line, "S:%c:init:%c:%s:%s", how, IsWindow((HWND)wParam) ? 'w' : '?',
                 atomName(LOWORD(lParam), one), atomName(HIWORD(lParam), two));
        note(line);

        if ((!LOWORD(lParam) || !lstrcmpi(one, "RawSrv")) &&
            (!HIWORD(lParam) || !lstrcmpi(two, "RawTopic")) && IsWindow((HWND)wParam)) {
            client = (HWND)wParam;
            app = GlobalAddAtom("RawSrv");
            topic = GlobalAddAtom("RawTopic");
            answer = SendMessage(client, WM_DDE_ACK, (WPARAM)window, MAKELONG(app, topic));
            wsprintf(line, "S:ack:%ld", answer);
            note(line);
        }

        return 0;

    case WM_DDE_REQUEST:
        wsprintf(line, "S:%c:request:%c:cf=%u:%s", how, who((HWND)wParam), LOWORD(lParam),
                 atomName(HIWORD(lParam), one));
        note(line);
        handle = make(0x3000, "Hello", GMEM_MOVEABLE | GMEM_DDESHARE);
        answer = PostMessage((HWND)wParam, WM_DDE_DATA, (WPARAM)window,
                             MAKELONG(handle, HIWORD(lParam)));
        wsprintf(line, "S:data:%ld", answer);
        note(line);
        return 0;

    case WM_DDE_POKE:
        wsprintf(line, "S:%c:poke:%c:%s:%s", how, who((HWND)wParam),
                 block((HGLOBAL)LOWORD(lParam), data), atomName(HIWORD(lParam), one));
        note(line);

        if (LOWORD(lParam)) {
            wsprintf(line, "S:free:%u", GlobalFree((HGLOBAL)LOWORD(lParam)) ? 1 : 0);
            note(line);
        }

        answer = PostMessage((HWND)wParam, WM_DDE_ACK, (WPARAM)window,
                             MAKELONG(0x8000, HIWORD(lParam)));
        wsprintf(line, "S:ack:%ld", answer);
        note(line);
        return 0;

    case WM_DDE_EXECUTE:
        handle = (HGLOBAL)HIWORD(lParam);
        text = handle ? (LPSTR)GlobalLock(handle) : NULL;
        wsprintf(line, "S:%c:execute:%c:lo=%u:%s:flags=%x", how, who((HWND)wParam),
                 LOWORD(lParam), text ? text : (LPSTR) "null",
                 handle ? GlobalFlags(handle) : 0);

        if (text) {
            GlobalUnlock(handle);
        }

        note(line);
        answer = PostMessage((HWND)wParam, WM_DDE_ACK, (WPARAM)window,
                             MAKELONG(0x8000, HIWORD(lParam)));
        wsprintf(line, "S:ack:%ld", answer);
        note(line);
        return 0;

    case WM_DDE_ADVISE:
        handle = (HGLOBAL)LOWORD(lParam);
        text = handle ? (LPSTR)GlobalLock(handle) : NULL;
        wsprintf(line, "S:%c:advise:%c:%s:status=%x,cf=%u,flags=%x", how, who((HWND)wParam),
                 atomName(HIWORD(lParam), one), text ? ((LPWORD)text)[0] : 0,
                 text ? ((LPWORD)text)[1] : 0, handle ? GlobalFlags(handle) : 0);

        if (text) {
            GlobalUnlock(handle);
            GlobalFree(handle);
        }

        note(line);
        answer = PostMessage((HWND)wParam, WM_DDE_ACK, (WPARAM)window,
                             MAKELONG(0x8000, HIWORD(lParam)));
        wsprintf(line, "S:ack:%ld", answer);
        note(line);
        handle = make(0xa000, "Advised", GMEM_MOVEABLE | GMEM_DDESHARE);
        answer = PostMessage((HWND)wParam, WM_DDE_DATA, (WPARAM)window,
                             MAKELONG(handle, GlobalAddAtom("RawItem")));
        wsprintf(line, "S:data:%ld", answer);
        note(line);
        return 0;

    case WM_DDE_UNADVISE:
        wsprintf(line, "S:%c:unadvise:%c:cf=%u:%s", how, who((HWND)wParam), LOWORD(lParam),
                 atomName(HIWORD(lParam), one));
        note(line);
        answer = PostMessage((HWND)wParam, WM_DDE_ACK, (WPARAM)window,
                             MAKELONG(0x8000, HIWORD(lParam)));
        wsprintf(line, "S:ack:%ld", answer);
        note(line);
        return 0;

    case WM_DDE_ACK:
        wsprintf(line, "S:%c:ack:%c:status=%x:%s", how, who((HWND)wParam), LOWORD(lParam),
                 atomName(HIWORD(lParam), one));
        note(line);

        if (HIWORD(lParam)) {
            GlobalDeleteAtom(HIWORD(lParam));
        }

        return 0;

    case WM_DDE_DATA:
        wsprintf(line, "S:%c:data:%c:%s:%s", how, who((HWND)wParam),
                 block((HGLOBAL)LOWORD(lParam), data), atomName(HIWORD(lParam), one));
        note(line);
        return 0;

    case WM_DDE_TERMINATE:
        wsprintf(line, "S:%c:terminate:%c:%lx", how, who((HWND)wParam), lParam);
        note(line);
        answer = PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)window, 0L);
        wsprintf(line, "S:terminate:%ld", answer);
        note(line);
        return 0;

    case WM_USER + 7:
        counted++;
        wsprintf(line, "S:u7:%d", counted);
        note(line);
        return 0;

    case WM_USER + 9:
        DestroyWindow(window);
        return 0;

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    MSG msg;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeRawS";
    RegisterClass(&kind);

    window = CreateWindow("DdeRawS", "Raw Server", WS_OVERLAPPEDWINDOW, 400, 300, 160, 100, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, SW_SHOWNOACTIVATE);
    UpdateWindow(window);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
