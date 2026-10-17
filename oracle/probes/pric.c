/*
 * An information context of a Windows printer driver: what GDI answers of
 * the PostScript driver, `pscript`, for the Apple LaserWriter Plus, as a
 * program asks before it prints. Recorded on the installation with a
 * printer, `vgaprint`; the run puts the driver on the drive.
 *
 * * `ic`: whether `CreateIC` of the driver, the device and a port gave an
 *   information context; `CreateIC` of the same again, and of another
 *   port.
 * * `caps`: `GetDeviceCaps` at every index from nought to 70h, odd ones
 *   too, and a few past it.
 * * `queryesc`: `Escape(QUERYESCSUPPORT)` of every escape from nought to
 *   FFh, and some past it, where the driver answers other than nought.
 * * `escape`: the escapes that only ask: `GETPHYSPAGESIZE`,
 *   `GETPRINTINGOFFSET`, `GETSCALINGFACTOR`, `GETTECHNOLOGY` and
 *   `GETSETPRINTORIENT` with no input; an escape the driver has not got;
 *   `SETABORTPROC`'s answer, as GDI keeps it, as its sign and its segment.
 * * `metrics`, `face`: `GetTextMetrics` and `GetTextFace` of the IC as it
 *   starts, and with fonts selected.
 * * `font`, `fontname`: `EnumFonts` of every face, and of a few by name.
 * * `delete`: what `DeleteDC` answers for each.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRIC.OUT"
#define DRIVER "pscript"
#define DEVICE "Apple LaserWriter Plus"

static int calls;
static char current[LF_FACESIZE];
static BOOL byName;

int FAR PASCAL _export FontProc(const LOGFONT FAR *lf, const TEXTMETRIC FAR *metric, int type,
                                LPARAM data)
{
    calls++;
    wsprintf(probeResult,
             "type=%d,lf=%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%s,"
             "tm=%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d",
             type, lf->lfHeight, lf->lfWidth, lf->lfEscapement, lf->lfOrientation, lf->lfWeight,
             lf->lfItalic, lf->lfUnderline, lf->lfStrikeOut, lf->lfCharSet, lf->lfOutPrecision,
             lf->lfClipPrecision, lf->lfQuality, lf->lfPitchAndFamily, (LPCSTR)lf->lfFaceName,
             metric->tmHeight, metric->tmAscent, metric->tmDescent, metric->tmInternalLeading,
             metric->tmExternalLeading, metric->tmAveCharWidth, metric->tmMaxCharWidth,
             metric->tmWeight, metric->tmItalic, metric->tmUnderlined, metric->tmStruckOut,
             metric->tmFirstChar, metric->tmLastChar, metric->tmDefaultChar, metric->tmBreakChar,
             metric->tmPitchAndFamily, metric->tmCharSet, metric->tmOverhang,
             metric->tmDigitizedAspectX, metric->tmDigitizedAspectY);

    if (byName) {
        wsprintf(probeArgs, "%s,%d", (LPSTR)current, calls - 1);
        probe("fontname", probeArgs, probeResult);
    } else {
        wsprintf(probeArgs, "%d", calls - 1);
        probe("font", probeArgs, probeResult);
    }

    return (int)data;
}

BOOL FAR PASCAL _export Abort(HDC hdc, int code)
{
    (void)hdc;
    (void)code;
    return TRUE;
}

static void metrics(HDC hdc, LPCSTR step)
{
    TEXTMETRIC tm;
    char face[LF_FACESIZE + 1];
    BOOL got = GetTextMetrics(hdc, &tm);
    int length = GetTextFace(hdc, sizeof(face), face);

    wsprintf(probeResult,
             "%d,%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d", got, tm.tmHeight,
             tm.tmAscent, tm.tmDescent, tm.tmInternalLeading, tm.tmExternalLeading,
             tm.tmAveCharWidth, tm.tmMaxCharWidth, tm.tmWeight, tm.tmItalic, tm.tmUnderlined,
             tm.tmStruckOut, tm.tmFirstChar, tm.tmLastChar, tm.tmDefaultChar, tm.tmBreakChar,
             tm.tmPitchAndFamily, tm.tmCharSet, tm.tmOverhang, tm.tmDigitizedAspectX,
             tm.tmDigitizedAspectY);
    probe("metrics", step, probeResult);

    wsprintf(probeResult, "%d,%s", length, (LPSTR)face);
    probe("face", step, probeResult);
}

static void selected(HDC hdc, LPCSTR step, int height, int weight, BYTE pitch, LPCSTR face)
{
    HFONT font = CreateFont(height, 0, 0, 0, weight, 0, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                            CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, pitch, face);
    HFONT old = SelectObject(hdc, font);

    metrics(hdc, step);
    SelectObject(hdc, old);
    DeleteObject(font);
}

static void point(LPCSTR name, int answer, POINT FAR *at)
{
    wsprintf(probeResult, "%d,%d,%d", answer, at->x, at->y);
    probe("escape", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int odd[] = {1, 3, 0x59, 0x5b, 0x6b, 0x6d, 0x6e, 0x6f, 0x70, 0x72, 0x7e, 0x80, -2};
    static const int beyond[] = {0x100, 0x101, 0x102, 0x200, 0x201, 0x7ff, 0x800,
                                 0xbff, 0xc00, 0x1000, 0x1001, 0x1002, 0x1003, 0x1004,
                                 0x1005, 0x1006, 0x1007, 0x1008, 0x1009, 0x100a, 0x100b,
                                 0x100c, 0x100d, 0x100e, 0x100f, 0x1010, 0x1011, 0x1012,
                                 0x1013, 0x1014, 0x7fff, -1};
    static const char *named[] = {"Courier", "Helvetica", "Times", "Symbol", "Arial", "System"};
    HDC ic;
    HDC again;
    HDC other;
    POINT at;
    char text[80];
    int index;
    int answer;
    int asked;
    FARPROC font;
    FARPROC abortProc;

    probeOpen(OUTPUT);

    ic = CreateIC(DRIVER, DEVICE, "LPT1:", NULL);
    probe("ic", "made", ic ? "1" : "0");

    if (!ic) {
        probeFinish();
        return 0;
    }

    again = CreateIC(DRIVER, DEVICE, "LPT1:", NULL);
    probe("ic", "again", again ? "1" : "0");
    other = CreateIC(DRIVER, DEVICE, "LPT2:", NULL);
    probe("ic", "other port", other ? "1" : "0");

    for (index = 0; index <= 0x6c; index += 2) {
        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "%d", GetDeviceCaps(ic, index));
        probe("caps", probeArgs, probeResult);
    }

    for (index = 0; odd[index] != -2; index++) {
        wsprintf(probeArgs, "%d", odd[index]);
        wsprintf(probeResult, "%d", GetDeviceCaps(ic, odd[index]));
        probe("caps", probeArgs, probeResult);
    }

    wsprintf(probeResult, "%d", GetDeviceCaps(ic, -2));
    probe("caps", "-2", probeResult);

    for (index = 0; index <= 0x100; index++) {
        asked = index;
        answer = Escape(ic, QUERYESCSUPPORT, sizeof(int), (LPCSTR)&asked, NULL);

        if (answer) {
            wsprintf(probeArgs, "%d", index);
            wsprintf(probeResult, "%d", answer);
            probe("queryesc", probeArgs, probeResult);
        }
    }

    for (index = 0; beyond[index] != -1; index++) {
        asked = beyond[index];
        answer = Escape(ic, QUERYESCSUPPORT, sizeof(int), (LPCSTR)&asked, NULL);
        wsprintf(probeArgs, "%d", asked);
        wsprintf(probeResult, "%d", answer);
        probe("queryesc", probeArgs, probeResult);
    }

    at.x = at.y = -1;
    point("GETPHYSPAGESIZE", Escape(ic, GETPHYSPAGESIZE, 0, NULL, &at), &at);
    at.x = at.y = -1;
    point("GETPRINTINGOFFSET", Escape(ic, GETPRINTINGOFFSET, 0, NULL, &at), &at);
    at.x = at.y = -1;
    point("GETSCALINGFACTOR", Escape(ic, GETSCALINGFACTOR, 0, NULL, &at), &at);

    lstrcpy(text, "untouched");
    answer = Escape(ic, GETTECHNOLOGY, 0, NULL, text);
    wsprintf(probeResult, "%d,%s", answer, (LPSTR)text);
    probe("escape", "GETTECHNOLOGY", probeResult);

    wsprintf(probeResult, "%d", Escape(ic, GETSETPRINTORIENT, 0, NULL, NULL));
    probe("escape", "GETSETPRINTORIENT", probeResult);

    wsprintf(probeResult, "%d", Escape(ic, 0x7777, 0, NULL, NULL));
    probe("escape", "not there", probeResult);

    abortProc = MakeProcInstance((FARPROC)Abort, instance);
    answer = Escape(ic, SETABORTPROC, 0, (LPCSTR)abortProc, NULL);
    wsprintf(probeResult, "%s,%s", (LPSTR)(answer > 0 ? "+" : answer ? "-" : "0"),
             (LPSTR)((UINT)answer == SELECTOROF(abortProc) ? "segment" : "other"));
    probe("escape", "SETABORTPROC", probeResult);

    metrics(ic, "start");
    selected(ic, "courier 12pt", -50, FW_NORMAL, FIXED_PITCH | FF_MODERN, "Courier");
    selected(ic, "helvetica bold 50", 50, FW_BOLD, VARIABLE_PITCH | FF_SWISS, "Helvetica");
    selected(ic, "times 100", -100, FW_NORMAL, VARIABLE_PITCH | FF_ROMAN, "Times");
    selected(ic, "arial 40", -40, FW_NORMAL, VARIABLE_PITCH | FF_SWISS, "Arial");
    selected(ic, "nameless swiss", -40, FW_NORMAL, VARIABLE_PITCH | FF_SWISS, "");

    font = MakeProcInstance((FARPROC)FontProc, instance);
    calls = 0;
    byName = FALSE;
    answer = EnumFonts(ic, NULL, (OLDFONTENUMPROC)font, (LPARAM)1L);
    wsprintf(probeResult, "%d,%d", answer, calls);
    probe("fonts", "all", probeResult);

    byName = TRUE;

    for (index = 0; index < 6; index++) {
        calls = 0;
        lstrcpy(current, named[index]);
        answer = EnumFonts(ic, named[index], (OLDFONTENUMPROC)font, (LPARAM)1L);
        wsprintf(probeResult, "%d,%d", answer, calls);
        probe("fonts", named[index], probeResult);
    }

    FreeProcInstance(font);

    wsprintf(probeResult, "%d", DeleteDC(other));
    probe("delete", "other port", probeResult);
    wsprintf(probeResult, "%d", DeleteDC(again));
    probe("delete", "again", probeResult);
    wsprintf(probeResult, "%d", DeleteDC(ic));
    probe("delete", "made", probeResult);
    wsprintf(probeResult, "%d", DeleteDC(ic));
    probe("delete", "made, twice", probeResult);

    FreeProcInstance(abortProc);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
