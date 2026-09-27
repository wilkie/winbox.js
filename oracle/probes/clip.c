/*
 * The clipboard: opening it, putting data on it, taking it off, the formats
 * it lists, data rendered only when asked for, and the viewer chain.
 *
 * Two windows: O, which owns what is put on the clipboard, and V, a viewer.
 * A third, W, is a second viewer put in after V.
 *
 * * `answer`: what a call answered, with handles named -- `given` for the
 *   handle the probe put on, `other` for another, and windows by name;
 *   what setting data answered as `same`, the handle it was given, or not.
 * * `text`: the text of a block taken off the clipboard.
 * * `formats`: `EnumClipboardFormats` from the start, in order.
 * * `messages`: the clipboard messages O, V and W were sent during a step,
 *   in order, as `V:308`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CLIP.OUT"

static HWND owner;
static HWND viewer;
static HWND second;
static HWND nextOfV;
static HWND nextOfW;
static HGLOBAL given;
static UINT private;
static char log[256];

static LPCSTR name(HWND hwnd)
{
    if (!hwnd) {
        return "0";
    }

    if (hwnd == owner) {
        return "O";
    }

    if (hwnd == viewer) {
        return "V";
    }

    if (hwnd == second) {
        return "W";
    }

    return "?";
}

static void note(HWND hwnd, UINT message)
{
    char one[16];

    if (lstrlen(log) > 230) {
        return;
    }

    wsprintf(one, "%s%s:%x", (LPSTR)(log[0] ? " " : ""), name(hwnd), message);
    lstrcat(log, one);
}

static HGLOBAL block(LPCSTR text)
{
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, lstrlen(text) + 1);
    LPSTR at = GlobalLock(memory);

    lstrcpy(at, text);
    GlobalUnlock(memory);

    return memory;
}

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_RENDERFORMAT:
        note(hwnd, message);
        SetClipboardData(wParam, block("rendered"));
        return 0;

    case WM_RENDERALLFORMATS:
    case WM_DESTROYCLIPBOARD:
    case WM_DRAWCLIPBOARD:
        note(hwnd, message);

        if (message == WM_DRAWCLIPBOARD && hwnd == viewer && nextOfV) {
            SendMessage(nextOfV, message, wParam, lParam);
        }

        if (message == WM_DRAWCLIPBOARD && hwnd == second && nextOfW) {
            SendMessage(nextOfW, message, wParam, lParam);
        }

        return 0;

    case WM_CHANGECBCHAIN:
        note(hwnd, message);

        if (hwnd == second) {
            if ((HWND)wParam == nextOfW) {
                nextOfW = (HWND)LOWORD(lParam);
            } else if (nextOfW) {
                SendMessage(nextOfW, message, wParam, lParam);
            }
        }

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

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("answer", what, probeResult);
}

static void handle(LPCSTR what, HANDLE value)
{
    probe("answer", what, (LPSTR)(!value ? "0" : value == given ? "given" : "other"));
}

/* What setting answered: the handle it was given back, or another, or nought. */
static void set(LPCSTR what, UINT format, HANDLE data)
{
    HANDLE back = SetClipboardData(format, data);

    probe("answer", what, (LPSTR)(!back ? "0" : back == data ? "same" : "other"));
}

static void window(LPCSTR what, HWND value)
{
    probe("answer", what, name(value));
}

static void text(LPCSTR what, HANDLE value)
{
    LPSTR at;

    if (!value) {
        probe("text", what, "none");
        return;
    }

    at = GlobalLock(value);
    probe("text", what, at ? at : "unlocked");
    GlobalUnlock(value);
}

static void formats(LPCSTR what)
{
    char one[8];
    UINT format = 0;
    int count = 0;

    probeResult[0] = '\0';

    while ((format = EnumClipboardFormats(format)) != 0 && count < 20) {
        wsprintf(one, "%s%s", (LPSTR)(count ? "," : ""),
                 (LPSTR)(format == private ? "private" : ""));

        if (format != private) {
            wsprintf(one + lstrlen(one), "%u", format);
        }

        lstrcat(probeResult, one);
        count++;
    }

    probe("formats", what, probeResult);
}

static void begin(void)
{
    log[0] = '\0';
}

static void end(LPCSTR step)
{
    pump();
    probe("messages", step, log);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;

    probeOpen(OUTPUT);

    windowClass.style = 0;
    windowClass.lpfnWndProc = ProbeProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "Clip";
    RegisterClass(&windowClass);

    owner = CreateWindow("Clip", "O", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL, instance,
                         NULL);
    viewer = CreateWindow("Clip", "V", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL, instance,
                          NULL);
    second = CreateWindow("Clip", "W", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL, instance,
                          NULL);
    private = RegisterClipboardFormat("Probe Format");

    /* As it is found. */
    answer("count-first", CountClipboardFormats());
    window("owner-first", GetClipboardOwner());
    window("viewer-first", GetClipboardViewer());

    /* The viewer put in. */
    begin();
    nextOfV = SetClipboardViewer(viewer);
    window("set-viewer", nextOfV);
    end("set-viewer");
    window("viewer-now", GetClipboardViewer());

    /* Opened, emptied, and text put on. */
    begin();
    answer("open", OpenClipboard(owner));
    answer("open-again", OpenClipboard(viewer));
    answer("empty", EmptyClipboard());
    window("owner-empty", GetClipboardOwner());
    given = block("Hello");
    set("set-text", CF_TEXT, given);
    answer("count-text", CountClipboardFormats());
    formats("text");
    answer("available-text", IsClipboardFormatAvailable(CF_TEXT));
    answer("available-oem", IsClipboardFormatAvailable(CF_OEMTEXT));
    answer("available-bitmap", IsClipboardFormatAvailable(CF_BITMAP));
    handle("get-text", GetClipboardData(CF_TEXT));
    text("oem", GetClipboardData(CF_OEMTEXT));
    formats("text-after-oem");
    answer("close", CloseClipboard());
    end("text");

    /* What it lists once closed: made from what was put on. */
    OpenClipboard(viewer);
    answer("count-closed", CountClipboardFormats());
    formats("after-close");
    text("oem-after-close", GetClipboardData(CF_OEMTEXT));
    CloseClipboard();

    /* And the other way: OEM text put on. */
    OpenClipboard(owner);
    EmptyClipboard();
    SetClipboardData(CF_OEMTEXT, block("Oem"));
    CloseClipboard();
    OpenClipboard(viewer);
    formats("oem-put");
    text("text-from-oem", GetClipboardData(CF_TEXT));
    CloseClipboard();
    OpenClipboard(owner);
    EmptyClipboard();
    SetClipboardData(CF_TEXT, block("Hello"));
    CloseClipboard();

    /* Taken off with it closed, and with it open by another window. */
    handle("get-closed", GetClipboardData(CF_TEXT));
    answer("close-closed", CloseClipboard());
    begin();
    answer("open-viewer", OpenClipboard(viewer));
    text("get-viewer", GetClipboardData(CF_TEXT));
    answer("close-viewer", CloseClipboard());
    end("read");

    /* A format rendered only when asked for, and a registered one. */
    begin();
    OpenClipboard(owner);
    answer("empty-again", EmptyClipboard());
    set("set-delayed", CF_TEXT, NULL);
    set("set-private", private, block("mine"));
    formats("delayed");
    text("get-delayed", GetClipboardData(CF_TEXT));
    text("get-private", GetClipboardData(private));
    answer("close-delayed", CloseClipboard());
    end("delayed");

    /* A second viewer, and the first taken out of the chain. */
    begin();
    nextOfW = SetClipboardViewer(second);
    window("set-second", nextOfW);
    end("set-second");
    begin();
    answer("change-chain", ChangeClipboardChain(viewer, nextOfV));
    end("change-chain");
    window("viewer-last", GetClipboardViewer());

    /* Emptied by another, and the owner's data given up at its end. */
    begin();
    OpenClipboard(second);
    answer("empty-other", EmptyClipboard());
    window("owner-other", GetClipboardOwner());
    CloseClipboard();
    end("empty-other");

    ChangeClipboardChain(second, nextOfW);
    DestroyWindow(owner);
    DestroyWindow(viewer);
    DestroyWindow(second);
    probeFinish();

    return 0;
}
