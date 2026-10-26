/*
 * GDI's calls that USER and drivers make on a device context, asked by a
 * program: the font selected, the relative-or-absolute mode, the hook a
 * context calls, its clip region's handle, `ResetDC`, and the palette
 * internals -- `GDISelectPalette`, `GDIRealizePalette`,
 * `RealizeDefaultPalette`, `IsDCCurrentPalette` and `UpdateColors`.
 * Recorded on the VGA and the 256-colour display.
 *
 * Handles are never recorded, only whether two are the same.
 *
 * * `curfont`: `GetCurLogFont` of a memory context, against the System
 *   font, and with a font of the probe's selected.
 * * `relabs`: `GetRelAbs`, all its dword, and `SetRelAbs`' answers, their
 *   low word: the high is whatever DH held.
 * * `hook`: `GetDCHook` and `SetDCHook` of a memory context, `SetHookFlags`,
 *   and, in `dchook` only (`DCINNER_HOOKCALLS`), `hookcall`: whether GDI
 *   then calls the hook -- how many times, with what code, data and lParam
 *   -- as `GetClipBox`, `GetTextColor` and `Rectangle` are called. A window's context: whether its hook is USER's
 *   `DCHOOK`.
 * * `cliprgn`: `GetClipRgn` -- nought, the same as the region selected,
 *   or another, and that region's box -- as clip regions are selected.
 * * `reset`: `ResetDC` of a memory context, a window's, the screen's.
 * * `palette`: the palette internals, a palette of the probe's selected
 *   with USER's `SelectPalette` and GDI's own. `IsDCCurrentPalette`'s low
 *   word: the high is whatever DX held.
 */

#include "probe.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\DCINNER.OUT"
#endif

typedef DWORD(FAR PASCAL *DWORDPROC1)(HDC);
typedef DWORD(FAR PASCAL *DWORDPROC2)(HDC, WORD);
typedef DWORD(FAR PASCAL *SELECTPROC)(HDC, HPALETTE, WORD);
typedef DWORD(FAR PASCAL *SETHOOKPROC)(HDC, FARPROC, DWORD);
typedef DWORD(FAR PASCAL *GETHOOKPROC)(HDC, FARPROC FAR *);
typedef HDC(FAR PASCAL *RESETPROC)(HDC, void FAR *);

static DWORDPROC2 setRelAbs, setHookFlags;
static DWORDPROC1 getRelAbs, getClipRgn, getCurLogFont, isDCCurrentPalette, gdiRealizePalette,
    realizeDefaultPalette;
static SELECTPROC gdiSelectPalette;
static SETHOOKPROC setDCHook;
static GETHOOKPROC getDCHook;
static RESETPROC resetDC;

static int hookCalls;
static WORD hookCode;
static DWORD hookData;
static DWORD hookParam;
static BOOL hookSameDC;
static HDC hookExpected;

BOOL FAR PASCAL _export HookProc(HDC hdc, WORD code, DWORD data, DWORD param)
{
    hookCalls++;
    hookCode = code;
    hookData = data;
    hookParam = param;
    hookSameDC = hdc == hookExpected;
    return TRUE;
}

static FARPROC gdiProc(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

static LPCSTR same(WORD a, WORD b, WORD none)
{
    if (a == 0) {
        return "nought";
    }

    if (a == b) {
        return "same";
    }

    if (a == none) {
        return "stock";
    }

    return "other";
}

static void hookReport(LPCSTR what)
{
#ifdef DCINNER_HOOKCALLS
    wsprintf(probeResult, "calls=%d code=%u data=%08lx param=%08lx samedc=%d", hookCalls,
             hookCode, hookData, hookParam, hookSameDC);
    probe("hookcall", what, probeResult);
#else
    (void)what;
#endif
    hookCalls = 0;
    hookCode = 0;
    hookData = 0;
    hookParam = 0;
    hookSameDC = 0;
}

static void clipReport(HDC hdc, LPCSTR what, HRGN selected)
{
    HRGN got = (HRGN)LOWORD(getClipRgn(hdc));
    RECT box;
    int kind = 0;

    box.left = box.top = box.right = box.bottom = -1;

    if (got) {
        kind = GetRgnBox(got, &box);
    }

    wsprintf(probeResult, "%s kind=%d box=%d,%d,%d,%d", same((WORD)got, (WORD)selected, 0xffff),
             kind, box.left, box.top, box.right, box.bottom);
    probe("cliprgn", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HDC memory, other, client, screen;
    HFONT font;
    HRGN region;
    RECT box;
    FARPROC hook, got;
    DWORD answer;
    HPALETTE palette, before;
    LOGPALETTE *logical;
    static char paletteBytes[sizeof(LOGPALETTE) + 4 * sizeof(PALETTEENTRY)];
    int i;

    probeOpen(OUTPUT);

    setRelAbs = (DWORDPROC2)gdiProc(5);
    getRelAbs = (DWORDPROC1)gdiProc(86);
    getClipRgn = (DWORDPROC1)gdiProc(173);
    setDCHook = (SETHOOKPROC)gdiProc(190);
    getDCHook = (GETHOOKPROC)gdiProc(191);
    setHookFlags = (DWORDPROC2)gdiProc(192);
    gdiSelectPalette = (SELECTPROC)gdiProc(361);
    gdiRealizePalette = (DWORDPROC1)gdiProc(362);
    realizeDefaultPalette = (DWORDPROC1)gdiProc(365);
    resetDC = (RESETPROC)gdiProc(376);
    getCurLogFont = (DWORDPROC1)gdiProc(411);
    isDCCurrentPalette = (DWORDPROC1)gdiProc(412);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DcInner";
    RegisterClass(&kind);
    window = CreateWindow("DcInner", "DcInner", WS_OVERLAPPEDWINDOW, 10, 10, 200, 120, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    memory = CreateCompatibleDC(NULL);

    /* curfont */
    wsprintf(probeResult, "%s",
             same((WORD)getCurLogFont(memory), (WORD)GetStockObject(SYSTEM_FONT), 0xffff));
    probe("curfont", "new memory context", probeResult);
    font = CreateFont(-12, 0, 0, 0, 400, 0, 0, 0, ANSI_CHARSET, 0, 0, 0, 0, "Arial");
    SelectObject(memory, font);
    wsprintf(probeResult, "%s",
             same((WORD)getCurLogFont(memory), (WORD)font, (WORD)GetStockObject(SYSTEM_FONT)));
    probe("curfont", "a font selected", probeResult);
    SelectObject(memory, GetStockObject(SYSTEM_FONT));
    DeleteObject(font);

    /* relabs */
    wsprintf(probeResult, "%08lx", getRelAbs(memory));
    probe("relabs", "new memory context", probeResult);
    wsprintf(probeResult, "%04x", LOWORD(setRelAbs(memory, 2)));
    probe("relabs", "set 2", probeResult);
    wsprintf(probeResult, "%08lx", getRelAbs(memory));
    probe("relabs", "after 2", probeResult);
    wsprintf(probeResult, "%04x", LOWORD(setRelAbs(memory, 7)));
    probe("relabs", "set 7", probeResult);
    wsprintf(probeResult, "%08lx", getRelAbs(memory));
    probe("relabs", "after 7", probeResult);
    SetPolyFillMode(memory, WINDING);
    wsprintf(probeResult, "%08lx", getRelAbs(memory));
    probe("relabs", "winding", probeResult);
    i = SaveDC(memory);
    setRelAbs(memory, 1);
    RestoreDC(memory, i);
    wsprintf(probeResult, "%08lx", getRelAbs(memory));
    probe("relabs", "restored", probeResult);
    wsprintf(probeResult, "%08lx", getRelAbs(NULL));
    probe("relabs", "no context", probeResult);

    /* hook, on a memory context */
    hook = MakeProcInstance((FARPROC)HookProc, instance);
    got = (FARPROC)0x12345678L;
    answer = getDCHook(memory, &got);
    wsprintf(probeResult, "%08lx proc=%08lx", answer, (DWORD)got);
    probe("hook", "get, new memory context", probeResult);
    wsprintf(probeResult, "%08lx", setHookFlags(memory, 1));
    probe("hook", "flags 1, no hook", probeResult);
    wsprintf(probeResult, "%08lx", setHookFlags(memory, 0));
    probe("hook", "flags 0", probeResult);
    wsprintf(probeResult, "%08lx", setHookFlags(memory, 0));
    probe("hook", "flags 0 again", probeResult);
    hookExpected = memory;
    wsprintf(probeResult, "%08lx", setDCHook(memory, hook, 0xcafe1234L));
    probe("hook", "set", probeResult);
    answer = getDCHook(memory, &got);
    wsprintf(probeResult, "%08lx proc=%s", answer, (LPSTR)(got == hook ? "same" : "other"));
    probe("hook", "get, set", probeResult);
    GetClipBox(memory, &box);
    hookReport("clip box, flags clear");
    wsprintf(probeResult, "%08lx", setHookFlags(memory, 1));
    probe("hook", "flags 1", probeResult);
    GetClipBox(memory, &box);
    hookReport("clip box");
    GetTextColor(memory);
    hookReport("text colour");
    Rectangle(memory, 0, 0, 4, 4);
    hookReport("rectangle");
    wsprintf(probeResult, "%08lx", setHookFlags(memory, 1));
    probe("hook", "flags 1 again", probeResult);
    wsprintf(probeResult, "%08lx", setHookFlags(memory, 2));
    probe("hook", "flags 2", probeResult);
    GetClipBox(memory, &box);
    hookReport("clip box, flags 2");
    setHookFlags(memory, 1);
    wsprintf(probeResult, "%08lx", setDCHook(memory, NULL, 0L));
    probe("hook", "set none", probeResult);
    GetClipBox(memory, &box);
    hookReport("clip box, no hook");
    wsprintf(probeResult, "%08lx", setHookFlags(memory, 0));
    probe("hook", "flags after none", probeResult);

    client = GetDC(window);
    got = NULL;
    answer = getDCHook(client, &got);
    wsprintf(probeResult, "data=%s proc=%s", (LPSTR)(answer ? "some" : "nought"),
             (LPSTR)(got == GetProcAddress(GetModuleHandle("USER"), "DCHOOK")
                         ? "USER's DCHOOK"
                         : got ? "other" : "nought"));
    probe("hook", "get, a window's", probeResult);
    wsprintf(probeResult, "%08lx", setHookFlags(client, 2));
    probe("hook", "a window's flags 2", probeResult);
    wsprintf(probeResult, "%08lx", setHookFlags(client, 2));
    probe("hook", "a window's flags 2 again", probeResult);
    ReleaseDC(window, client);

    /* cliprgn */
    other = CreateCompatibleDC(NULL);
    clipReport(other, "new memory context", NULL);
    region = CreateRectRgn(10, 10, 50, 40);
    SelectClipRgn(other, region);
    clipReport(other, "a region selected", region);
    OffsetClipRgn(other, 5, 5);
    clipReport(other, "offset", region);
    SelectClipRgn(other, NULL);
    clipReport(other, "none selected", region);
    IntersectClipRect(other, 2, 3, 20, 30);
    clipReport(other, "intersected", region);
    ExcludeClipRect(other, 2, 3, 10, 30);
    clipReport(other, "excluded", region);
    DeleteObject(region);
    DeleteDC(other);
    client = GetDC(window);
    clipReport(client, "a window's", NULL);
    IntersectClipRect(client, 5, 5, 60, 50);
    clipReport(client, "a window's intersected", NULL);
    ReleaseDC(window, client);

    /* reset */
    other = CreateCompatibleDC(NULL);
    wsprintf(probeResult, "%s", same((WORD)resetDC(other, NULL), (WORD)other, 0xffff));
    probe("reset", "memory context", probeResult);
    DeleteDC(other);
    client = GetDC(window);
    wsprintf(probeResult, "%s", same((WORD)resetDC(client, NULL), (WORD)client, 0xffff));
    probe("reset", "a window's", probeResult);
    ReleaseDC(window, client);
    screen = CreateDC("DISPLAY", NULL, NULL, NULL);
    wsprintf(probeResult, "%s", same((WORD)resetDC(screen, NULL), (WORD)screen, 0xffff));
    probe("reset", "the screen's", probeResult);
    DeleteDC(screen);

    /* palette */
    logical = (LOGPALETTE *)paletteBytes;
    logical->palVersion = 0x300;
    logical->palNumEntries = 4;

    for (i = 0; i < 4; i++) {
        logical->palPalEntry[i].peRed = (BYTE)(40 + i * 50);
        logical->palPalEntry[i].peGreen = (BYTE)(200 - i * 30);
        logical->palPalEntry[i].peBlue = (BYTE)(10 + i * 7);
        logical->palPalEntry[i].peFlags = 0;
    }

    palette = CreatePalette(logical);
    other = CreateCompatibleDC(NULL);

    wsprintf(probeResult, "%04x", LOWORD(isDCCurrentPalette(memory)));
    probe("palette", "current, new memory context", probeResult);
    before = SelectPalette(memory, palette, FALSE);
    wsprintf(probeResult, "%s", same((WORD)before, (WORD)palette, (WORD)GetStockObject(DEFAULT_PALETTE)));
    probe("palette", "USER's select", probeResult);
    wsprintf(probeResult, "%04x", LOWORD(isDCCurrentPalette(memory)));
    probe("palette", "current after USER's", probeResult);
    answer = gdiSelectPalette(memory, palette, 0);
    wsprintf(probeResult, "%s", same(LOWORD(answer), (WORD)palette, (WORD)GetStockObject(DEFAULT_PALETTE)));
    probe("palette", "GDI's select, foreground", probeResult);
    wsprintf(probeResult, "%04x", LOWORD(isDCCurrentPalette(memory)));
    probe("palette", "current after GDI's", probeResult);
    wsprintf(probeResult, "%04x", LOWORD(isDCCurrentPalette(other)));
    probe("palette", "current, another context", probeResult);
    wsprintf(probeResult, "%08lx", gdiRealizePalette(memory));
    probe("palette", "GDI's realize", probeResult);
    wsprintf(probeResult, "%08lx", gdiRealizePalette(memory));
    probe("palette", "GDI's realize again", probeResult);
    answer = gdiSelectPalette(other, palette, 1);
    wsprintf(probeResult, "%s", same(LOWORD(answer), (WORD)palette, (WORD)GetStockObject(DEFAULT_PALETTE)));
    probe("palette", "GDI's select, background", probeResult);
    wsprintf(probeResult, "%04x", LOWORD(isDCCurrentPalette(other)));
    probe("palette", "current, background", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(realizeDefaultPalette(memory) ? "some" : "nought"));
    probe("palette", "realize default", probeResult);
    wsprintf(probeResult, "%04x", LOWORD(isDCCurrentPalette(memory)));
    probe("palette", "current after default", probeResult);

    client = GetDC(window);
    before = SelectPalette(client, palette, FALSE);
    wsprintf(probeResult, "%04x", LOWORD(isDCCurrentPalette(client)));
    probe("palette", "current, a window's", probeResult);
    wsprintf(probeResult, "%u", RealizePalette(client));
    probe("palette", "USER's realize, a window's", probeResult);
    wsprintf(probeResult, "%08lx", gdiRealizePalette(client));
    probe("palette", "GDI's realize, a window's", probeResult);
    wsprintf(probeResult, "%d", UpdateColors(client));
    probe("palette", "update colours, a window's", probeResult);
    SelectPalette(client, before, TRUE);
    ReleaseDC(window, client);

    SelectPalette(memory, GetStockObject(DEFAULT_PALETTE), TRUE);
    SelectPalette(other, GetStockObject(DEFAULT_PALETTE), TRUE);
    DeleteDC(other);
    DeleteObject(palette);

    DeleteDC(memory);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
