/*
 * fontver -- AddFontResource of a raster file whose FONTDIR says a version
 * other than 2.0.
 *
 * GDI takes an entry whose `dfVersion` is 200h or 100h, or any other no
 * greater than its limit, and fails the whole add for one that is
 * (`GDI.EXE` seg2 `0d9d`). The limit is 200h, or 300h where the display's
 * `RASTERCAPS` has `RC_BIGFONT`, set as the first DC is made (seg1 `047a`).
 *
 * The probe copies `DOSAPP.FON`, six Terminal fonts that no installation
 * of the oracle's has in `WIN.INI`, and writes another version into its
 * FONTDIR's first entry alone; the fonts themselves are left as they are.
 *
 * * `add`, `remove`: the version and the answer.
 * * `faces`: how many fonts `EnumFonts` hands out for Terminal, and their
 *   heights, with the copy added.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FONTVER.OUT"

static HDC screen;
static FARPROC faceProc;
static LPSTR out;
static int count;
static BYTE __huge *file;
static long size;

int FAR PASCAL _export FaceProc(const LOGFONT FAR *font, const TEXTMETRIC FAR *metric, int type,
                                LPARAM data)
{
    count++;
    out += wsprintf(out, " %d", metric->tmHeight);
    (void)font;
    (void)type;
    (void)data;
    return 1;
}

static void faces(LPCSTR when)
{
    char heights[400];

    count = 0;
    out = heights;
    *out = '\0';
    EnumFonts(screen, "Terminal", (FONTENUMPROC)faceProc, 0L);
    wsprintf(probeResult, "%d:%s", count, (LPSTR)heights);
    probe("faces", when, probeResult);
}

static WORD wordAt(long at)
{
    return (WORD)(file[at] | (file[at + 1] << 8));
}

/* The FONTDIR's first entry's dfVersion, where it is in the file. */
static long versionAt(void)
{
    long ne = (long)wordAt(0x3c);
    long table = ne + (long)wordAt(ne + 0x24);
    int shift = (int)wordAt(table);
    long at = table + 2;

    if (size < 0x40) {
        return -1;
    }

    while (wordAt(at)) {
        WORD kind = wordAt(at);
        long entries = (long)wordAt(at + 2);

        if (kind == 0x8007) {
            /* The resource's place, then past the count and the ordinal. */
            return ((long)wordAt(at + 8) << shift) + 4;
        }

        at += 8 + entries * 12;
    }

    return -1;
}

static void tryVersion(WORD version)
{
    char path[64];
    char name[16];
    HFILE out;
    long at = versionAt();
    int answer;

    wsprintf(path, "C:\\ORACLE\\V%X.FON", version);
    wsprintf(name, "%x", version);

    file[at] = (BYTE)version;
    file[at + 1] = (BYTE)(version >> 8);
    out = _lcreat(path, 0);
    _hwrite(out, (const void __huge *)file, size);
    _lclose(out);

    answer = AddFontResource(path);
    wsprintf(probeResult, "%d", answer);
    probe("add", name, probeResult);
    faces(name);
    answer = RemoveFontResource(path);
    wsprintf(probeResult, "%d", answer);
    probe("remove", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HFILE in;
    HGLOBAL block;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    faceProc = MakeProcInstance((FARPROC)FaceProc, instance);

    block = GlobalAlloc(GMEM_MOVEABLE, 40000L);
    file = (BYTE __huge *)GlobalLock(block);
    in = _lopen("C:\\WINDOWS\\SYSTEM\\DOSAPP.FON", OF_READ);
    size = _hread(in, (void __huge *)file, 40000L);
    _lclose(in);
    wsprintf(probeResult, "%ld,%lx", size, versionAt());
    probe("file", "DOSAPP.FON", probeResult);

    faces("start");
    tryVersion(0x200);
    tryVersion(0x100);
    tryVersion(0x0);
    tryVersion(0x250);
    tryVersion(0x300);
    tryVersion(0x301);
    tryVersion(0x1ff);
    faces("end");

    GlobalUnlock(block);
    GlobalFree(block);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
