/*
 * WM_CTLCOLOR: what each of USER's controls asks its parent as it paints,
 * and what it does with the answer. Delphi's forms colour their controls
 * this way; Championship Slots of the corpus has a memo the colour of its
 * form, and no border.
 *
 * A parent window holds one of each control, each 80 by 24 with the text
 * "Ab". It is made twice: once leaving WM_CTLCOLOR to DefWindowProc, once
 * answering it with a red brush, the text colour blue and the background
 * colour green.
 *
 * * `asked`: the pass and the control; the CTLCOLOR_ types it was asked
 *   for as it was first painted, in order.
 * * `pixels`: the pass and the control; how many of its client area's
 *   pixels are each of the sixteen colours, as `digit=count`, the palette's
 *   digits.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\CTLCOLOR.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

#define CONTROLS 9

static const char *NAMES[CONTROLS] = {"edit",     "multiedit", "static",  "push",     "check",
                                      "radio",    "group",     "listbox", "scrollbar"};

static HINSTANCE instance;
static BOOL answering;
static HBRUSH red;
static char asked[CONTROLS][40];

static int digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return index;
        }
    }

    return -1;
}

LRESULT CALLBACK _export ParentProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_CTLCOLOR) {
        int id = GetDlgCtrlID((HWND)LOWORD(lParam));

        if (id >= 1 && id <= CONTROLS && lstrlen(asked[id - 1]) < 36) {
            char one[4];

            wsprintf(one, "%d", HIWORD(lParam));
            lstrcat(asked[id - 1], one);
        }

        if (answering) {
            SetTextColor((HDC)wParam, RGB(0, 0, 255));
            SetBkColor((HDC)wParam, RGB(0, 255, 0));
            return (LRESULT)red;
        }
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static HWND control(HWND parent, int id, LPCSTR kind, DWORD style)
{
    return CreateWindow(kind, "Ab", WS_CHILD | WS_VISIBLE | style, 10 + ((id - 1) % 3) * 100,
                        10 + ((id - 1) / 3) * 40, 80, 24, parent, (HMENU)id, instance, NULL);
}

static void census(LPCSTR pass, int id, HWND window)
{
    HDC dc = GetDC(window);
    RECT inner;
    long counts[17];
    char one[16];
    int x;
    int y;
    int i;

    for (i = 0; i < 17; i++) {
        counts[i] = 0;
    }

    GetClientRect(window, &inner);

    for (y = 0; y < inner.bottom; y++) {
        for (x = 0; x < inner.right; x++) {
            int index = digit(GetPixel(dc, x, y));

            counts[index < 0 ? 16 : index]++;
        }
    }

    ReleaseDC(window, dc);

    probeResult[0] = '\0';

    for (i = 0; i < 17; i++) {
        if (counts[i]) {
            wsprintf(one, "%s%c=%ld", (LPSTR)(probeResult[0] ? "," : ""), i < 16 ? HEX[i] : '?',
                     counts[i]);
            lstrcat(probeResult, one);
        }
    }

    wsprintf(probeArgs, "%s,%s", pass, (LPSTR)NAMES[id - 1]);
    probe("pixels", probeArgs, probeResult);
}

static void pass(LPCSTR name, BOOL answer)
{
    HWND parent;
    HWND children[CONTROLS];
    int i;

    answering = answer;

    for (i = 0; i < CONTROLS; i++) {
        asked[i][0] = '\0';
    }

    parent = CreateWindow("CtlColor", "Colours", WS_OVERLAPPED | WS_CAPTION | WS_CLIPCHILDREN, 0, 0,
                          340, 180, NULL, NULL, instance, NULL);
    children[0] = control(parent, 1, "EDIT", WS_BORDER | ES_LEFT);
    children[1] = control(parent, 2, "EDIT", ES_MULTILINE);
    children[2] = control(parent, 3, "STATIC", SS_LEFT);
    children[3] = control(parent, 4, "BUTTON", BS_PUSHBUTTON);
    children[4] = control(parent, 5, "BUTTON", BS_CHECKBOX);
    children[5] = control(parent, 6, "BUTTON", BS_RADIOBUTTON);
    children[6] = control(parent, 7, "BUTTON", BS_GROUPBOX);
    children[7] = control(parent, 8, "LISTBOX", 0);
    children[8] = control(parent, 9, "SCROLLBAR", SBS_HORZ);
    SendMessage(children[7], LB_ADDSTRING, 0, (LPARAM)(LPCSTR) "Ab");

    ShowWindow(parent, SW_SHOWNORMAL);
    UpdateWindow(parent);

    for (i = 0; i < CONTROLS; i++) {
        UpdateWindow(children[i]);
    }

    for (i = 0; i < CONTROLS; i++) {
        wsprintf(probeArgs, "%s,%s", name, (LPSTR)NAMES[i]);
        probe("asked", probeArgs, asked[i]);
    }

    for (i = 0; i < CONTROLS; i++) {
        census(name, i + 1, children[i]);
    }

    DestroyWindow(parent);
}

int PASCAL WinMain(HINSTANCE self, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    instance = self;
    probeOpen(OUTPUT);
    red = CreateSolidBrush(RGB(255, 0, 0));

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = ParentProc;
    kind.hInstance = instance;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "CtlColor";
    RegisterClass(&kind);

    pass("default", FALSE);
    pass("answered", TRUE);

    DeleteObject(red);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
