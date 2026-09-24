/*
 * What the TrueType engine itself hands back for a smeared glyph, turned and
 * upright.
 *
 * Upright, the smear is the display driver's: GDI asks it for double weight
 * and adds a pixel to every width, and `VGA.DRV`'s bold compositor ORs each
 * glyph in twice. Turned, GDI draws each glyph itself (`GDI.EXE` seg8 `024b`)
 * as the engine made it, at running totals of the same widths -- one bold
 * pixel -- and yet the recordings put a turned smeared glyph two pixels on
 * and smear it a column right on the device. Both of those would have to be
 * in the engine's glyph. `GetGlyphOutline` asks the engine directly: its box,
 * its origin, its advance and its bitmap, at a plain weight and a smeared one,
 * upright and turned.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SMEARGLF.OUT"

static HDC memory;
static HBITMAP canvas;
static unsigned char buffer[1024];

static const char HEX[] = "0123456789abcdef";

static void probeGlyph(LPCSTR face, int height, int weight, int escapement, char character)
{
    HFONT font;
    HFONT previous;
    GLYPHMETRICS metrics;
    MAT2 identity;
    DWORD size;
    LPSTR at;
    DWORD index;

    wsprintf(probeArgs, "\"%s\",h=%d,weight=%d,esc=%d,'%c'",
             (LPSTR)face, height, weight, escapement, character);

    font = CreateFont(height, 0, escapement, escapement, weight, 0, 0, 0,
                      lstrcmp(face, "Symbol") == 0 ? SYMBOL_CHARSET : ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("glyph outline", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    _fmemset(&identity, 0, sizeof(identity));
    identity.eM11.value = 1;
    identity.eM22.value = 1;

    size = GetGlyphOutline(memory, (UINT)(unsigned char)character, GGO_BITMAP,
                           &metrics, (DWORD)sizeof(buffer), buffer, &identity);

    if (size == (DWORD)-1) {
        wsprintf(probeResult, "failed");
    } else {
        wsprintf(probeResult, "box=%u:%u,origin=%d:%d,inc=%d:%d,size=%lu,bits=",
                 metrics.gmBlackBoxX, metrics.gmBlackBoxY,
                 metrics.gmptGlyphOrigin.x, metrics.gmptGlyphOrigin.y,
                 metrics.gmCellIncX, metrics.gmCellIncY, size);
        at = probeResult + lstrlen(probeResult);

        for (index = 0; index < size && index < sizeof(buffer); index++) {
            *at++ = HEX[(buffer[index] >> 4) & 0x0f];
            *at++ = HEX[buffer[index] & 0x0f];

            if (at - probeResult > 1990) {
                *at++ = '!';
                break;
            }
        }

        *at = '\0';
    }

    probe("glyph outline", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int ANGLES[] = { 0, 300, 900 };
    static const char CHARACTERS[] = "Al";
    HDC screen;
    int size;
    int angle;
    int character;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(8, 8, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "8x8x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("the engine's own metrics and bitmap for a plain and a smeared glyph");

    for (size = 16; size <= 24; size += 8) {
        for (angle = 0; angle < 3; angle++) {
            for (character = 0; CHARACTERS[character]; character++) {
                probeGlyph("Arial", size, 400, ANGLES[angle], CHARACTERS[character]);
                probeGlyph("Arial", size, 600, ANGLES[angle], CHARACTERS[character]);
                probeGlyph("Times New Roman", size, 400, ANGLES[angle], CHARACTERS[character]);
                probeGlyph("Times New Roman", size, 600, ANGLES[angle], CHARACTERS[character]);
                probeGlyph("Courier New", size, 400, ANGLES[angle], CHARACTERS[character]);
                probeGlyph("Courier New", size, 600, ANGLES[angle], CHARACTERS[character]);
                probeGlyph("Symbol", size, 400, ANGLES[angle], CHARACTERS[character]);
                probeGlyph("Symbol", size, 700, ANGLES[angle], CHARACTERS[character]);
            }
        }
    }

    DeleteObject(canvas);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
