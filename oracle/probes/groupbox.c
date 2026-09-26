/*
 * Group boxes, and the controls drawn inside them.
 *
 * A dialog's group box lies over the radio buttons it groups: the siblings
 * overlap, and neither has `WS_CLIPSIBLINGS`. Two dialogs, one in bold MS
 * Sans Serif 8 as `COMMDLG.DLL`'s Find dialog is and one in the System font,
 * each with a group box made before its two radio buttons, as Find makes
 * its Direction box, and another made after them, the lower one checked:
 *
 * * `rects`: the dialog's window and client rectangles on the screen.
 * * `control`: each control's rectangle in the client area.
 * * `pixels`: every pixel of the dialog, a row a record.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GROUPBOX.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HINSTANCE module;
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

static void string(LPCSTR text)
{
    while (*text) {
        byte(*text++);
    }

    byte(0);
}

/* The dialog's header: style, count, place and size, no menu, no class. */
static int headerX = 10;

static void header(DWORD style, int count, LPCSTR caption, BOOL font)
{
    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte((BYTE)count);
    word(headerX);
    word(10);
    word(160);
    word(90);
    byte(0);
    byte(0);
    string(caption);

    if (font) {
        word(8);
        string("MS Sans Serif");
    }
}

static void item(int x, int y, int cx, int cy, int id, DWORD style, BYTE kind, LPCSTR text)
{
    word(x);
    word(y);
    word(cx);
    word(cy);
    word(id);
    word(LOWORD(style | WS_CHILD | WS_VISIBLE));
    word(HIWORD(style | WS_CHILD | WS_VISIBLE));
    byte(kind);
    string(text);
    byte(0);
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

static void build(BOOL font)
{
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | WS_VISIBLE;

    header(font ? style | DS_SETFONT : style, 6, "Groups", font);
    item(6, 6, 70, 34, 100, BS_GROUPBOX, 0x80, "Direction");
    item(12, 18, 26, 12, 101, BS_AUTORADIOBUTTON | WS_GROUP, 0x80, "&Up");
    item(42, 18, 30, 12, 102, BS_AUTORADIOBUTTON, 0x80, "&Down");
    item(88, 18, 26, 12, 103, BS_AUTORADIOBUTTON | WS_GROUP, 0x80, "&Left");
    item(118, 18, 30, 12, 104, BS_AUTORADIOBUTTON, 0x80, "&Right");
    item(82, 6, 70, 34, 105, BS_GROUPBOX, 0x80, "After");
}

static void describe(LPCSTR name, HWND dialog)
{
    RECT window;
    RECT client;
    POINT corner;
    HDC screen;
    int id;
    int x;
    int y;

    GetWindowRect(dialog, &window);
    GetClientRect(dialog, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(dialog, &corner);

    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d", window.left, window.top,
             window.right, window.bottom, corner.x, corner.y, corner.x + client.right,
             corner.y + client.bottom);
    probe("rects", name, probeResult);

    for (id = 100; id <= 105; id++) {
        RECT rect;

        GetWindowRect(GetDlgItem(dialog, id), &rect);
        wsprintf(probeArgs, "%s,id=%d", name, id);
        wsprintf(probeResult, "%d:%d:%d:%d", rect.left - corner.x, rect.top - corner.y,
                 rect.right - corner.x, rect.bottom - corner.y);
        probe("control", probeArgs, probeResult);
    }

    screen = GetDC(NULL);

    for (y = window.top; y < window.bottom; y++) {
        LPSTR out = probeResult;

        for (x = window.left; x < window.right; x++) {
            *out++ = digit(GetPixel(screen, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - window.top);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 1024);
    FARPROC proc = MakeProcInstance((FARPROC)DialogProc, instance);
    int pass;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);
    module = instance;
    template = (BYTE FAR *)GlobalLock(memory);

    for (pass = 0; pass < 2; pass++) {
        HWND dialog;

        build(pass == 0);
        dialog = CreateDialogIndirect(instance, template, NULL, (DLGPROC)proc);
        CheckRadioButton(dialog, 101, 102, 102);
        CheckRadioButton(dialog, 103, 104, 104);
        pump();
        describe(pass == 0 ? "sans" : "system", dialog);
        DestroyWindow(dialog);
        pump();
    }

    GlobalUnlock(memory);
    GlobalFree(memory);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
