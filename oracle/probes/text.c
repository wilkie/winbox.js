/*
 * GDI text metrics.
 *
 * Every layout decision a Windows program makes runs through these. A dialog
 * sizes its controls from `tmHeight` and `tmAveCharWidth`; a list box decides
 * how many items fit from the same; anything that draws a string and then
 * draws something after it asks `GetTextExtent` where the string ended. Get
 * these wrong by a pixel and nothing crashes -- the whole interface is simply
 * laid out slightly wrong, in a way that is very hard to trace back to its
 * cause.
 *
 * The measurements only mean something if the font is pinned, so every one of
 * them selects a stock font first. Stock fonts come from the installation
 * rather than from the program, so they are the same on both sides of the
 * comparison as long as both sides are looking at the same Windows -- which is
 * what the fixture's provenance records.
 *
 * The device context matters too, since metrics are in device units. This
 * takes the screen DC and records what it says about itself, so a disagreement
 * about resolution shows up as a disagreement about resolution rather than as
 * a hundred disagreements about text.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TEXT.OUT"

static HDC dc;

/* Records what the device context says about itself. */
static void probeDeviceCaps(void)
{
    static const struct {
        int index;
        LPCSTR name;
    } CAPS[] = {
        { HORZRES,    "HORZRES"    },
        { VERTRES,    "VERTRES"    },
        { BITSPIXEL,  "BITSPIXEL"  },
        { PLANES,     "PLANES"     },
        { LOGPIXELSX, "LOGPIXELSX" },
        { LOGPIXELSY, "LOGPIXELSY" },
        { ASPECTX,    "ASPECTX"    },
        { ASPECTY,    "ASPECTY"    },
        { NUMFONTS,   "NUMFONTS"   },
        { NUMCOLORS,  "NUMCOLORS"  },
    };

    int index;

    for (index = 0; index < sizeof(CAPS) / sizeof(CAPS[0]); index++) {
        wsprintf(probeResult, "%d", GetDeviceCaps(dc, CAPS[index].index));
        probe("GetDeviceCaps", CAPS[index].name, probeResult);
    }
}

/* Records the metrics of one stock font, in several pieces. */
static void probeMetrics(int stock, LPCSTR name)
{
    HFONT font = (HFONT)GetStockObject(stock);
    HFONT previous;
    TEXTMETRIC tm;
    char face[64];

    if (font == NULL) {
        probe("GetTextMetrics", name, "no such stock font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);
    GetTextMetrics(dc, &tm);

    /* Split across several records so that a font which is the right size but
     * the wrong shape says so, rather than failing as one opaque line.
     */
    wsprintf(probeResult,
             "height=%d,ascent=%d,descent=%d,internal=%d,external=%d",
             tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmExternalLeading);
    probe("metrics heights", name, probeResult);

    wsprintf(probeResult,
             "ave=%d,max=%d,weight=%d,overhang=%d",
             tm.tmAveCharWidth, tm.tmMaxCharWidth, tm.tmWeight, tm.tmOverhang);
    probe("metrics widths", name, probeResult);

    wsprintf(probeResult,
             "first=%d,last=%d,default=%d,break=%d,pitch=%d,charset=%d",
             tm.tmFirstChar, tm.tmLastChar, tm.tmDefaultChar,
             tm.tmBreakChar, tm.tmPitchAndFamily, tm.tmCharSet);
    probe("metrics character set", name, probeResult);

    wsprintf(probeResult,
             "italic=%d,underlined=%d,struckout=%d",
             tm.tmItalic, tm.tmUnderlined, tm.tmStruckOut);
    probe("metrics style", name, probeResult);

    GetTextFace(dc, sizeof(face), face);
    wsprintf(probeResult, "\"%s\"", (LPSTR)face);
    probe("GetTextFace", name, probeResult);

    SelectObject(dc, previous);
}

/* Records how wide a string is in a given font. */
static void probeExtent(int stock, LPCSTR fontName, LPCSTR text)
{
    HFONT font = (HFONT)GetStockObject(stock);
    HFONT previous;
    DWORD extent;

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(dc, font);
    extent = GetTextExtent(dc, text, lstrlen(text));

    wsprintf(probeArgs, "%s,\"%s\"", (LPSTR)fontName, (LPSTR)text);
    wsprintf(probeResult, "width=%d,height=%d", LOWORD(extent), HIWORD(extent));
    probe("GetTextExtent", probeArgs, probeResult);

    SelectObject(dc, previous);
}

/*
 * Records the width of individual characters.
 *
 * A proportional font's whole point is that these differ, and a string's
 * extent is not simply its length times the average -- which is the assumption
 * an implementation makes when it has never looked.
 */
static void probeCharWidths(int stock, LPCSTR fontName, UINT first, UINT last)
{
    HFONT font = (HFONT)GetStockObject(stock);
    HFONT previous;
    int widths[8];
    int index;
    int at;

    if (font == NULL || last - first >= 8) {
        return;
    }

    previous = (HFONT)SelectObject(dc, font);

    if (GetCharWidth(dc, first, last, widths)) {
        at = wsprintf(probeResult, "%d", widths[0]);

        for (index = 1; index <= (int)(last - first); index++) {
            at += wsprintf(probeResult + at, ",%d", widths[index]);
        }
    } else {
        lstrcpy(probeResult, "failed");
    }

    wsprintf(probeArgs, "%s,%u-%u", (LPSTR)fontName, first, last);
    probe("GetCharWidth", probeArgs, probeResult);

    SelectObject(dc, previous);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    if (dc == NULL) {
        probe("GetDC", "NULL", "failed");
        probeFinish();
        return 0;
    }

    probeNote("what the screen says about itself");
    probeDeviceCaps();

    probeNote("the stock fonts");
    probeMetrics(SYSTEM_FONT, "SYSTEM_FONT");
    probeMetrics(SYSTEM_FIXED_FONT, "SYSTEM_FIXED_FONT");
    probeMetrics(ANSI_VAR_FONT, "ANSI_VAR_FONT");
    probeMetrics(ANSI_FIXED_FONT, "ANSI_FIXED_FONT");
    probeMetrics(OEM_FIXED_FONT, "OEM_FIXED_FONT");
    probeMetrics(DEVICE_DEFAULT_FONT, "DEVICE_DEFAULT_FONT");

    probeNote("how wide a string is");
    probeExtent(SYSTEM_FONT, "SYSTEM_FONT", "");
    probeExtent(SYSTEM_FONT, "SYSTEM_FONT", "i");
    probeExtent(SYSTEM_FONT, "SYSTEM_FONT", "W");
    probeExtent(SYSTEM_FONT, "SYSTEM_FONT", "iiii");
    probeExtent(SYSTEM_FONT, "SYSTEM_FONT", "WWWW");
    probeExtent(SYSTEM_FONT, "SYSTEM_FONT", "Hello, world");
    probeExtent(SYSTEM_FONT, "SYSTEM_FONT", "The quick brown fox");
    probeExtent(SYSTEM_FONT, "SYSTEM_FONT", "    ");
    probeExtent(ANSI_VAR_FONT, "ANSI_VAR_FONT", "Hello, world");
    probeExtent(ANSI_FIXED_FONT, "ANSI_FIXED_FONT", "Hello, world");
    probeExtent(SYSTEM_FIXED_FONT, "SYSTEM_FIXED_FONT", "Hello, world");

    /* A fixed font should answer the same width for every character and a
     * proportional one should not, which is the cheapest way to tell whether
     * anything is really consulting the font at all.
     */
    probeNote("and how wide its characters are");
    probeCharWidths(SYSTEM_FONT, "SYSTEM_FONT", 'A', 'D');
    probeCharWidths(SYSTEM_FONT, "SYSTEM_FONT", 'i', 'l');
    probeCharWidths(ANSI_FIXED_FONT, "ANSI_FIXED_FONT", 'i', 'l');
    probeCharWidths(SYSTEM_FONT, "SYSTEM_FONT", ' ', '#');

    ReleaseDC(NULL, dc);

    probeFinish();
    return 0;
}
