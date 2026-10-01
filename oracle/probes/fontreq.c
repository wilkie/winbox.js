/*
 * What font a request with no face name is given, as BogOut asks for the
 * font of its timer: `lfHeight` 48, `FF_SWISS | FIXED_PITCH`, nothing else.
 *
 * * `face`: `GetTextFace` of the font selected into the screen's device
 *   context, for each request.
 * * `metrics`: its `TEXTMETRIC`: height, ascent, descent, internal and
 *   external leading, average and maximum widths, weight, pitch and family,
 *   and character set.
 *
 * The requests: BogOut's; the same 16 high; `FF_ROMAN | FIXED_PITCH` 48;
 * `FF_MODERN | FIXED_PITCH` 48; and `FF_SWISS | VARIABLE_PITCH` 48.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FONTREQ.OUT"

static void ask(LPCSTR name, int height, BYTE pitchAndFamily)
{
    static LOGFONT asked;
    HDC screen = GetDC(NULL);
    HFONT font;
    HFONT before;
    TEXTMETRIC tm;
    char face[40];

    _fmemset(&asked, 0, sizeof(asked));
    asked.lfHeight = height;
    asked.lfPitchAndFamily = pitchAndFamily;
    font = CreateFontIndirect(&asked);
    before = SelectObject(screen, font);

    GetTextFace(screen, sizeof(face), face);
    probe("face", name, face);

    GetTextMetrics(screen, &tm);
    wsprintf(probeResult, "%d,%d,%d,%d,%d,%d,%d,%d,%x,%d", tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmExternalLeading, tm.tmAveCharWidth, tm.tmMaxCharWidth,
             tm.tmWeight, tm.tmPitchAndFamily, tm.tmCharSet);
    probe("metrics", name, probeResult);

    SelectObject(screen, before);
    DeleteObject(font);
    ReleaseDC(NULL, screen);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    ask("swiss fixed 48", 48, FF_SWISS | FIXED_PITCH);
    ask("swiss fixed 16", 16, FF_SWISS | FIXED_PITCH);
    ask("roman fixed 48", 48, FF_ROMAN | FIXED_PITCH);
    ask("modern fixed 48", 48, FF_MODERN | FIXED_PITCH);
    ask("swiss variable 48", 48, FF_SWISS | VARIABLE_PITCH);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
