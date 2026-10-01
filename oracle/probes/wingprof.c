/*
 * What WinG recommends drawing into, and what it keeps of its first run.
 *
 * The first time a program asks WinG for its recommended DIB format, WinG
 * times the display -- a box says so, "testing for optimal display
 * performance", for minutes -- and keeps what it found in `WIN.INI`.
 * `install-wing.mjs` runs this once, on the 256-colour installation, so that
 * a program using WinG starts as it would on a machine that had run one
 * before.
 *
 * WING.DLL is loaded by name and its functions found by ordinal, as no
 * import library for it is part of the toolchain.
 *
 * * `recommended`: `WinGRecommendedDIBFormat`'s answer, and the
 *   `BITMAPINFOHEADER` it fills: size, width, height, planes, bits a pixel,
 *   compression.
 * * `profile`: each entry of `WIN.INI`'s `[WinG]` after it, as `name=value`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINGPROF.OUT"

typedef BOOL(FAR PASCAL *RECOMMENDED)(BITMAPINFO FAR *);

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static struct {
        BITMAPINFOHEADER header;
        RGBQUAD colours[256];
    } info;
    static char names[512];
    static char value[128];
    HINSTANCE wing;
    RECOMMENDED recommended;
    BOOL answer;
    LPSTR name;

    probeOpen(OUTPUT);

    wing = LoadLibrary("WING.DLL");

    if (wing < HINSTANCE_ERROR) {
        wsprintf(probeResult, "%d", (int)wing);
        probe("load", "WING.DLL", probeResult);
        probeFinish();
        return 0;
    }

    recommended = (RECOMMENDED)GetProcAddress(wing, MAKEINTRESOURCE(1002));
    _fmemset(&info, 0, sizeof(info));
    answer = recommended((BITMAPINFO FAR *)&info);

    wsprintf(probeResult, "%d:%ld,%ld,%ld,%d,%d,%ld", answer, info.header.biSize,
             info.header.biWidth, info.header.biHeight, info.header.biPlanes,
             info.header.biBitCount, info.header.biCompression);
    probe("recommended", "WinGRecommendedDIBFormat", probeResult);

    GetProfileString("WinG", NULL, "", names, sizeof(names));

    for (name = names; *name; name += lstrlen(name) + 1) {
        GetProfileString("WinG", name, "", value, sizeof(value));
        wsprintf(probeResult, "%s=%s", name, (LPSTR)value);
        probe("profile", "WinG", probeResult);
    }

    FreeLibrary(wing);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
