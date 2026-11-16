/*
 * Device-independent bitmaps of 16 and 32 bits a pixel, which Windows 3.1
 * does not describe (its DIBs are of 1, 4, 8 and 24 bits), given to
 * `CreateDIBitmap` with `CBM_INIT`, to `SetDIBits` and to
 * `SetDIBitsToDevice`; 24 bits beside them. A Visual Basic program of the
 * catalog (Friday) loads a picture of 16 bits a pixel and says "Out of
 * memory" where `CreateDIBitmap` answers nought.
 *
 * * `create`: `CreateDIBitmap`'s answer, `0` or `bitmap`, by bits a pixel.
 * * `uninit`: the same without `CBM_INIT`.
 * * `setbits`: `SetDIBits`' answer into a bitmap of the screen's, the
 *   lines it set.
 * * `todevice`: `SetDIBitsToDevice`'s answer onto the screen's context.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DIB16.OUT"

#define SIDE 4

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[4];
} info;

static BYTE bits[SIDE * SIDE * 4];

static void describe(int bitCount)
{
    _fmemset(&info, 0, sizeof(info));
    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = SIDE;
    info.header.biHeight = SIDE;
    info.header.biPlanes = 1;
    info.header.biBitCount = bitCount;
    info.header.biCompression = BI_RGB;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int depths[] = { 16, 32, 24 };
    char what[8];
    HDC screen;
    HBITMAP made;
    HBITMAP target;
    int at;

    probeOpen(OUTPUT);
    _fmemset(bits, 0x5a, sizeof(bits));
    screen = GetDC(NULL);
    target = CreateCompatibleBitmap(screen, SIDE, SIDE);

    for (at = 0; at < 3; at++) {
        wsprintf(what, "%d", depths[at]);

        describe(depths[at]);
        made = CreateDIBitmap(screen, &info.header, CBM_INIT, bits, (BITMAPINFO FAR *)&info, DIB_RGB_COLORS);
        probe("create", what, made ? "bitmap" : "0");
        if (made) {
            DeleteObject(made);
        }

        describe(depths[at]);
        made = CreateDIBitmap(screen, &info.header, 0L, NULL, NULL, DIB_RGB_COLORS);
        probe("uninit", what, made ? "bitmap" : "0");
        if (made) {
            DeleteObject(made);
        }

        describe(depths[at]);
        wsprintf(probeResult, "%d", SetDIBits(screen, target, 0, SIDE, bits, (BITMAPINFO FAR *)&info, DIB_RGB_COLORS));
        probe("setbits", what, probeResult);

        describe(depths[at]);
        wsprintf(probeResult, "%d", SetDIBitsToDevice(screen, 0, 0, SIDE, SIDE, 0, 0, 0, SIDE, bits, (BITMAPINFO FAR *)&info, DIB_RGB_COLORS));
        probe("todevice", what, probeResult);
    }

    DeleteObject(target);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
