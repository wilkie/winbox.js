/*
 * The Tutorial's fonts as it asks for them: a `LOGFONT` of nought but a
 * height and a face, `Times New Roman` at -33 and -28, and `Helv` at -13 and
 * -12. Each is selected into the screen and read back.
 *
 * * `metrics`: `GetTextMetrics`' height, ascent, descent, internal and
 *   external leading, average and maximum width, weight, pitch and family,
 *   and character set.
 * * `face`: `GetTextFace`.
 * * `extent`: `GetTextExtent` of each word of the Tutorial's welcome, and of
 *   the phrases a line could hold.
 * * `wrap`: `DrawText` with `DT_CALCRECT | DT_WORDBREAK` in the Tutorial's
 *   rectangle, {30,50,250,480}.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TNRWRAP.OUT"

static const char *const texts[] = { "Welcome",
                                     "to",
                                     "the",
                                     "Microsoft",
                                     "Windows",
                                     "Tutorial.",
                                     " ",
                                     "Welcome to the",
                                     "Welcome to the Microsoft",
                                     "Microsoft Windows",
                                     "Windows Tutorial.",
                                     "Welcome to the Microsoft Windows Tutorial." };

static void font(HDC screen, int height, LPCSTR face)
{
    LOGFONT request;
    TEXTMETRIC metrics;
    HFONT created;
    HFONT old;
    RECT area;
    char name[40];
    char what[48];
    int answer;
    int i;

    _fmemset(&request, 0, sizeof(request));
    request.lfHeight = height;
    lstrcpy(request.lfFaceName, face);
    created = CreateFontIndirect(&request);
    old = SelectObject(screen, created);

    wsprintf(what, "%s %d", face, height);

    GetTextMetrics(screen, &metrics);
    wsprintf(probeResult, "%d,%d,%d,%d,%d,%d,%d,%d,%d,%d", metrics.tmHeight, metrics.tmAscent,
             metrics.tmDescent, metrics.tmInternalLeading, metrics.tmExternalLeading,
             metrics.tmAveCharWidth, metrics.tmMaxCharWidth, metrics.tmWeight,
             metrics.tmPitchAndFamily, metrics.tmCharSet);
    probe("metrics", what, probeResult);

    GetTextFace(screen, sizeof(name), name);
    probe("face", what, name);

    for (i = 0; i < sizeof(texts) / sizeof(texts[0]); i++) {
        wsprintf(probeArgs, "%s: %s", (LPSTR)what, (LPSTR)texts[i]);
        wsprintf(probeResult, "%d", LOWORD(GetTextExtent(screen, texts[i], lstrlen(texts[i]))));
        probe("extent", probeArgs, probeResult);
    }

    SetRect(&area, 30, 50, 250, 480);
    answer = DrawText(screen, texts[11], -1, &area, DT_CALCRECT | DT_WORDBREAK);
    wsprintf(probeResult, "%d {%d,%d,%d,%d}", answer, area.left, area.top, area.right,
             area.bottom);
    probe("wrap", what, probeResult);

    SelectObject(screen, old);
    DeleteObject(created);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    font(screen, -33, "Times New Roman");
    font(screen, -28, "Times New Roman");
    font(screen, -13, "Helv");
    font(screen, -12, "Helv");
    ReleaseDC(NULL, screen);

    probeFinish();
    return 0;
}
